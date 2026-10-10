import { prisma } from './client';
import { latestGscImport } from './gsc-service';

/**
 * "Monitoreo": optional automation (crawl, Search Console, Core Web Vitals) plus a timeline and
 * a rule-based analysis of what changed. Rules only flag changes larger than the site's usual noise,
 * and they say what happened at the same time; they never claim a cause.
 */

export interface MonitorConfig {
  gscEnabled: boolean;
  vitalsEnabled: boolean;
  vitalsCron: string;
  vitalsUrlMode: 'top' | 'manual';
  vitalsUrls: string[];
  vitalsCount: number;
  vitalsStrategies: Array<'mobile' | 'desktop'>;
}

const DEFAULTS: MonitorConfig = { gscEnabled: false, vitalsEnabled: false, vitalsCron: '0 5 * * 1', vitalsUrlMode: 'top', vitalsUrls: [], vitalsCount: 5, vitalsStrategies: ['mobile'] };

export async function getMonitorConfig(siteId: string): Promise<MonitorConfig> {
  const m = await prisma.siteMonitor.findUnique({ where: { siteId } });
  if (!m) return { ...DEFAULTS };
  return {
    gscEnabled: m.gscEnabled,
    vitalsEnabled: m.vitalsEnabled,
    vitalsCron: m.vitalsCron,
    vitalsUrlMode: m.vitalsUrlMode === 'manual' ? 'manual' : 'top',
    vitalsUrls: Array.isArray(m.vitalsUrls) ? (m.vitalsUrls as string[]) : [],
    vitalsCount: m.vitalsCount,
    vitalsStrategies: Array.isArray(m.vitalsStrategies) && m.vitalsStrategies.length ? (m.vitalsStrategies as Array<'mobile' | 'desktop'>) : ['mobile']
  };
}

export async function saveMonitorConfig(siteId: string, c: MonitorConfig) {
  const data = { gscEnabled: c.gscEnabled, vitalsEnabled: c.vitalsEnabled, vitalsCron: c.vitalsCron, vitalsUrlMode: c.vitalsUrlMode, vitalsUrls: c.vitalsUrls, vitalsCount: c.vitalsCount, vitalsStrategies: c.vitalsStrategies };
  await prisma.siteMonitor.upsert({ where: { siteId }, create: { siteId, ...data }, update: data });
  return getMonitorConfig(siteId);
}

/** URLs the weekly Core Web Vitals run measures: top pages by Search Console clicks, else the most linked pages. */
export async function pickVitalsUrls(siteId: string): Promise<string[]> {
  const cfg = await getMonitorConfig(siteId);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const host = new URL(site.canonicalUrl).hostname;
  const same = (u: string) => {
    try {
      return new URL(u).hostname === host;
    } catch {
      return false;
    }
  };
  if (cfg.vitalsUrlMode === 'manual' && cfg.vitalsUrls.length) return cfg.vitalsUrls.filter(same).slice(0, 20);
  const n = Math.min(Math.max(cfg.vitalsCount, 1), 20);
  const imp = await latestGscImport(siteId);
  if (imp) {
    const top = await prisma.gscPageStat.findMany({ where: { importId: imp.id }, orderBy: [{ clicks: 'desc' }, { impressions: 'desc' }], take: n * 3, select: { page: true } });
    const urls = [...new Set(top.map(t => t.page).filter(same))].slice(0, n);
    if (urls.length) return urls;
  }
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  if (run) {
    const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true }, orderBy: [{ depth: 'asc' }, { inlinks: 'desc' }], take: n, select: { url: true } });
    if (pages.length) return pages.map(p => p.url);
  }
  return [site.canonicalUrl];
}

// ---------------------------------------------------------------------------
// Timeline and analysis

type Tone = 'bad' | 'warn' | 'good' | 'info';
export interface Insight {
  id: string;
  tone: Tone;
  area: 'gsc' | 'crawl' | 'vitals' | 'changes' | 'alerts';
  title: string;
  detail: string;
  /** Things that happened in the same period (shown as context, never as proven causes). */
  related: string[];
  link: { nav: string; explorer?: { tab: string; filter?: string } } | null;
}

const pct = (a: number, b: number) => (b ? (a - b) / b : a ? 1 : 0);
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

export async function monitorOverview(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const config = await getMonitorConfig(siteId);
  const since = new Date(Date.now() - 120 * 86400_000);

  // ---- Search Console daily series (latest import)
  const imp = await latestGscImport(siteId);
  const daily = imp ? await prisma.gscDailyStat.findMany({ where: { importId: imp.id }, orderBy: { date: 'asc' } }) : [];

  // ---- Crawl series (full crawls only)
  const runs = (await prisma.crawlRun.findMany({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' }, take: 20 })).reverse();
  const crawlSeries = [];
  for (const r of runs) {
    const [indexable, e4, e5, avg] = await Promise.all([
      prisma.crawledPage.count({ where: { crawlRunId: r.id, isIndexable: true } }),
      prisma.crawledPage.count({ where: { crawlRunId: r.id, statusCode: { gte: 400, lt: 500 } } }),
      prisma.crawledPage.count({ where: { crawlRunId: r.id, statusCode: { gte: 500 } } }),
      prisma.crawledPage.aggregate({ where: { crawlRunId: r.id, statusCode: 200 }, _avg: { responseTimeMs: true } })
    ]);
    const cfg = r.config as { partial?: boolean } | null;
    crawlSeries.push({ id: r.id, date: r.startedAt, urls: r.urlsCrawled, indexable, errors4xx: e4, errors5xx: e5, issues: r.issuesFound, avgResponseMs: Math.round(avg._avg.responseTimeMs ?? 0), partial: !!cfg?.partial });
  }

  // ---- Core Web Vitals series: median per day and device of the measured pages
  const perf = await prisma.performanceRun.findMany({ where: { siteId, status: 'ok', createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, omit: { report: true, diagnostics: true, lab: true, field: true, resources: true } });
  const byDay = new Map<string, typeof perf>();
  for (const p of perf) {
    const k = `${day(p.createdAt)}|${p.strategy}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(p);
  }
  const vitalsSeries = [...byDay.entries()].map(([k, list]) => {
    const [d, strategy] = k.split('|');
    return {
      date: d,
      strategy,
      pages: list.length,
      score: median(list.map(x => x.performanceScore ?? NaN)),
      labLcp: median(list.map(x => x.labLcp ?? NaN)),
      fieldLcp: median(list.map(x => x.fieldLcp ?? NaN)),
      fieldInp: median(list.map(x => x.fieldInp ?? NaN)),
      fieldCls: median(list.map(x => x.fieldCls ?? NaN))
    };
  });

  // ---- Events for the timeline
  const [alerts, changes, imports] = await Promise.all([
    prisma.alert.findMany({ where: { siteId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, severity: true, message: true, createdAt: true, status: true } }),
    prisma.seoChangeProposal.findMany({ where: { siteId, appliedAt: { gte: since }, status: { in: ['applied', 'reverted'] } }, orderBy: { appliedAt: 'asc' }, select: { id: true, url: true, field: true, newValue: true, appliedAt: true, status: true } }),
    prisma.gscImport.findMany({ where: { siteId, createdAt: { gte: since } }, select: { createdAt: true, status: true } })
  ]);
  const events = [
    ...runs.map(r => ({ date: r.startedAt, kind: 'crawl' as const, label: `Crawl: ${r.urlsCrawled} URLs, ${r.issuesFound} tipos de issue` })),
    ...alerts.map(a => ({ date: a.createdAt, kind: 'alert' as const, label: a.message, severity: a.severity })),
    ...changes.map(c => ({ date: c.appliedAt!, kind: 'change' as const, label: `Cambio SEO aplicado (${c.field}) en ${path(c.url)}${c.status === 'reverted' ? ' — revertido' : ''}` }))
  ].sort((a, b) => +new Date(a.date) - +new Date(b.date));

  const insights: Insight[] = [];
  const eventsBetween = (from: Date, to: Date) =>
    events.filter(e => e.kind !== 'crawl' && +new Date(e.date) >= +from && +new Date(e.date) <= +to).map(e => `${day(e.date)} · ${e.label}`);

  // ---- Rule 1: Search Console, last 7 days vs the 7 before, against the site's usual weekly variation
  if (daily.length >= 14) {
    const sum = (rows: typeof daily, k: 'clicks' | 'impressions') => rows.reduce((s, r) => s + r[k], 0);
    const last = daily.slice(-7);
    const prev = daily.slice(-14, -7);
    const weeks: Array<{ clicks: number; impressions: number }> = [];
    for (let end = daily.length; end - 7 >= 0; end -= 7) weeks.unshift({ clicks: sum(daily.slice(end - 7, end), 'clicks'), impressions: sum(daily.slice(end - 7, end), 'impressions') });
    const wow = (k: 'clicks' | 'impressions') => weeks.slice(1, -1).map((w, i) => pct(w[k], weeks[i][k]));
    const posOf = (rows: typeof daily) => {
      const imps = sum(rows, 'impressions');
      return imps ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / imps : 0;
    };
    const from = new Date(prev[0].date);
    const to = new Date(Date.parse(last[last.length - 1].date) + 86400_000);
    const related = eventsBetween(from, to);
    for (const k of ['clicks', 'impressions'] as const) {
      const a = sum(last, k);
      const b = sum(prev, k);
      const min = k === 'clicks' ? 30 : 300;
      if (b < min) continue;
      const change = pct(a, b);
      const threshold = Math.max(0.15, 2 * stdev(wow(k)));
      if (Math.abs(change) < threshold) continue;
      const label = k === 'clicks' ? 'Clics' : 'Impresiones';
      insights.push({
        id: `gsc-${k}`,
        tone: change < 0 ? 'bad' : 'good',
        area: 'gsc',
        title: `${label} ${change < 0 ? 'bajaron' : 'subieron'} ${Math.round(Math.abs(change) * 100)} % en la última semana`,
        detail: `${a.toLocaleString('es-MX')} frente a ${b.toLocaleString('es-MX')} la semana anterior (${prev[0].date} → ${last[last.length - 1].date}). La variación normal de este sitio es de ±${Math.round(threshold * 100)} %. Google publica los datos con 2–3 días de retraso.`,
        related,
        link: { nav: 'gsc' }
      });
    }
    const pa = posOf(last);
    const pb = posOf(prev);
    if (pb && Math.abs(pa - pb) >= 1 && sum(prev, 'impressions') >= 300) {
      insights.push({
        id: 'gsc-position',
        tone: pa > pb ? 'warn' : 'good',
        area: 'gsc',
        title: `La posición media ${pa > pb ? 'empeoró' : 'mejoró'} de ${pb.toFixed(1)} a ${pa.toFixed(1)}`,
        detail: 'Promedio ponderado por impresiones de la última semana frente a la anterior. Un número menor es mejor.',
        related,
        link: { nav: 'gsc' }
      });
    }
  }

  // ---- Rule 2: latest full crawl vs the previous one
  if (crawlSeries.length >= 2) {
    const a = crawlSeries[crawlSeries.length - 1];
    const b = crawlSeries[crawlSeries.length - 2];
    const related = eventsBetween(new Date(b.date), new Date(+new Date(a.date) + 3600_000));
    const comparable = !a.partial && !b.partial;
    const idxDrop = b.indexable - a.indexable;
    if (comparable && idxDrop >= Math.max(5, b.indexable * 0.05)) {
      insights.push({ id: 'crawl-indexable', tone: 'bad', area: 'crawl', title: `${idxDrop} páginas dejaron de ser indexables`, detail: `El último crawl encontró ${a.indexable} páginas indexables; el anterior, ${b.indexable}. Revisa noindex, canonicals y errores nuevos.`, related, link: { nav: 'explorer', explorer: { tab: 'internal', filter: 'non-indexable' } } });
    } else if (comparable && a.indexable - b.indexable >= Math.max(5, b.indexable * 0.05)) {
      insights.push({ id: 'crawl-indexable-up', tone: 'info', area: 'crawl', title: `${a.indexable - b.indexable} páginas indexables nuevas`, detail: `De ${b.indexable} a ${a.indexable}. Si no publicaste contenido nuevo, revisa que no sean URLs con parámetros o duplicadas.`, related, link: { nav: 'explorer', explorer: { tab: 'internal', filter: 'indexable' } } });
    }
    if (a.errors5xx > b.errors5xx) insights.push({ id: 'crawl-5xx', tone: 'bad', area: 'crawl', title: `${a.errors5xx - b.errors5xx} errores del servidor (5xx) nuevos`, detail: `Ahora hay ${a.errors5xx} páginas con error 5xx; antes ${b.errors5xx}. Google deja de rastrear un sitio que falla.`, related, link: { nav: 'explorer', explorer: { tab: 'response', filter: '5xx' } } });
    if (a.errors4xx - b.errors4xx >= 3) insights.push({ id: 'crawl-4xx', tone: 'warn', area: 'crawl', title: `${a.errors4xx - b.errors4xx} páginas rotas (4xx) nuevas`, detail: `De ${b.errors4xx} a ${a.errors4xx}. Busca de dónde vienen los enlaces en el Explorador.`, related, link: { nav: 'explorer', explorer: { tab: 'response', filter: '4xx' } } });
    if (b.errors4xx - a.errors4xx >= 3) insights.push({ id: 'crawl-4xx-fixed', tone: 'good', area: 'crawl', title: `Se corrigieron ${b.errors4xx - a.errors4xx} páginas rotas`, detail: `Páginas 4xx: de ${b.errors4xx} a ${a.errors4xx}.`, related: [], link: null });
    if (b.avgResponseMs && a.avgResponseMs > 300 && pct(a.avgResponseMs, b.avgResponseMs) >= 0.5) insights.push({ id: 'crawl-speed', tone: 'warn', area: 'crawl', title: `El servidor responde ${Math.round(pct(a.avgResponseMs, b.avgResponseMs) * 100)} % más lento`, detail: `Tiempo medio de respuesta: ${fmtMs(b.avgResponseMs)} → ${fmtMs(a.avgResponseMs)}.`, related, link: { nav: 'crawler' } });
    if (!comparable) insights.push({ id: 'crawl-partial', tone: 'info', area: 'crawl', title: 'Uno de los dos últimos crawls fue parcial', detail: 'Tenía límites activos, así que no se comparan las páginas indexables entre ambos.', related: [], link: { nav: 'crawler' } });
  }

  // ---- Rule 3: Core Web Vitals per page and device, latest measurement vs the previous one
  const groups = new Map<string, typeof perf>();
  for (const p of perf) {
    const k = `${p.url}|${p.strategy}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const a = list[list.length - 1];
    const b = list[list.length - 2];
    const [url, strategy] = k.split('|');
    const dev = strategy === 'mobile' ? 'móvil' : 'escritorio';
    const lcpA = a.fieldLcp ?? a.labLcp;
    const lcpB = b.fieldLcp ?? b.labLcp;
    const src = a.fieldLcp !== null && b.fieldLcp !== null ? 'usuarios reales' : 'laboratorio';
    const related = eventsBetween(b.createdAt, a.createdAt);
    if (lcpA !== null && lcpB !== null && lcpA - lcpB >= 300 && pct(lcpA, lcpB) >= 0.2) {
      const latest = await prisma.performanceRun.findUnique({ where: { id: a.id }, select: { report: true } });
      const top = (latest?.report as { issues?: Array<{ title: string; metrics: string[] }> } | null)?.issues?.find(i => i.metrics.includes('LCP'));
      insights.push({ id: `vitals-lcp-${k}`, tone: lcpA > 2500 ? 'bad' : 'warn', area: 'vitals', title: `LCP ${dev} de ${path(url)} empeoró: ${fmtMs(lcpB)} → ${fmtMs(lcpA)}`, detail: `Dato de ${src}.${top ? ` Lo que más afecta el LCP ahora: "${top.title}".` : ''}`, related, link: { nav: 'vitals' } });
    } else if (lcpA !== null && lcpB !== null && lcpB - lcpA >= 300 && pct(lcpB, lcpA) >= 0.2) {
      insights.push({ id: `vitals-lcp-up-${k}`, tone: 'good', area: 'vitals', title: `LCP ${dev} de ${path(url)} mejoró: ${fmtMs(lcpB)} → ${fmtMs(lcpA)}`, detail: `Dato de ${src}.`, related, link: { nav: 'vitals' } });
    }
    const clsA = a.fieldCls ?? a.labCls;
    const clsB = b.fieldCls ?? b.labCls;
    if (clsA !== null && clsB !== null && clsA - clsB >= 0.05 && clsA > 0.1) insights.push({ id: `vitals-cls-${k}`, tone: clsA > 0.25 ? 'bad' : 'warn', area: 'vitals', title: `CLS ${dev} de ${path(url)} subió de ${clsB.toFixed(2)} a ${clsA.toFixed(2)}`, detail: 'El contenido se mueve más al cargar. Suele deberse a imágenes, anuncios o banners sin tamaño reservado.', related, link: { nav: 'vitals' } });
    if (a.fieldInp !== null && b.fieldInp !== null && a.fieldInp - b.fieldInp >= 50 && a.fieldInp > 200) insights.push({ id: `vitals-inp-${k}`, tone: a.fieldInp > 500 ? 'bad' : 'warn', area: 'vitals', title: `INP ${dev} de ${path(url)} empeoró: ${Math.round(b.fieldInp)} → ${Math.round(a.fieldInp)} ms`, detail: 'Los usuarios reales esperan más tras hacer clic o tocar. Suele ser JavaScript pesado.', related, link: { nav: 'vitals' } });
    if (a.performanceScore !== null && b.performanceScore !== null && b.performanceScore - a.performanceScore >= 10 && !insights.some(i => i.id === `vitals-lcp-${k}`)) insights.push({ id: `vitals-score-${k}`, tone: 'warn', area: 'vitals', title: `Rendimiento ${dev} de ${path(url)} bajó de ${b.performanceScore} a ${a.performanceScore}`, detail: 'Abre el reporte para ver los principales problemas.', related, link: { nav: 'vitals' } });
  }

  // ---- Rule 4: context
  const recentChanges = changes.filter(c => c.appliedAt && Date.now() - +c.appliedAt < 14 * 86400_000);
  if (recentChanges.length) insights.push({ id: 'changes', tone: 'info', area: 'changes', title: `${recentChanges.length} cambios SEO aplicados en las últimas 2 semanas`, detail: 'Los efectos en Google tardan días o semanas en verse. Compara clics y posición de esas páginas en Search Console más adelante.', related: recentChanges.slice(0, 5).map(c => `${day(c.appliedAt!)} · ${c.field} en ${path(c.url)}`), link: { nav: 'seochanges' } });
  const open = alerts.filter(a => a.status === 'open');
  if (open.length) insights.push({ id: 'alerts', tone: open.some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH') ? 'bad' : 'warn', area: 'alerts', title: `${open.length} ${open.length === 1 ? 'alerta' : 'alertas'} sin revisar`, detail: 'Regresiones detectadas al comparar crawls.', related: open.slice(-5).map(a => `${day(a.createdAt)} · ${a.message}`), link: { nav: 'alerts' } });

  const rank: Record<Tone, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  insights.sort((x, y) => rank[x.tone] - rank[y.tone]);

  return {
    site: { id: site.id, name: site.name, crawlSchedule: site.crawlSchedule, gscProperty: site.gscProperty },
    config,
    gsc: { importedAt: imp?.completedAt ?? null, daily: daily.map(d => ({ date: d.date, clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position })) },
    crawl: crawlSeries,
    vitals: vitalsSeries,
    events: events.slice(-60),
    insights,
    lastImports: imports.length
  };
}
