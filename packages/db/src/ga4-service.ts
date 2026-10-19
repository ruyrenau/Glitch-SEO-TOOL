import { decryptSecret } from '@glitch/core';
import { AI_SOURCE_REGEX, GA4_SCOPE, Ga4Client, GscError, aiEngineOf, googleConfig } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';

/**
 * Google Analytics 4 (read-only): what happens after the click. Organic landing pages, sessions referred by AI
 * assistants, and a cross with Search Console. Uses the Google account connected in Search Console.
 */

const KEEP_IMPORTS = 3;
const METRICS = ['sessions', 'totalUsers', 'engagedSessions', 'userEngagementDuration', 'keyEvents', 'totalRevenue'];
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const day = (d: Date) => d.toISOString().slice(0, 10);

function wrap(e: unknown): never {
  if (e instanceof GscError) {
    const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'TOKEN_REVOKED' ? 401 : e.code === 'QUOTA' ? 429 : 502;
    throw new WorkflowError(`GA4_${e.code}`, e.message, status);
  }
  throw e;
}

async function clientFor(workspaceId: string) {
  const cfg = googleConfig();
  if (!cfg) throw new WorkflowError('GSC_NOT_CONFIGURED', 'Falta configurar GSC_CLIENT_ID y GSC_CLIENT_SECRET en el servidor.', 400);
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId } });
  if (!acc) throw new WorkflowError('GSC_NOT_CONNECTED', 'Conecta primero una cuenta de Google (sección Search Console o Google Analytics).', 400);
  if (!acc.scope.includes(GA4_SCOPE)) throw new WorkflowError('GA4_SCOPE_MISSING', 'La cuenta de Google se conectó sin permiso de Analytics. Pulsa "Volver a conectar con Google" y acepta "Ver tus datos de Google Analytics".', 400);
  return new Ga4Client(cfg, decryptSecret(acc.refreshTokenEnc));
}

export async function ga4Status(workspaceId: string) {
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId } });
  return { configured: !!googleConfig(), connected: !!acc, email: acc?.email ?? null, analytics: !!acc?.scope.includes(GA4_SCOPE) };
}

export async function ga4Properties(workspaceId: string) {
  const c = await clientFor(workspaceId);
  return (await c.listProperties().catch(wrap)).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function setSiteGa4Property(siteId: string, property: string | null, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  let name: string | null = null;
  if (property) {
    const p = (await ga4Properties(site.workspaceId)).find(x => x.property === property);
    if (!p) throw new WorkflowError('GA4_PROPERTY_NOT_FOUND', 'Tu cuenta de Google no tiene acceso a esa propiedad de Analytics.', 400);
    name = p.account ? `${p.displayName} (${p.account})` : p.displayName;
  }
  const u = await prisma.site.update({ where: { id: siteId }, data: { ga4Property: property, ga4PropertyName: name } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'ga4.property_set', entity: 'Site', entityId: siteId, details: { property } });
  return { ga4Property: u.ga4Property, ga4PropertyName: u.ga4PropertyName };
}

const statRow = (importId: string, kind: string, page: string, source: string, m: number[]) => ({
  importId,
  kind,
  page: page || '(not set)',
  source,
  sessions: Math.round(m[0]),
  users: Math.round(m[1]),
  engagedSessions: Math.round(m[2]),
  engagementSec: m[3],
  keyEvents: m[4],
  revenue: m[5]
});

export async function runGa4Import(siteId: string, opts: { days?: number; log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  if (!site.ga4Property) throw new WorkflowError('GA4_NO_PROPERTY', 'Elige la propiedad de Google Analytics de este sitio.', 400);
  const client = await clientFor(site.workspaceId);
  const days = Math.min(Math.max(opts.days ?? 90, 7), 480);
  const end = new Date(Date.now() - 86400_000);
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  const imp = await prisma.ga4Import.create({ data: { siteId, property: site.ga4Property, startDate: day(start), endDate: day(end) } });
  const log = opts.log ?? (() => undefined);
  try {
    const q = { startDate: imp.startDate, endDate: imp.endDate };
    const organic = await client.report(site.ga4Property, { ...q, dimensions: ['landingPagePlusQueryString'], metrics: METRICS, filters: [{ fieldName: 'sessionDefaultChannelGroup', value: 'Organic Search' }], orderByMetric: 'sessions', maxRows: 50_000 });
    log(`${organic.length} páginas de entrada orgánicas`);
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const ai = await client.report(site.ga4Property, { ...q, dimensions: ['landingPagePlusQueryString', 'sessionSource'], metrics: METRICS, filters: [{ fieldName: 'sessionSource', value: AI_SOURCE_REGEX, matchType: 'FULL_REGEXP' }], orderByMetric: 'sessions', maxRows: 50_000 });
    log(`${ai.length} combinaciones de página y asistente de IA`);
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const daily = await client.report(site.ga4Property, { ...q, dimensions: ['date', 'sessionDefaultChannelGroup'], metrics: ['sessions', 'keyEvents'], maxRows: 20_000 });
    log(`${daily.length} filas diarias por canal`);

    const pages = [...organic.map(r => statRow(imp.id, 'organic', r.dimensions[0], '', r.metrics)), ...ai.map(r => statRow(imp.id, 'ai', r.dimensions[0], r.dimensions[1], r.metrics))];
    for (let i = 0; i < pages.length; i += 1000) await prisma.ga4PageStat.createMany({ data: pages.slice(i, i + 1000) });
    const d = daily.map(r => ({ importId: imp.id, date: `${r.dimensions[0].slice(0, 4)}-${r.dimensions[0].slice(4, 6)}-${r.dimensions[0].slice(6, 8)}`, channel: r.dimensions[1], sessions: Math.round(r.metrics[0]), keyEvents: r.metrics[1] }));
    for (let i = 0; i < d.length; i += 1000) await prisma.ga4DailyStat.createMany({ data: d.slice(i, i + 1000) });
    const done = await prisma.ga4Import.update({ where: { id: imp.id }, data: { status: 'completed', pageRows: pages.length, completedAt: new Date() } });

    const old = await prisma.ga4Import.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, skip: KEEP_IMPORTS, select: { id: true } });
    if (old.length) await prisma.ga4Import.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'ga4.imported', entity: 'Ga4Import', entityId: imp.id, details: { property: site.ga4Property, startDate: imp.startDate, endDate: imp.endDate, rows: pages.length } });
    return done;
  } catch (e) {
    await prisma.ga4Import.update({ where: { id: imp.id }, data: { status: 'failed', error: (e as Error).message.slice(0, 1000), completedAt: new Date() } });
    if (e instanceof GscError) wrap(e);
    throw e;
  }
}

export async function latestGa4Import(siteId: string) {
  return prisma.ga4Import.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
}

type Agg = { sessions: number; users: number; engagedSessions: number; engagementSec: number; keyEvents: number; revenue: number };
const zero = (): Agg => ({ sessions: 0, users: 0, engagedSessions: 0, engagementSec: 0, keyEvents: 0, revenue: 0 });
const add = (a: Agg, r: Agg) => {
  a.sessions += r.sessions;
  a.users += r.users;
  a.engagedSessions += r.engagedSessions;
  a.engagementSec += r.engagementSec;
  a.keyEvents += r.keyEvents;
  a.revenue += r.revenue;
  return a;
};
const fmtAgg = (a: Agg) => ({
  sessions: a.sessions,
  users: a.users,
  engagementRate: a.sessions ? round((a.engagedSessions / a.sessions) * 100) : 0,
  avgEngagementSec: a.sessions ? Math.round(a.engagementSec / a.sessions) : 0,
  keyEvents: round(a.keyEvents),
  conversionRate: a.sessions ? round((a.keyEvents / a.sessions) * 100, 2) : 0,
  revenue: round(a.revenue, 2)
});

export async function ga4Report(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const imp = await latestGa4Import(siteId);
  const lastImport = await prisma.ga4Import.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } });
  if (!imp) return { property: site.ga4Property, propertyName: site.ga4PropertyName, import: null, lastImport };

  const [rows, daily] = await Promise.all([prisma.ga4PageStat.findMany({ where: { importId: imp.id } }), prisma.ga4DailyStat.findMany({ where: { importId: imp.id }, orderBy: { date: 'asc' } })]);
  let origin = site.canonicalUrl;
  try {
    origin = new URL(site.canonicalUrl).origin;
  } catch {
    /* keep */
  }
  const full = (p: string) => (/^https?:\/\//.test(p) ? p : `${origin}${p.startsWith('/') ? '' : '/'}${p}`);

  // Search Console clicks and crawl titles by page.
  const gscImp = await latestGscImport(siteId);
  const gsc = new Map((gscImp ? await prisma.gscPageStat.findMany({ where: { importId: gscImp.id }, select: { page: true, clicks: true, impressions: true, position: true } }) : []).map(p => [gscKey(p.page), p]));
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const titles = run ? new Map((await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, title: true } })).map(p => [gscKey(p.url), p.title])) : new Map<string, string | null>();

  const organicRows = rows.filter(r => r.kind === 'organic');
  const organic = organicRows.reduce((a, r) => add(a, r), zero());
  const organicPages = organicRows
    .map(r => {
      const url = full(r.page);
      const g = gsc.get(gscKey(url));
      return { page: r.page, url, title: titles.get(gscKey(url)) ?? null, ...fmtAgg(r), clicks: g?.clicks ?? null, impressions: g?.impressions ?? null, position: g ? round(g.position) : null };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // AI assistants: by engine and by page.
  const byEngine = new Map<string, Agg>();
  const aiPages = new Map<string, { agg: Agg; engines: Map<string, number> }>();
  for (const r of rows.filter(x => x.kind === 'ai')) {
    const engine = aiEngineOf(r.source) ?? r.source;
    add(byEngine.get(engine) ?? byEngine.set(engine, zero()).get(engine)!, r);
    const e = aiPages.get(r.page) ?? { agg: zero(), engines: new Map() };
    add(e.agg, r);
    e.engines.set(engine, (e.engines.get(engine) ?? 0) + r.sessions);
    aiPages.set(r.page, e);
  }
  const aiTotal = [...byEngine.values()].reduce((a, r) => add(a, r), zero());

  // Channels and days.
  const channels = new Map<string, { sessions: number; keyEvents: number }>();
  const days = new Map<string, { organic: number; total: number }>();
  for (const d of daily) {
    const c = channels.get(d.channel) ?? { sessions: 0, keyEvents: 0 };
    c.sessions += d.sessions;
    c.keyEvents += d.keyEvents;
    channels.set(d.channel, c);
    const x = days.get(d.date) ?? { organic: 0, total: 0 };
    x.total += d.sessions;
    if (d.channel === 'Organic Search') x.organic += d.sessions;
    days.set(d.date, x);
  }
  const allSessions = [...channels.values()].reduce((n, c) => n + c.sessions, 0);

  // Clicks from Google that do not engage: the page does not deliver what the result promised.
  const lowEngagement = organicPages.filter(p => p.sessions >= 20 && p.engagementRate < 40).slice(0, 100);

  return {
    property: site.ga4Property,
    propertyName: site.ga4PropertyName,
    import: { id: imp.id, startDate: imp.startDate, endDate: imp.endDate, completedAt: imp.completedAt },
    lastImport,
    totals: { organic: fmtAgg(organic), allSessions, organicShare: allSessions ? round((organic.sessions / allSessions) * 100) : 0, ai: fmtAgg(aiTotal), aiShare: allSessions ? round((aiTotal.sessions / allSessions) * 100, 2) : 0 },
    channels: [...channels.entries()].map(([channel, c]) => ({ channel, sessions: c.sessions, keyEvents: round(c.keyEvents), share: allSessions ? round((c.sessions / allSessions) * 100) : 0 })).sort((a, b) => b.sessions - a.sessions),
    daily: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    organicPages: organicPages.slice(0, 500),
    lowEngagement,
    ai: {
      engines: [...byEngine.entries()].map(([engine, a]) => ({ engine, ...fmtAgg(a) })).sort((a, b) => b.sessions - a.sessions),
      pages: [...aiPages.entries()]
        .map(([page, e]) => ({ page, url: full(page), title: titles.get(gscKey(full(page))) ?? null, ...fmtAgg(e.agg), engines: [...e.engines.entries()].map(([engine, sessions]) => ({ engine, sessions })).sort((a, b) => b.sessions - a.sessions) }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 300)
    },
    hasGsc: !!gscImp
  };
}
