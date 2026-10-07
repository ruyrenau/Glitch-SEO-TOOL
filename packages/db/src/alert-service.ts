import { Prisma, Severity } from '@prisma/client';
import { diffCrawls, alertsFromDiff, assertSafeUrl, PageSnapshot, AlertCandidate, CrawlDiff } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent } from './audit';

const json = (v: unknown) => v as Prisma.InputJsonValue;

type RunConfig = { robots?: { found: boolean; hash?: string | null }; limitReached?: boolean } | null;

async function snapshots(crawlRunId: string): Promise<PageSnapshot[]> {
  const rows = await prisma.crawledPage.findMany({
    where: { crawlRunId },
    select: { url: true, statusCode: true, title: true, metaDescription: true, canonical: true, h1: true, isIndexable: true, indexabilityReason: true, wordCount: true, blockedByRobots: true, schemaTypes: true }
  });
  return rows.map(r => ({ ...r, schemaTypes: Array.isArray(r.schemaTypes) ? (r.schemaTypes as string[]) : [] }));
}

/** The completed crawl of the same site that finished right before `run`. */
async function previousCompletedRun(run: { id: string; siteId: string; startedAt: Date }) {
  return prisma.crawlRun.findFirst({
    where: { siteId: run.siteId, status: 'completed', startedAt: { lt: run.startedAt }, NOT: { id: run.id } },
    orderBy: { startedAt: 'desc' }
  });
}

export interface CrawlDiffResult extends CrawlDiff {
  base: { id: string; startedAt: Date; urlsCrawled: number };
  target: { id: string; startedAt: Date; urlsCrawled: number };
}

/** Diff of `crawlRunId` against `baseRunId` (default: previous completed crawl). null if there is nothing to compare. */
export async function getCrawlDiff(crawlRunId: string, baseRunId?: string): Promise<CrawlDiffResult | null> {
  const target = await prisma.crawlRun.findUnique({ where: { id: crawlRunId } });
  if (!target) throw new Error(`Crawl ${crawlRunId} not found`);
  const base = baseRunId ? await prisma.crawlRun.findFirst({ where: { id: baseRunId, siteId: target.siteId } }) : await previousCompletedRun(target);
  if (!base) return null;
  const cfg = target.config as RunConfig;
  const diff = diffCrawls(await snapshots(base.id), await snapshots(target.id), { newerCrawlComplete: target.status === 'completed' && !cfg?.limitReached });
  return {
    ...diff,
    base: { id: base.id, startedAt: base.startedAt, urlsCrawled: base.urlsCrawled },
    target: { id: target.id, startedAt: target.startedAt, urlsCrawled: target.urlsCrawled }
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

interface Delivery {
  channel: string;
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Optional outbound delivery. ALERT_WEBHOOK_URL receives JSON; Slack incoming
 * webhooks (hooks.slack.com) receive a {text} payload. Delivery never throws.
 */
async function deliver(siteName: string, alerts: Array<AlertCandidate & { id: string }>): Promise<Delivery[]> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !alerts.length) return [];
  const isSlack = /^https:\/\/hooks\.slack\.com\//.test(url);
  const body = isSlack
    ? { text: `*Glitch SEO Ops — ${siteName}*\n${alerts.map(a => `• [${a.severity}] ${a.message}`).join('\n')}` }
    : { site: siteName, alerts: alerts.map(a => ({ id: a.id, type: a.type, severity: a.severity, message: a.message, urls: a.urls.slice(0, 20) })) };
  try {
    await assertSafeUrl(url, { allowHosts: (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean) });
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    return [{ channel: isSlack ? 'slack' : 'webhook', ok: res.ok, status: res.status }];
  } catch (e) {
    return [{ channel: isSlack ? 'slack' : 'webhook', ok: false, error: (e as Error).message.slice(0, 300) }];
  }
}

/** Compares a finished crawl with the previous one and stores (and optionally delivers) alerts. */
export async function createAlertsForRun(crawlRunId: string) {
  const run = await prisma.crawlRun.findUnique({ where: { id: crawlRunId }, include: { site: true } });
  if (!run || run.status !== 'completed') return [];
  const prev = await previousCompletedRun(run);
  if (!prev) return [];
  const cfgNow = run.config as RunConfig;
  const cfgPrev = prev.config as RunConfig;
  const diff = diffCrawls(await snapshots(prev.id), await snapshots(run.id), { newerCrawlComplete: !cfgNow?.limitReached });
  const candidates = alertsFromDiff(diff, { pagesInNewerCrawl: run.urlsCrawled, robotsBefore: cfgPrev?.robots, robotsAfter: cfgNow?.robots });
  if (!candidates.length) return [];

  const created = [];
  for (const c of candidates) {
    const a = await prisma.alert.create({
      data: { siteId: run.siteId, crawlRunId: run.id, type: c.type, severity: c.severity as Severity, message: c.message, urls: json(c.urls), details: c.details ? json(c.details) : undefined }
    });
    created.push({ ...c, id: a.id });
  }
  const deliveries = await deliver(run.site.name, created);
  if (deliveries.length) await prisma.alert.updateMany({ where: { id: { in: created.map(c => c.id) } }, data: { deliveredTo: json(deliveries) } });
  await recordAuditEvent({ workspaceId: run.site.workspaceId, userId: null, action: 'alerts.created', entity: 'CrawlRun', entityId: run.id, details: { count: created.length, types: created.map(c => c.type), deliveries: json(deliveries) } });
  return created;
}

export async function listAlerts(siteId: string, status?: 'open' | 'acknowledged') {
  const rank = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  const rows = await prisma.alert.findMany({ where: { siteId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  // Newest crawl first; within one crawl, most severe first.
  const groupTime = new Map<string, number>();
  for (const r of rows) {
    const k = r.crawlRunId ?? r.id;
    groupTime.set(k, Math.max(groupTime.get(k) ?? 0, r.createdAt.getTime()));
  }
  const t = (r: (typeof rows)[number]) => groupTime.get(r.crawlRunId ?? r.id)!;
  return rows.sort((a, b) => t(b) - t(a) || rank.indexOf(a.severity) - rank.indexOf(b.severity));
}

export async function acknowledgeAlert(alertId: string, actorUserId?: string | null) {
  const a = await prisma.alert.update({ where: { id: alertId }, data: { status: 'acknowledged', acknowledgedAt: new Date() }, include: { site: true } });
  await recordAuditEvent({ workspaceId: a.site.workspaceId, userId: actorUserId ?? null, action: 'alert.acknowledged', entity: 'Alert', entityId: alertId, details: { type: a.type } });
  return a;
}
