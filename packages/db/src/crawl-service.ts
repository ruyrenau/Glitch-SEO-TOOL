import zlib from 'zlib';
import { Prisma, Severity } from '@prisma/client';
import { crawlSite, auditCrawl, indexabilityOf, CrawlOptions, CrawledPageData, DetectedIssue } from '@glitch/crawler';
import { calculatePriorityScore } from '@glitch/core';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { createAlertsForRun } from './alert-service';

const BATCH = 500;

/**
 * Until per-section business importance is configurable, severity acts as the
 * businessImportance factor of the priority heuristic. Scores are scaled x10.
 */
const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0.5 };

export interface RunCrawlOptions extends Partial<Omit<CrawlOptions, 'startUrl' | 'seeds' | 'signal' | 'onProgress'>> {
  siteId: string;
  /** Use stored sitemap URLs as extra seeds (default true). */
  seedFromSitemap?: boolean;
  actorUserId?: string | null;
  signal?: AbortSignal;
  onProgress?: CrawlOptions['onProgress'];
  /** Called right after the CrawlRun row exists, before crawling starts. */
  onStarted?: (crawlRunId: string) => void;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function runCrawl(opts: RunCrawlOptions) {
  const site = await prisma.site.findUnique({ where: { id: opts.siteId } });
  if (!site) throw new Error(`Site ${opts.siteId} not found`);
  const sitemapRows = await prisma.sitemapUrl.findMany({ where: { siteId: site.id }, select: { url: true } });
  const sitemapUrls = new Set(sitemapRows.map(r => r.url));

  const config = {
    maxUrls: opts.maxUrls ?? 500,
    maxDepth: opts.maxDepth ?? 5,
    concurrency: opts.concurrency ?? 2,
    rps: opts.rps ?? site.maxRps,
    respectRobots: opts.respectRobots ?? true,
    include: opts.include ?? [],
    exclude: opts.exclude ?? [],
    userAgent: opts.userAgent ?? site.userAgent,
    seedFromSitemap: opts.seedFromSitemap ?? true,
    renderJs: opts.renderJs ?? false,
    listUrls: opts.listUrls?.length ? opts.listUrls : undefined,
    maxUrlLength: opts.maxUrlLength,
    maxFolderDepth: opts.maxFolderDepth,
    maxUrlsPerFolder: opts.maxUrlsPerFolder,
    maxQueryParams: opts.maxQueryParams,
    maxLinksPerPage: opts.maxLinksPerPage,
    maxRedirects: opts.maxRedirects,
    stayInStartFolder: opts.stayInStartFolder,
    maxBodyBytes: opts.maxBodyBytes
  };
  const listMode = !!config.listUrls;
  const run = await prisma.crawlRun.create({ data: { siteId: site.id, status: 'running', mode: listMode ? 'list' : 'site', maxDepth: config.maxDepth, config: json(config) } });
  opts.onStarted?.(run.id);
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: opts.actorUserId ?? null, action: 'crawl.started', entity: 'CrawlRun', entityId: run.id, details: json(config) });

  try {
    // Paths Googlebot requested in the latest log import, to flag crawl/log overlap.
    const latestImport = await prisma.logImport.findFirst({ where: { siteId: site.id, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    const loggedPaths = new Set(
      latestImport
        ? (await prisma.logAggregate.findMany({ where: { logImportId: latestImport.id, botName: { startsWith: 'Googlebot' } }, select: { path: true }, distinct: ['path'] })).map(r => r.path)
        : []
    );

    const toRow = (p: CrawledPageData) => {
      const ix = indexabilityOf(p);
      const u = new URL(p.url);
      const e = p.extracted;
      return {
        crawlRunId: run.id,
        url: p.url,
        finalUrl: p.finalUrl,
        statusCode: p.statusCode,
        responseTimeMs: p.responseTimeMs,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        title: e?.title?.slice(0, 500) ?? null,
        metaDescription: e?.metaDescription?.slice(0, 1000) ?? null,
        canonical: e?.canonical ?? null,
        robotsMeta: e?.robotsMeta ?? null,
        xRobotsTag: p.xRobotsTag,
        h1: e?.h1[0]?.slice(0, 500) ?? null,
        h1Count: e?.h1.length ?? 0,
        lang: e?.lang ?? null,
        hreflang: e?.hreflang.length ? json(e.hreflang) : undefined,
        schemaTypes: e?.schemaTypes.length ? json(e.schemaTypes) : undefined,
        schemaErrors: e?.schemaErrors.length ?? 0,
        redirectChain: p.redirectChain.length ? json(p.redirectChain) : undefined,
        contentHash: e?.contentHash ?? null,
        inlinks: 0, // set once the whole link graph is known
        outlinks: e?.internalLinks.length ?? 0,
        externalLinks: e?.externalLinks ?? 0,
        imagesMissingAlt: e?.imagesMissingAlt ?? 0,
        blockedByRobots: p.blockedByRobots,
        error: p.error,
        inSitemap: sitemapUrls.has(p.url),
        inLogs: loggedPaths.has(u.pathname + u.search),
        isIndexable: ix.indexable,
        indexabilityReason: ix.reason,
        wordCount: e?.wordCount ?? 0,
        depth: p.depth,
        titleCount: e?.titleCount ?? 0,
        metaDescriptionCount: e?.metaDescriptionCount ?? 0,
        h1All: e?.h1.length ? json(e.h1.slice(0, 20)) : undefined,
        h2: e?.h2.length ? json(e.h2) : undefined,
        metaKeywords: e?.metaKeywords?.slice(0, 1000) ?? null,
        og: e ? json(e.og) : undefined,
        twitter: e ? json(e.twitter) : undefined,
        relNext: e?.relNext ?? null,
        relPrev: e?.relPrev ?? null,
        images: e?.imageList.length ? json(e.imageList) : undefined,
        headers: Object.keys(p.headers).length ? json(p.headers) : undefined,
        htmlGz: p.html && p.html.length <= 2 * 1024 * 1024 ? zlib.gzipSync(p.html) : null,
        js: p.js ? json(p.js) : undefined
      };
    };

    // Pages are written as they are crawled, so memory does not grow with the site.
    let pageRows: ReturnType<typeof toRow>[] = [];
    let linkRows: Prisma.CrawledLinkCreateManyInput[] = [];
    let writing: Promise<void> = Promise.resolve();
    const flush = () => {
      const pr = pageRows;
      const lr = linkRows;
      pageRows = [];
      linkRows = [];
      writing = writing.then(async () => {
        if (pr.length) await prisma.crawledPage.createMany({ data: pr });
        for (let i = 0; i < lr.length; i += BATCH) await prisma.crawledLink.createMany({ data: lr.slice(i, i + BATCH) });
      });
      return writing;
    };
    const onPage = async (p: CrawledPageData) => {
      pageRows.push(toRow(p));
      for (const l of p.extracted?.links ?? []) linkRows.push({ crawlRunId: run.id, sourceUrl: p.finalUrl, targetUrl: l.url, anchor: l.anchor, internal: l.internal, nofollow: l.nofollow });
      if (pageRows.length >= 200 || linkRows.length >= 5000) await flush();
    };

    const result = await crawlSite({
      onPage,
      ...config,
      startUrl: site.canonicalUrl,
      seeds: config.seedFromSitemap ? [...sitemapUrls] : [],
      allowHosts: opts.allowHosts,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onProgress: opts.onProgress
    });

    await flush();
    // Inlinks are only known at the end: one UPDATE … CASE per batch.
    const withInlinks = result.pages.filter(p => p.inlinks > 0);
    for (let i = 0; i < withInlinks.length; i += 400) {
      const chunk = withInlinks.slice(i, i + 400);
      const cases = Prisma.join(chunk.map(p => Prisma.sql`WHEN ${p.url} THEN ${p.inlinks}`), ' ');
      await prisma.$executeRaw`UPDATE "CrawledPage" SET "inlinks" = CASE "url" ${cases} ELSE "inlinks" END WHERE "crawlRunId" = ${run.id} AND "url" IN (${Prisma.join(chunk.map(p => p.url))})`;
    }
    const resources = result.resources.map(r => ({ crawlRunId: run.id, url: r.url, kind: r.kind, internal: r.internal, isLink: r.isLink, statusCode: r.statusCode, finalUrl: r.finalUrl, redirected: r.redirected, contentType: r.contentType, sizeBytes: r.sizeBytes, responseTimeMs: r.responseTimeMs, error: r.error, foundOn: r.foundOn, foundOnCount: r.foundOnCount }));
    for (let i = 0; i < resources.length; i += BATCH) await prisma.crawledResource.createMany({ data: resources.slice(i, i + BATCH) });

    const detected = auditCrawl(result, { environment: site.environment, sitemapUrls });
    // A list crawl covers a handful of URLs: it must not open or resolve the site's issues.
    if (!listMode) await syncIssues(site.id, run.id, detected);
    // Limits that leave parts of the site out make the crawl partial: diffs then do not report removed pages.
    const LIMIT_SKIPS = ['maxUrlLength', 'maxFolderDepth', 'maxUrlsPerFolder', 'maxQueryParams', 'maxLinksPerPage', 'outsideStartFolder'];
    const partial = listMode || result.limitReached || LIMIT_SKIPS.some(k => (result.skipped as Record<string, number>)[k]);

    const status = result.cancelled ? 'cancelled' : 'completed';
    const done = await prisma.crawlRun.update({
      where: { id: run.id },
      data: {
        status,
        urlsCrawled: result.pages.length,
        urlsDiscovered: result.discovered,
        issuesFound: detected.length,
        completedAt: new Date(),
        config: json({ ...config, robots: result.robots, hostVariants: result.hostVariants, limitReached: result.limitReached, partial, skipped: result.skipped })
      }
    });
    await prisma.site.update({ where: { id: site.id }, data: { lastAuditAt: new Date() } });
    // Keep disk bounded: older crawls of this site lose their heavy detail right away.
    await purgeOldCrawlDetail({ siteId: site.id }).catch(e => recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'crawl.detail_purge_failed', entity: 'Site', entityId: site.id, details: { error: (e as Error).message } }));
    if (status === 'completed' && !listMode) {
      try {
        await createAlertsForRun(run.id);
      } catch (e) {
        await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'alerts.failed', entity: 'CrawlRun', entityId: run.id, details: { error: (e as Error).message } });
      }
    }
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: opts.actorUserId ?? null, action: `crawl.${status}`, entity: 'CrawlRun', entityId: run.id, details: { pages: result.pages.length, issues: detected.length } });
    return done;
  } catch (err) {
    await prisma.crawlRun.update({ where: { id: run.id }, data: { status: 'failed', error: (err as Error).message.slice(0, 1000), completedAt: new Date() } });
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: opts.actorUserId ?? null, action: 'crawl.failed', entity: 'CrawlRun', entityId: run.id, details: { error: (err as Error).message } });
    throw err;
  }
}

/**
 * Upserts one row per (site, code). Codes no longer detected are resolved;
 * issues a person marked "ignored" stay ignored.
 */
async function syncIssues(siteId: string, crawlRunId: string, detected: DetectedIssue[]) {
  const now = new Date();
  const existing = await prisma.issue.findMany({ where: { siteId } });
  const byCode = new Map(existing.map(i => [i.code, i]));
  for (const d of detected) {
    const priorityScore = Math.round(calculatePriorityScore({ impact: d.impact, confidence: d.confidence, affectedUrlsCount: d.affectedUrls.length, businessImportance: SEVERITY_WEIGHT[d.severity] ?? 1, effort: d.effort, risk: d.risk }) * 10);
    const data = {
      crawlRunId,
      category: d.category,
      title: d.title,
      description: d.description,
      severity: d.severity as Severity,
      impact: d.impact,
      effort: d.effort,
      risk: d.risk,
      confidence: d.confidence,
      priorityScore,
      affectedUrlsCount: d.affectedUrls.length,
      affectedUrls: json(d.affectedUrls.slice(0, 200)),
      evidence: d.evidence ? json(d.evidence) : Prisma.JsonNull,
      recommendation: d.recommendation,
      lastSeenAt: now
    };
    const prev = byCode.get(d.code);
    if (prev) {
      await prisma.issue.update({
        where: { id: prev.id },
        data: { ...data, ...(prev.status === 'resolved' ? { status: 'open', resolvedAt: null } : {}) }
      });
    } else {
      await prisma.issue.create({ data: { ...data, siteId, code: d.code, status: 'open' } });
    }
  }
  const stillPresent = new Set(detected.map(d => d.code));
  await prisma.issue.updateMany({
    where: { siteId, status: { in: ['open', 'in_progress'] }, code: { notIn: [...stillPresent] } },
    data: { status: 'resolved', resolvedAt: now }
  });
}

export async function listCrawlRuns(siteId: string) {
  return prisma.crawlRun.findMany({ where: { siteId }, orderBy: { startedAt: 'desc' }, take: 50 });
}

export async function listCrawledPages(crawlRunId: string, filter: { status?: 'ok' | 'redirect' | 'error' | 'blocked'; indexable?: boolean; q?: string; skip?: number; take?: number }) {
  const where: Prisma.CrawledPageWhereInput = { crawlRunId };
  if (filter.status === 'ok') where.statusCode = { gte: 200, lt: 300 };
  if (filter.status === 'redirect') where.statusCode = { gte: 300, lt: 400 };
  if (filter.status === 'error') where.OR = [{ statusCode: { gte: 400 } }, { statusCode: 0, blockedByRobots: false }];
  if (filter.status === 'blocked') where.blockedByRobots = true;
  if (filter.indexable !== undefined) where.isIndexable = filter.indexable;
  if (filter.q) where.url = { contains: filter.q };
  const [total, items] = await Promise.all([
    prisma.crawledPage.count({ where }),
    prisma.crawledPage.findMany({ where, orderBy: [{ depth: 'asc' }, { url: 'asc' }], skip: filter.skip ?? 0, take: Math.min(filter.take ?? 50, 200) })
  ]);
  return { total, items };
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

/** Ordered by severity first, then by the priority heuristic within each severity. */
export async function listIssues(siteId: string, status?: string) {
  const rows = await prisma.issue.findMany({ where: { siteId, ...(status ? { status } : {}) } });
  return rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.priorityScore - a.priorityScore);
}

export async function setIssueStatus(issueId: string, status: 'open' | 'in_progress' | 'resolved' | 'ignored', actorUserId?: string | null) {
  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
    include: { site: true }
  });
  await recordAuditEvent({ workspaceId: issue.site.workspaceId, userId: actorUserId ?? null, action: 'issue.status_changed', entity: 'Issue', entityId: issueId, details: { code: issue.code, status } });
  return issue;
}

/** How many recent crawls per site keep their full detail (CRAWL_DETAIL_KEEP, default 3). */
export const crawlDetailKeep = () => Math.max(1, Number(process.env.CRAWL_DETAIL_KEEP) || 3);

/**
 * Frees disk: for every crawl older than the newest `keep` of its site, deletes the stored HTML,
 * the link list and the resource checks. Page summaries, issues, diffs and alerts are kept.
 */
export async function purgeOldCrawlDetail(opts: { siteId?: string; keep?: number } = {}) {
  const keep = opts.keep ?? crawlDetailKeep();
  const runs = await prisma.crawlRun.findMany({
    where: { ...(opts.siteId ? { siteId: opts.siteId } : {}), status: { not: 'running' } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, siteId: true, detailPurgedAt: true, site: { select: { workspaceId: true } } }
  });
  const seen = new Map<string, number>();
  const purged: string[] = [];
  let links = 0;
  let resources = 0;
  let html = 0;
  for (const r of runs) {
    const n = (seen.get(r.siteId) ?? 0) + 1;
    seen.set(r.siteId, n);
    if (n <= keep || r.detailPurgedAt) continue;
    html += (await prisma.crawledPage.updateMany({ where: { crawlRunId: r.id, htmlGz: { not: null } }, data: { htmlGz: null } })).count;
    links += (await prisma.crawledLink.deleteMany({ where: { crawlRunId: r.id } })).count;
    resources += (await prisma.crawledResource.deleteMany({ where: { crawlRunId: r.id } })).count;
    await prisma.crawlRun.update({ where: { id: r.id }, data: { detailPurgedAt: new Date() } });
    await recordAuditEvent({ workspaceId: r.site.workspaceId, userId: null, action: 'crawl.detail_purged', entity: 'CrawlRun', entityId: r.id, details: { keep } });
    purged.push(r.id);
  }
  return { runsPurged: purged.length, htmlRemoved: html, linksRemoved: links, resourcesRemoved: resources, keep };
}
