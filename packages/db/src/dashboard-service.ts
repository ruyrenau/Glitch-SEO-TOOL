import { prisma } from './client';
import { latestGscImport } from './gsc-service';

/**
 * Overview desk: the headline result of every module for one site, from stored data only
 * (no external calls, no recomputation), so it loads fast. Each section is null when the
 * module has not been used yet.
 */

const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const change = (now: number, prev: number) => (prev ? now / prev - 1 : null);

/** Sums of the last 28 days of a daily series and of the 28 before (by the series' own last date). */
function windows<T extends { date: string }>(rows: T[], pick: (r: T) => number) {
  if (!rows.length) return null;
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
  const end = Date.parse(last);
  const cur = iso(end - 27 * DAY);
  const prevStart = iso(end - 55 * DAY);
  let now = 0;
  let prev = 0;
  let prevDays = 0;
  for (const r of rows) {
    if (r.date >= cur) now += pick(r);
    else if (r.date >= prevStart) {
      prev += pick(r);
      prevDays++;
    }
  }
  return { now, prev: prevDays ? prev : null, until: last };
}

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null; // one broken module never takes down the desk
  }
}

export async function siteDashboard(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });

  const crawl = safe(async () => {
    const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
    if (!run) return null;
    const [total, indexable, s4, s5, issues, readiness] = await Promise.all([
      prisma.crawledPage.count({ where: { crawlRunId: run.id } }),
      prisma.crawledPage.count({ where: { crawlRunId: run.id, isIndexable: true } }),
      prisma.crawledPage.count({ where: { crawlRunId: run.id, statusCode: { gte: 400, lt: 500 } } }),
      prisma.crawledPage.count({ where: { crawlRunId: run.id, statusCode: { gte: 500 } } }),
      prisma.issue.groupBy({ by: ['severity'], where: { siteId, status: 'open' }, _count: true }),
      prisma.aiReadinessPage.aggregate({ where: { crawlRunId: run.id }, _avg: { score: true }, _count: true })
    ]);
    return {
      date: run.startedAt,
      pages: total,
      indexable,
      errors4xx: s4,
      errors5xx: s5,
      issues: Object.fromEntries(issues.map(i => [i.severity, i._count])) as Record<string, number>,
      aiReadiness: readiness._count ? { average: Math.round(readiness._avg.score ?? 0), pages: readiness._count } : null
    };
  });

  const gsc = safe(async () => {
    const imp = await latestGscImport(siteId);
    if (!imp) return null;
    const days = await prisma.gscDailyStat.findMany({ where: { importId: imp.id }, select: { date: true, clicks: true, impressions: true, position: true } });
    const c = windows(days, r => r.clicks);
    const i = windows(days, r => r.impressions);
    const recent = days.filter(d => c && d.date > iso(Date.parse(c.until) - 28 * DAY));
    const impr = recent.reduce((s, d) => s + d.impressions, 0);
    const pos = impr ? recent.reduce((s, d) => s + d.position * d.impressions, 0) / impr : null;
    return { until: c?.until ?? imp.endDate, clicks: c?.now ?? 0, clicksChange: c?.prev ? change(c.now, c.prev) : null, impressions: i?.now ?? 0, impressionsChange: i?.prev ? change(i.now, i.prev) : null, position: pos === null ? null : Math.round(pos * 10) / 10 };
  });

  const ga4 = safe(async () => {
    const imp = await prisma.ga4Import.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    if (!imp) return null;
    const days = await prisma.ga4DailyStat.findMany({ where: { importId: imp.id }, select: { date: true, channel: true, sessions: true, keyEvents: true } });
    const s = windows(days, r => r.sessions);
    const k = windows(days, r => r.keyEvents);
    const ai = windows(days.filter(d => /ai|ia|llm|chatgpt/i.test(d.channel)), r => r.sessions);
    return { until: s?.until ?? imp.endDate, sessions: s?.now ?? 0, sessionsChange: s?.prev ? change(s.now, s.prev) : null, keyEvents: Math.round(k?.now ?? 0), keyEventsChange: k?.prev ? change(k.now, k.prev) : null, aiSessions: ai?.now ?? 0 };
  });

  const vitals = safe(async () => {
    const runs = await prisma.performanceRun.findMany({ where: { siteId, status: 'ok' }, orderBy: { createdAt: 'desc' }, take: 200, select: { url: true, strategy: true, performanceScore: true, fieldLcp: true, fieldInp: true, fieldCls: true, createdAt: true } });
    if (!runs.length) return null;
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latest.has(`${r.url}|${r.strategy}`)) latest.set(`${r.url}|${r.strategy}`, r);
    const list = [...latest.values()];
    const mobile = list.filter(r => r.strategy === 'mobile');
    const scores = (mobile.length ? mobile : list).map(r => r.performanceScore).filter((x): x is number => x !== null);
    const field = list.filter(r => r.fieldLcp !== null);
    const pass = field.filter(r => (r.fieldLcp ?? 1e9) <= 2500 && (r.fieldInp ?? 0) <= 200 && (r.fieldCls ?? 0) <= 0.1).length;
    return { date: runs[0].createdAt, urls: new Set(list.map(r => r.url)).size, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, slow: scores.filter(s => s < 50).length, fieldPages: field.length, fieldPassing: pass };
  });

  const serp = safe(async () => {
    const kws = await prisma.serpKeyword.findMany({ where: { siteId, active: true }, select: { id: true, snapshots: { orderBy: { date: 'desc' }, take: 1, select: { date: true, position: true, features: true, aiCitesUs: true } } } });
    if (!kws.length) return null;
    const snaps = kws.map(k => k.snapshots[0]).filter(Boolean);
    const withAi = snaps.filter(s => (s.features as string[]).includes('ai_overview'));
    const ranked = snaps.filter(s => s.position !== null);
    return {
      keywords: kws.length,
      checked: snaps.length,
      date: snaps.reduce<string | null>((m, s) => (!m || s.date > m ? s.date : m), null),
      top3: ranked.filter(s => s.position! <= 3).length,
      top10: ranked.filter(s => s.position! <= 10).length,
      avgPosition: ranked.length ? Math.round((ranked.reduce((a, s) => a + s.position!, 0) / ranked.length) * 10) / 10 : null,
      aiOverviews: withAi.length,
      aiCitesUs: withAi.filter(s => s.aiCitesUs).length
    };
  });

  const aiVisibility = safe(async () => {
    const prompts = await prisma.aiPrompt.count({ where: { siteId, active: true } });
    if (!prompts) return null;
    const last = await prisma.aiObservation.findFirst({ where: { siteId }, orderBy: { date: 'desc' }, select: { date: true } });
    if (!last) return { prompts, observations: 0, date: null, mentionRate: null, citeRate: null };
    const since = iso(Date.parse(last.date) - 30 * DAY);
    const obs = await prisma.aiObservation.findMany({ where: { siteId, date: { gte: since } }, select: { mentioned: true, cited: true } });
    return { prompts, observations: obs.length, date: last.date, mentionRate: obs.length ? obs.filter(o => o.mentioned).length / obs.length : null, citeRate: obs.length ? obs.filter(o => o.cited).length / obs.length : null };
  });

  const agents = safe(async () => {
    const a = await prisma.agentAudit.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    const catalog = await prisma.agentCatalog.findUnique({ where: { siteId }, select: { items: true, updatedAt: true } });
    if (!a && !catalog) return null;
    const s = a?.summary as { average?: number; tasks?: Array<{ id: string; label: string; status: string }> } | null;
    return { date: a?.completedAt ?? null, average: s?.average ?? null, tasks: s?.tasks?.map(t => ({ label: t.label, status: t.status })) ?? [], catalogItems: catalog ? (catalog.items as unknown[]).length : null };
  });

  const backlinks = safe(async () => {
    const imp = await prisma.backlinkImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    if (!imp) return null;
    const by = await prisma.backlink.groupBy({ by: ['status'], where: { importId: imp.id }, _count: true });
    const n = (s: string) => by.find(b => b.status === s)?._count ?? 0;
    const [domains, toxic] = await Promise.all([
      prisma.backlink.findMany({ where: { importId: imp.id, status: 'live' }, distinct: ['sourceDomain'], select: { sourceDomain: true } }),
      prisma.backlink.count({ where: { importId: imp.id, toxicScore: { gte: 50 } } })
    ]);
    return { date: imp.completedAt ?? imp.createdAt, total: imp.rows, live: n('live'), lost: n('lost'), domains: domains.length, toxic };
  });

  const entities = safe(async () => {
    const [org, authors, pages] = await Promise.all([prisma.entityProfile.findUnique({ where: { siteId } }), prisma.entityAuthor.count({ where: { siteId } }), prisma.entityPage.count({ where: { siteId } })]);
    if (!org && !authors && !pages) return null;
    const o = (org?.org ?? {}) as { name?: string; sameAs?: string[] };
    return { orgName: o.name ?? null, sameAs: o.sameAs?.length ?? 0, authors, pages };
  });

  const experiments = safe(async () => {
    const list = await prisma.seoExperiment.findMany({ where: { siteId }, orderBy: { changeDate: 'desc' }, select: { name: true, changeDate: true, analysis: true } });
    if (!list.length) return null;
    const v = (x: (typeof list)[number]) => (x.analysis as { verdict?: string; effect?: { clicks: number | null } } | null) ?? null;
    return {
      total: list.length,
      positive: list.filter(x => v(x)?.verdict === 'positive').length,
      negative: list.filter(x => v(x)?.verdict === 'negative').length,
      pending: list.filter(x => !v(x) || ['waiting', 'inconclusive', 'low_data'].includes(v(x)!.verdict!)).length,
      latest: list.slice(0, 3).map(x => ({ name: x.name, changeDate: x.changeDate, verdict: v(x)?.verdict ?? null, effect: v(x)?.effect?.clicks ?? null }))
    };
  });

  const gaps = safe(async () => {
    const g = await prisma.contentGap.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    if (!g) return null;
    const r = g.result as { searched: number; keywords: Array<{ kind: string }>; clusters: Array<{ lead: string; ownUrl: string | null }>; briefs: Record<string, unknown> };
    return { date: g.completedAt, searched: r.searched, missing: r.keywords.filter(k => k.kind === 'missing').length, weak: r.keywords.filter(k => k.kind === 'weak').length, clusters: r.clusters.length, briefs: Object.keys(r.briefs).length, top: r.clusters.slice(0, 3).map(c => ({ lead: c.lead, action: c.ownUrl ? 'improve' : 'new' })) };
  });

  const wordpress = safe(async () => {
    const conn = await prisma.wordPressConnection.findUnique({ where: { siteId }, select: { status: true, remoteName: true } });
    const by = await prisma.seoChangeProposal.groupBy({ by: ['status'], where: { siteId }, _count: true });
    if (!conn && !by.length) return null;
    const n = (s: string) => by.find(b => b.status === s)?._count ?? 0;
    return { connected: conn?.status === 'ok', name: conn?.remoteName ?? null, proposed: n('proposed'), approved: n('approved'), applied: n('applied'), failed: n('failed') + n('conflict') };
  });

  const monitor = safe(async () => {
    const m = await prisma.siteMonitor.findUnique({ where: { siteId } });
    return m ? { gsc: m.gscEnabled, vitals: m.vitalsEnabled, serp: m.serpEnabled, notify: m.notifyEnabled } : null;
  });

  const [c, g, a4, v, s, ai, ag, bl, en, ex, gp, wp, mo] = await Promise.all([crawl, gsc, ga4, vitals, serp, aiVisibility, agents, backlinks, entities, experiments, gaps, wordpress, monitor]);
  return { site: { id: site.id, name: site.name, gscProperty: site.gscProperty }, crawl: c, gsc: g, ga4: a4, vitals: v, serp: s, aiVisibility: ai, agents: ag, backlinks: bl, entities: en, experiments: ex, gaps: gp, wordpress: wp, monitor: mo };
}
