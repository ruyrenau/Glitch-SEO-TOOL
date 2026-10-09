import crypto from 'crypto';
import { decryptSecret, encryptSecret } from '@glitch/core';
import { GscError, SearchConsoleClient, buildAuthUrl, exchangeCode, googleConfig, propertyMatchesUrl, revokeToken } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';

/**
 * Google Search Console: one Google account per workspace (OAuth, read-only), one property per site,
 * Search Analytics imported into the database, and reports that cross it with crawls, logs and sitemaps.
 */

const KEEP_IMPORTS = 3;

function cfgOrThrow() {
  const cfg = googleConfig();
  if (!cfg) throw new WorkflowError('GSC_NOT_CONFIGURED', 'Faltan GSC_CLIENT_ID y GSC_CLIENT_SECRET en el archivo .env del servidor.', 400);
  return cfg;
}

const wrap = (e: unknown): never => {
  if (e instanceof GscError) {
    const status = e.code === 'TOKEN_REVOKED' || e.code === 'FORBIDDEN' ? 400 : e.code === 'QUOTA' ? 429 : 502;
    throw new WorkflowError(`GSC_${e.code}`, e.message, status);
  }
  throw e;
};

// ---- OAuth state: signed, short-lived, bound to the workspace and the user who started it.
const stateKey = () => crypto.createHash('sha256').update(`gsc-state:${process.env.CREDENTIALS_KEY ?? process.env.SALT_SECRET ?? 'glitch-dev'}`).digest();
function signState(payload: { w: string; u: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const mac = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function readState(state: string): { w: string; u: string } {
  const [body, mac] = state.split('.');
  const want = body ? crypto.createHmac('sha256', stateKey()).update(body).digest('base64url') : '';
  if (!body || !mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new WorkflowError('GSC_BAD_STATE', 'La respuesta de Google no es válida. Vuelve a intentar la conexión.', 400);
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w: string; u: string; exp: number };
  if (Date.now() > p.exp) throw new WorkflowError('GSC_STATE_EXPIRED', 'La conexión tardó demasiado. Vuelve a intentarlo.', 400);
  return p;
}

export async function gscStatus(workspaceId: string) {
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId } });
  return { configured: !!googleConfig(), connected: !!acc, email: acc?.email ?? null, connectedAt: acc?.createdAt ?? null };
}

export function gscAuthUrl(workspaceId: string, userId: string) {
  return buildAuthUrl(cfgOrThrow(), signState({ w: workspaceId, u: userId }));
}

export async function gscFinishOAuth(input: { code: string; state: string; workspaceId: string; userId: string }) {
  const st = readState(input.state);
  if (st.w !== input.workspaceId || st.u !== input.userId) throw new WorkflowError('GSC_BAD_STATE', 'La conexión se inició con otra sesión. Vuelve a intentarlo.', 400);
  const tok = await exchangeCode(cfgOrThrow(), input.code).catch(wrap);
  await prisma.googleAccount.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId, email: tok.email, refreshTokenEnc: encryptSecret(tok.refreshToken), scope: tok.scope, connectedById: input.userId },
    update: { email: tok.email, refreshTokenEnc: encryptSecret(tok.refreshToken), scope: tok.scope, connectedById: input.userId }
  });
  await recordAuditEvent({ workspaceId: input.workspaceId, userId: input.userId, action: 'gsc.connected', entity: 'GoogleAccount', entityId: input.workspaceId, details: { email: tok.email } });
  return { email: tok.email };
}

export async function gscDisconnect(workspaceId: string, userId: string | null) {
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId } });
  if (!acc) return { disconnected: false };
  const cfg = googleConfig();
  if (cfg) await revokeToken(cfg, decryptSecret(acc.refreshTokenEnc));
  await prisma.googleAccount.delete({ where: { workspaceId } });
  await recordAuditEvent({ workspaceId, userId, action: 'gsc.disconnected', entity: 'GoogleAccount', entityId: workspaceId, details: { email: acc.email } });
  return { disconnected: true };
}

async function clientFor(workspaceId: string) {
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId } });
  if (!acc) throw new WorkflowError('GSC_NOT_CONNECTED', 'Conecta primero una cuenta de Google en la sección Search Console.', 400);
  return new SearchConsoleClient(cfgOrThrow(), decryptSecret(acc.refreshTokenEnc));
}

export async function gscProperties(workspaceId: string) {
  const c = await clientFor(workspaceId);
  return (await c.listSites().catch(wrap)).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export async function setSiteGscProperty(siteId: string, property: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  if (property) {
    const props = await gscProperties(site.workspaceId);
    if (!props.some(p => p.siteUrl === property)) throw new WorkflowError('GSC_PROPERTY_NOT_FOUND', 'Tu cuenta de Google no tiene acceso a esa propiedad.', 400);
  }
  const updated = await prisma.site.update({ where: { id: siteId }, data: { gscProperty: property } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'gsc.property_set', entity: 'Site', entityId: siteId, details: { property } });
  return { gscProperty: updated.gscProperty, matchesSite: property ? propertyMatchesUrl(property, site.canonicalUrl) : null };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Imports the last `days` days of final data (Google publishes with a ~2-day delay). */
export async function runGscImport(siteId: string, opts: { days?: number; log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  if (!site.gscProperty) throw new WorkflowError('GSC_NO_PROPERTY', 'Elige la propiedad de Search Console de este sitio.', 400);
  const client = await clientFor(site.workspaceId);
  const days = Math.min(Math.max(opts.days ?? 90, 7), 480);
  const end = new Date(Date.now() - 2 * 86400_000);
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  const imp = await prisma.gscImport.create({ data: { siteId, property: site.gscProperty, startDate: day(start), endDate: day(end) } });
  const log = opts.log ?? (() => undefined);
  try {
    const q = { startDate: imp.startDate, endDate: imp.endDate };
    const daily = await client.query(site.gscProperty, { ...q, dimensions: ['date'], maxRows: 1000 });
    log(`${daily.length} días`);
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const pages = await client.query(site.gscProperty, { ...q, dimensions: ['page'], maxRows: 100_000 });
    log(`${pages.length} páginas`);
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const queries = await client.query(site.gscProperty, { ...q, dimensions: ['query', 'page'], maxRows: 100_000 });
    log(`${queries.length} combinaciones de consulta y página`);

    await prisma.gscDailyStat.createMany({ data: daily.map(r => ({ importId: imp.id, date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) });
    for (let i = 0; i < pages.length; i += 1000) await prisma.gscPageStat.createMany({ data: pages.slice(i, i + 1000).map(r => ({ importId: imp.id, page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) });
    for (let i = 0; i < queries.length; i += 1000) await prisma.gscQueryStat.createMany({ data: queries.slice(i, i + 1000).map(r => ({ importId: imp.id, query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) });
    const done = await prisma.gscImport.update({ where: { id: imp.id }, data: { status: 'completed', pageRows: pages.length, queryRows: queries.length, truncated: pages.length >= 100_000 || queries.length >= 100_000, completedAt: new Date() } });

    const old = await prisma.gscImport.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, skip: KEEP_IMPORTS, select: { id: true } });
    if (old.length) await prisma.gscImport.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'gsc.imported', entity: 'GscImport', entityId: imp.id, details: { property: site.gscProperty, startDate: imp.startDate, endDate: imp.endDate, pages: pages.length, queries: queries.length } });
    return done;
  } catch (e) {
    await prisma.gscImport.update({ where: { id: imp.id }, data: { status: 'failed', error: (e as Error).message.slice(0, 1000), completedAt: new Date() } });
    if (e instanceof GscError) wrap(e);
    throw e;
  }
}

export async function latestGscImport(siteId: string) {
  return prisma.gscImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
}

/** Search Console URLs and crawled URLs can differ by a trailing slash; match both ways. */
export function gscKey(url: string) {
  try {
    const u = new URL(url);
    u.hash = '';
    const p = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.protocol}//${u.host.toLowerCase()}${p}${u.search}`;
  } catch {
    return url;
  }
}

/** Page metrics of the latest import keyed by normalised URL (for the explorer). */
export async function gscPageMap(siteId: string) {
  const imp = await latestGscImport(siteId);
  if (!imp) return null;
  const rows = await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true, impressions: true, ctr: true, position: true } });
  return { import: imp, byUrl: new Map(rows.map(r => [gscKey(r.page), r])) };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export async function gscReport(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const imp = await latestGscImport(siteId);
  const lastImport = await prisma.gscImport.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } });
  if (!imp) return { property: site.gscProperty, import: null, lastImport };

  const [daily, pages, queryRows] = await Promise.all([
    prisma.gscDailyStat.findMany({ where: { importId: imp.id }, orderBy: { date: 'asc' } }),
    prisma.gscPageStat.findMany({ where: { importId: imp.id } }),
    prisma.gscQueryStat.findMany({ where: { importId: imp.id } })
  ]);
  const clicks = daily.reduce((n, d) => n + d.clicks, 0);
  const impressions = daily.reduce((n, d) => n + d.impressions, 0);
  const position = impressions ? daily.reduce((n, d) => n + d.position * d.impressions, 0) / impressions : 0;

  // Queries aggregated across pages (impression-weighted position).
  const byQuery = new Map<string, { query: string; clicks: number; impressions: number; posW: number; pages: number; topPage: string; topImp: number }>();
  for (const r of queryRows) {
    const q = byQuery.get(r.query) ?? { query: r.query, clicks: 0, impressions: 0, posW: 0, pages: 0, topPage: r.page, topImp: -1 };
    q.clicks += r.clicks;
    q.impressions += r.impressions;
    q.posW += r.position * r.impressions;
    q.pages++;
    if (r.impressions > q.topImp) (q.topPage = r.page), (q.topImp = r.impressions);
    byQuery.set(r.query, q);
  }
  const queries = [...byQuery.values()].map(q => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, ctr: q.impressions ? q.clicks / q.impressions : 0, position: q.impressions ? q.posW / q.impressions : 0, pages: q.pages, topPage: q.topPage }));
  const fmtQ = (q: (typeof queries)[number]) => ({ ...q, ctr: round(q.ctr * 100), position: round(q.position) });
  const fmtP = (p: (typeof pages)[number]) => ({ page: p.page, clicks: p.clicks, impressions: p.impressions, ctr: round(p.ctr * 100), position: round(p.position) });

  // Expected CTR by position is rough; flag pages far below a conservative floor.
  const ctrFloor = (pos: number) => (pos <= 1.5 ? 0.15 : pos <= 3 ? 0.07 : pos <= 5 ? 0.03 : 0.01);

  // Cross with the latest completed crawl and the stored sitemap.
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const crawled = run ? await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, finalUrl: true, statusCode: true, isIndexable: true, indexabilityReason: true, inLogs: true, mimeType: true, redirectChain: true } }) : [];
  const gscByKey = new Map(pages.map(p => [gscKey(p.page), p]));
  const crawledByKey = new Map(crawled.map(c => [gscKey(c.url), c]));
  const sitemap = await prisma.sitemapUrl.findMany({ where: { siteId }, select: { url: true }, take: 100_000 });

  const nonIndexableWithImpressions = crawled
    .filter(c => !c.isIndexable && (gscByKey.get(gscKey(c.url))?.impressions ?? 0) > 0)
    .map(c => ({ ...fmtP(gscByKey.get(gscKey(c.url))!), page: c.url, statusCode: c.statusCode, reason: c.indexabilityReason }))
    .sort((a, b) => b.impressions - a.impressions);
  const html200 = crawled.filter(c => c.statusCode === 200 && c.isIndexable && /html/i.test(c.mimeType || 'text/html') && !(Array.isArray(c.redirectChain) && c.redirectChain.length));
  const indexableWithoutImpressions = html200.filter(c => !gscByKey.has(gscKey(c.url))).map(c => c.url);
  const notInCrawl = run ? pages.filter(p => p.impressions > 0 && propertyMatchesUrl(site.gscProperty ?? '', p.page) && !crawledByKey.has(gscKey(p.page))).sort((a, b) => b.impressions - a.impressions).map(fmtP) : [];
  const shownNotCrawledByGooglebot = crawled.filter(c => !c.inLogs && (gscByKey.get(gscKey(c.url))?.impressions ?? 0) > 0);
  const sitemapWithoutImpressions = sitemap.filter(s => !gscByKey.has(gscKey(s.url))).map(s => s.url);
  const hasLogs = !!(await prisma.logImport.findFirst({ where: { siteId, status: 'completed' }, select: { id: true } }));

  return {
    property: site.gscProperty,
    import: imp,
    lastImport,
    totals: { clicks, impressions, ctr: impressions ? round((clicks / impressions) * 100, 2) : 0, position: round(position), pages: pages.length, queries: byQuery.size },
    daily: daily.map(d => ({ date: d.date, clicks: d.clicks, impressions: d.impressions, ctr: round(d.ctr * 100, 2), position: round(d.position) })),
    topPages: [...pages].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 100).map(fmtP),
    topQueries: [...queries].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 100).map(fmtQ),
    /** Positions 4–15 with real demand: the cheapest wins. */
    opportunities: queries.filter(q => q.position >= 4 && q.position <= 15 && q.impressions >= 50).sort((a, b) => b.impressions - a.impressions).slice(0, 100).map(fmtQ),
    /** Good position, low CTR: title and description are the likely fix. */
    lowCtr: pages.filter(p => p.impressions >= 100 && p.position <= 10 && p.ctr < ctrFloor(p.position)).sort((a, b) => b.impressions - a.impressions).slice(0, 100).map(fmtP),
    /** Several pages of the site ranking for the same query. */
    cannibalization: queries.filter(q => q.pages >= 2 && q.impressions >= 50).sort((a, b) => b.impressions - a.impressions).slice(0, 50).map(fmtQ),
    crawl: run
      ? {
          crawlRunId: run.id,
          crawledAt: run.startedAt,
          nonIndexableWithImpressions: nonIndexableWithImpressions.slice(0, 200),
          nonIndexableWithImpressionsCount: nonIndexableWithImpressions.length,
          indexableWithoutImpressions: indexableWithoutImpressions.slice(0, 200),
          indexableWithoutImpressionsCount: indexableWithoutImpressions.length,
          notInCrawl: notInCrawl.slice(0, 200),
          notInCrawlCount: notInCrawl.length,
          shownButNotInLogsCount: hasLogs ? shownNotCrawledByGooglebot.length : null,
          shownButNotInLogs: hasLogs ? shownNotCrawledByGooglebot.slice(0, 200).map(c => ({ ...fmtP(gscByKey.get(gscKey(c.url))!), page: c.url })) : []
        }
      : null,
    sitemap: sitemap.length ? { urls: sitemap.length, withoutImpressionsCount: sitemapWithoutImpressions.length, withoutImpressions: sitemapWithoutImpressions.slice(0, 200) } : null
  };
}

/** Sites with a property in workspaces with a Google account (for the daily refresh). */
export async function sitesForDailyGsc() {
  return prisma.site.findMany({ where: { gscProperty: { not: null }, status: 'active', workspace: { googleAccount: { isNot: null } } }, select: { id: true, workspaceId: true } });
}
