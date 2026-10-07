import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { analyzeLogFile, LogAnalysis, FileAnalysisOptions, verifyBotIps, BotVerificationSummary, DnsLookups } from '@glitch/log-parser';
import { prisma } from './client';
import { recordAuditEvent } from './audit';

const INSERT_BATCH = 2_000;
const HUMAN_PATH = '*';

export class DuplicateImportError extends Error {
  constructor(public readonly existingImportId: string) {
    super(`This file was already imported (import ${existingImportId}).`);
    this.name = 'DuplicateImportError';
  }
}

export interface ImportLogOptions extends FileAnalysisOptions {
  siteId: string;
  filePath: string;
  /** Original file name shown in the UI (uploads are stored under a temp name). */
  fileName?: string;
  actorUserId?: string | null;
  /** Re-import even if the same checksum already exists (replaces the old import). */
  replaceExisting?: boolean;
  /** Verify search-engine crawlers by reverse+forward DNS (default: BOT_DNS_VERIFICATION env, on unless "false"). */
  verifyBots?: boolean;
  /** Injected DNS for tests. */
  dns?: DnsLookups;
}

export interface ImportLogResult {
  importId: string;
  analysis: Omit<LogAnalysis, 'aggregates' | 'botIps' | 'botIpsOverflow'> & { aggregateRows: number; botVerification: Record<string, BotVerificationSummary> | null };
}

const VERIFICATION_TTL_MS = 7 * 86400_000;

/** Verifies DNS-verifiable crawlers; raw IPs stay in memory, the cache only sees an HMAC. */
async function verifyCrawlers(analysis: LogAnalysis, salt: string, dns?: DnsLookups) {
  if (!analysis.botIps.size) return null;
  const keyOf = (ip: string) => crypto.createHmac('sha256', `${salt}:dnsv`).update(ip).digest('hex').slice(0, 32);
  const summary = await verifyBotIps(analysis.botIps, {
    dns,
    keyOf,
    cache: {
      get: async (key, family) => {
        const row = await prisma.botIpVerification.findUnique({ where: { key: `${family}:${key}` } });
        return row && Date.now() - row.checkedAt.getTime() < VERIFICATION_TTL_MS ? (row.result as 'verified' | 'spoofed') : null;
      },
      set: async (key, family, result) => {
        await prisma.botIpVerification.upsert({ where: { key: `${family}:${key}` }, create: { key: `${family}:${key}`, family, result }, update: { result, checkedAt: new Date() } });
      }
    }
  });
  for (const [bot, hits] of Object.entries(analysis.botIpsOverflow)) {
    if (summary[bot]) {
      summary[bot].uncheckedHits += hits;
      summary[bot].claimedHits += hits;
    }
  }
  analysis.botIps.clear();
  return summary;
}

/**
 * Streams a log file, stores bounded aggregates (never raw lines or IPs)
 * and records an audit event. Duplicate files are rejected by SHA-256.
 */
export async function importLogFile(opts: ImportLogOptions): Promise<ImportLogResult> {
  const site = await prisma.site.findUnique({ where: { id: opts.siteId } });
  if (!site) throw new Error(`Site ${opts.siteId} not found`);
  const stat = await fs.promises.stat(opts.filePath);

  const salt = opts.salt ?? process.env.SALT_SECRET;
  if (!salt && process.env.NODE_ENV === 'production') throw new Error('SALT_SECRET must be set in production to hash IP addresses');
  const analysis = await analyzeLogFile(opts.filePath, { ...opts, salt: salt ?? 'dev-only-salt' });
  if (analysis.cancelled) throw new Error('Import cancelled');

  const existing = await prisma.logImport.findUnique({
    where: { siteId_checksum: { siteId: site.id, checksum: analysis.checksum } }
  });
  if (existing) {
    if (!opts.replaceExisting) throw new DuplicateImportError(existing.id);
    await prisma.logImport.delete({ where: { id: existing.id } });
  }

  const verify = opts.verifyBots ?? process.env.BOT_DNS_VERIFICATION !== 'false';
  const botVerification = verify ? await verifyCrawlers(analysis, salt ?? 'dev-only-salt', opts.dns).catch(() => null) : null;
  const { aggregates, botIps: _ips, botIpsOverflow: _overflow, ...summary } = analysis;
  void _ips;
  void _overflow;
  const imp = await prisma.logImport.create({
    data: {
      siteId: site.id,
      fileName: opts.fileName ?? path.basename(opts.filePath),
      checksum: analysis.checksum,
      status: 'processing',
      totalLines: analysis.totalLines,
      validLines: analysis.validLines,
      invalidLines: analysis.invalidLines,
      skippedLines: analysis.skippedLines,
      fileSizeBytes: BigInt(stat.size),
      startDate: analysis.startDate,
      endDate: analysis.endDate,
      crawledPagesCount: new Set(aggregates.filter(a => a.path !== HUMAN_PATH).map(a => a.path)).size,
      googlebotRequests: analysis.googlebotRequests,
      aiBotRequests: analysis.aiBotRequests,
      errorsSummary: { samples: analysis.errorSamples },
      stats: ({
        botRequests: analysis.botRequests,
        statusDistribution: analysis.statusDistribution,
        botDistribution: analysis.botDistribution,
        hourlyBotHits: analysis.hourlyBotHits,
        aiReferrals: analysis.aiReferrals,
        crawledParameters: analysis.crawledParameters,
        responseTime: analysis.responseTime,
        aggregatesTruncated: analysis.aggregatesTruncated,
        botVerification
      } as unknown as Prisma.InputJsonValue)
    }
  });

  try {
    for (let i = 0; i < aggregates.length; i += INSERT_BATCH) {
      await prisma.logAggregate.createMany({
        data: aggregates.slice(i, i + INSERT_BATCH).map(a => ({
          logImportId: imp.id,
          date: new Date(`${a.date}T00:00:00Z`),
          botName: a.botName,
          botCategory: a.botCategory,
          statusCode: a.statusCode,
          path: a.path,
          hits: a.hits,
          bytes: BigInt(a.bytes),
          avgDurationMs: a.durationCount ? a.durationSumMs / a.durationCount : 0,
          durationSamples: a.durationCount
        }))
      });
    }
    await prisma.logImport.update({ where: { id: imp.id }, data: { status: 'completed' } });
  } catch (err) {
    await prisma.logImport.update({ where: { id: imp.id }, data: { status: 'failed' } });
    throw err;
  }

  await prisma.site.update({ where: { id: site.id }, data: { lastLogImportAt: new Date() } });
  await recordAuditEvent({
    workspaceId: site.workspaceId,
    userId: opts.actorUserId ?? null,
    action: 'log_import.created',
    entity: 'LogImport',
    entityId: imp.id,
    details: { fileName: imp.fileName, totalLines: analysis.totalLines, checksum: analysis.checksum }
  });

  return { importId: imp.id, analysis: { ...summary, aggregateRows: aggregates.length, botVerification } };
}

export async function deleteLogImport(importId: string, actorUserId?: string | null): Promise<void> {
  const imp = await prisma.logImport.findUnique({ where: { id: importId }, include: { site: true } });
  if (!imp) throw new Error(`Import ${importId} not found`);
  await prisma.logImport.delete({ where: { id: importId } });
  await recordAuditEvent({
    workspaceId: imp.site.workspaceId,
    userId: actorUserId ?? null,
    action: 'log_import.deleted',
    entity: 'LogImport',
    entityId: importId,
    details: { fileName: imp.fileName }
  });
}

// ---------------------------------------------------------------------------
// Sitemap URLs
// ---------------------------------------------------------------------------

export interface SitemapUrlInput {
  url: string;
  path: string;
  lastmod: Date | null;
}

/** Replaces the stored sitemap URL set for a site. */
export async function replaceSitemapUrls(siteId: string, source: string, entries: SitemapUrlInput[], actorUserId?: string | null): Promise<number> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error(`Site ${siteId} not found`);
  const unique = new Map(entries.map(e => [e.path, e]));
  await prisma.sitemapUrl.deleteMany({ where: { siteId } });
  const rows = [...unique.values()];
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await prisma.sitemapUrl.createMany({
      data: rows.slice(i, i + INSERT_BATCH).map(e => ({ siteId, url: e.url, path: e.path, lastmod: e.lastmod, source }))
    });
  }
  await recordAuditEvent({
    workspaceId: site.workspaceId,
    userId: actorUserId ?? null,
    action: 'sitemap.imported',
    entity: 'Site',
    entityId: siteId,
    details: { source, urls: rows.length }
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Reports (computed only from stored aggregates)
// ---------------------------------------------------------------------------

interface StoredStats {
  botRequests: number;
  statusDistribution: Record<string, number>;
  botDistribution: Record<string, number>;
  hourlyBotHits: number[];
  aiReferrals: Record<string, number>;
  crawledParameters: Record<string, number>;
  responseTime: { p50: number | null; p90: number | null; p99: number | null; samples: number };
  aggregatesTruncated: boolean;
  botVerification?: Record<string, BotVerificationSummary> | null;
}

export interface UrlHits {
  path: string;
  hits: number;
  statusCode?: number;
}

const topN = (m: Map<string, number>, n: number): UrlHits[] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([path, hits]) => ({ path, hits }));

const firstDirectory = (p: string) => {
  const seg = p.split('?')[0].split('/').filter(Boolean)[0];
  return seg ? `/${seg}/` : '/';
};

export async function getLogReport(siteId: string, importId?: string) {
  const imp = importId
    ? await prisma.logImport.findFirst({ where: { id: importId, siteId } })
    : await prisma.logImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
  if (!imp) return null;

  const stats = imp.stats as unknown as StoredStats;
  const rows = await prisma.logAggregate.findMany({
    where: { logImportId: imp.id, NOT: { path: HUMAN_PATH } },
    select: { date: true, botName: true, botCategory: true, statusCode: true, path: true, hits: true, avgDurationMs: true, durationSamples: true }
  });

  const byDay = new Map<string, number>();
  const byDirectory = new Map<string, number>();
  const urlHits = new Map<string, number>();
  const googleUrlHits = new Map<string, number>();
  const errors4xx = new Map<string, number>();
  const errors5xx = new Map<string, number>();
  const redirects = new Map<string, number>();
  const paramUrls = new Map<string, number>();
  const aiByBot = new Map<string, number>();
  let wasteHits = 0;

  for (const r of rows) {
    const day = r.date.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.hits);
    byDirectory.set(firstDirectory(r.path), (byDirectory.get(firstDirectory(r.path)) ?? 0) + r.hits);
    urlHits.set(r.path, (urlHits.get(r.path) ?? 0) + r.hits);
    if (r.botName.startsWith('Googlebot')) googleUrlHits.set(r.path, (googleUrlHits.get(r.path) ?? 0) + r.hits);
    if (r.botCategory === 'AI_CRAWLER' || r.botCategory === 'AI_ASSISTANT') aiByBot.set(r.botName, (aiByBot.get(r.botName) ?? 0) + r.hits);

    const isParam = r.path.includes('?');
    if (r.statusCode >= 300 && r.statusCode < 400) redirects.set(r.path, (redirects.get(r.path) ?? 0) + r.hits);
    if (r.statusCode >= 400 && r.statusCode < 500) errors4xx.set(r.path, (errors4xx.get(r.path) ?? 0) + r.hits);
    if (r.statusCode >= 500) errors5xx.set(r.path, (errors5xx.get(r.path) ?? 0) + r.hits);
    if (isParam) paramUrls.set(r.path, (paramUrls.get(r.path) ?? 0) + r.hits);
    if (r.statusCode >= 300 || isParam) wasteHits += r.hits;
  }

  // Sitemap cross-reference (only if a sitemap was imported for this site).
  const sitemap = await prisma.sitemapUrl.findMany({ where: { siteId }, select: { path: true } });
  let sitemapCoverage = null;
  if (sitemap.length) {
    const sitemapPaths = new Set(sitemap.map(s => s.path));
    const neverCrawledByGooglebot = [...sitemapPaths].filter(p => !googleUrlHits.has(p));
    const okCrawled = new Set(rows.filter(r => r.statusCode === 200 && !r.path.includes('?')).map(r => r.path));
    const crawledNotInSitemap = [...okCrawled].filter(p => !sitemapPaths.has(p));
    sitemapCoverage = {
      sitemapUrls: sitemapPaths.size,
      crawledByGooglebot: sitemapPaths.size - neverCrawledByGooglebot.length,
      neverCrawledByGooglebot: neverCrawledByGooglebot.slice(0, 200),
      neverCrawledCount: neverCrawledByGooglebot.length,
      crawledNotInSitemap: topN(new Map(crawledNotInSitemap.map(p => [p, urlHits.get(p) ?? 0])), 200),
      crawledNotInSitemapCount: crawledNotInSitemap.length
    };
  }

  const botRequests = stats.botRequests;
  return {
    import: {
      id: imp.id,
      fileName: imp.fileName,
      createdAt: imp.createdAt,
      startDate: imp.startDate,
      endDate: imp.endDate,
      totalLines: imp.totalLines,
      validLines: imp.validLines,
      invalidLines: imp.invalidLines,
      skippedLines: imp.skippedLines,
      errorSamples: (imp.errorsSummary as { samples?: string[] } | null)?.samples ?? []
    },
    totals: {
      requests: imp.validLines,
      botRequests,
      googlebotRequests: imp.googlebotRequests,
      aiBotRequests: imp.aiBotRequests,
      uniqueBotUrls: urlHits.size
    },
    statusDistribution: stats.statusDistribution,
    botDistribution: stats.botDistribution,
    botVerification: stats.botVerification ?? null,
    hourlyBotHits: stats.hourlyBotHits,
    responseTime: stats.responseTime,
    aiReferrals: stats.aiReferrals,
    aiBots: Object.fromEntries(aiByBot),
    crawledParameters: stats.crawledParameters,
    botHitsByDay: [...byDay.entries()].sort().map(([date, hits]) => ({ date, hits })),
    botHitsByDirectory: topN(byDirectory, 25),
    topBotUrls: topN(urlHits, 50),
    leastCrawledBotUrls: [...urlHits.entries()].sort((a, b) => a[1] - b[1]).slice(0, 50).map(([path, hits]) => ({ path, hits })),
    bot4xx: topN(errors4xx, 100),
    bot5xx: topN(errors5xx, 100),
    botRedirects: topN(redirects, 100),
    botParameterUrls: topN(paramUrls, 100),
    crawlWaste: {
      label: 'Potential waste (observed bot hits on redirects, errors and parameterized URLs). An estimate, not a crawl budget measurement.',
      hits: wasteHits,
      share: botRequests ? wasteHits / botRequests : 0
    },
    sitemapCoverage,
    dataQuality: {
      aggregatesTruncated: stats.aggregatesTruncated,
      responseTimeAvailable: stats.responseTime.samples > 0
    }
  };
}

export type LogReport = NonNullable<Awaited<ReturnType<typeof getLogReport>>>;

/** Flattens bot URL rows of a report for CSV export. */
export async function getBotUrlRows(siteId: string, importId?: string) {
  const imp = importId
    ? await prisma.logImport.findFirst({ where: { id: importId, siteId } })
    : await prisma.logImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
  if (!imp) return [];
  const rows = await prisma.logAggregate.findMany({
    where: { logImportId: imp.id, NOT: { path: HUMAN_PATH } },
    orderBy: [{ hits: 'desc' }]
  });
  return rows.map(r => ({
    date: r.date.toISOString().slice(0, 10),
    bot: r.botName,
    category: r.botCategory,
    status: r.statusCode,
    path: r.path,
    hits: r.hits,
    avgResponseMs: r.durationSamples ? Math.round(r.avgDurationMs) : ''
  }));
}
