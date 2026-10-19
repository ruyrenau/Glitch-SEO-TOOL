import { prisma } from './client';
import { gscKey, latestGscImport } from './gsc-service';

/**
 * Keyword cannibalization from Search Console: queries for which two or more pages of the site get a real share
 * of the impressions, so Google alternates between them. Each conflict gets a severity, the page that should
 * win (most clicks, then impressions) and a concrete action for every other page, using the latest crawl
 * (title similarity, indexability, internal links).
 */

export interface CannibalOptions {
  /** Minimum impressions of the query (all pages together). */
  minImpressions?: number;
  /** A page counts as competing when it gets at least this share of the query's impressions. */
  minShare?: number;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const norm = (q: string) => q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const tokens = (t: string | null | undefined) => new Set(norm(t ?? '').split(/[^a-z0-9ñ]+/).filter(w => w.length > 2));
function similarity(a: string | null | undefined, b: string | null | undefined) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export async function cannibalizationReport(siteId: string, opts: CannibalOptions = {}) {
  const minImpressions = opts.minImpressions ?? 30;
  const minShare = opts.minShare ?? 0.1;
  const imp = await latestGscImport(siteId);
  if (!imp) return { import: null, totals: null, conflicts: [], pairs: [] };
  const rows = await prisma.gscQueryStat.findMany({ where: { importId: imp.id } });

  // Group by normalized query ("Cómo" and "como" are the same search).
  const groups = new Map<string, { query: string; byPage: Map<string, { page: string; clicks: number; impressions: number; posW: number }> }>();
  for (const r of rows) {
    const key = norm(r.query);
    const g = groups.get(key) ?? { query: r.query, byPage: new Map() };
    const p = g.byPage.get(r.page) ?? { page: r.page, clicks: 0, impressions: 0, posW: 0 };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.posW += r.position * r.impressions;
    g.byPage.set(r.page, p);
    groups.set(key, g);
  }

  // Crawl context for the recommendations.
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const crawled = run ? await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, finalUrl: true, title: true, h1: true, statusCode: true, isIndexable: true, indexabilityReason: true, canonical: true } }) : [];
  const byKey = new Map<string, (typeof crawled)[number]>();
  for (const c of crawled) {
    byKey.set(gscKey(c.url), c);
    if (c.finalUrl) byKey.set(gscKey(c.finalUrl), byKey.get(gscKey(c.finalUrl)) ?? c);
  }
  const linked = async (from: string, to: string) => (run ? (await prisma.crawledLink.count({ where: { crawlRunId: run.id, sourceUrl: from, targetUrl: to } })) > 0 : null);

  const conflicts = [];
  for (const g of groups.values()) {
    const all = [...g.byPage.values()];
    const total = all.reduce((n, p) => n + p.impressions, 0);
    if (total < minImpressions) continue;
    const competing = all.filter(p => p.impressions / total >= minShare && p.impressions >= 5);
    if (competing.length < 2) continue;
    const clicks = all.reduce((n, p) => n + p.clicks, 0);
    const pages = competing
      .map(p => {
        const c = byKey.get(gscKey(p.page));
        return { page: p.page, clicks: p.clicks, impressions: p.impressions, share: round((p.impressions / total) * 100, 0), position: round(p.posW / (p.impressions || 1)), title: c?.title ?? null, h1: c?.h1 ?? null, statusCode: c?.statusCode ?? null, indexable: c ? c.isIndexable : null, reason: c?.indexabilityReason ?? null };
      })
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    const [winner, second] = pages;
    const best = Math.min(...pages.map(p => p.position));
    // High: two pages split the demand evenly, near each other, on pages 1–2 of Google.
    const severity = second.share >= 30 && Math.abs(winner.position - second.position) <= 10 && best <= 20 ? 'alta' : second.share >= 20 ? 'media' : 'baja';

    const actions: Array<{ page: string; action: string }> = [];
    for (const p of pages.slice(1)) {
      let action: string;
      if (p.indexable === false || (p.statusCode && p.statusCode !== 200)) action = `Ya no es indexable (${p.reason ?? `HTTP ${p.statusCode}`}). Google todavía la muestra: confirma que la redirección o el canonical apunten a la página principal y espera a que la reprocese.`;
      else if (similarity(p.title, winner.title) >= 0.5 || similarity(p.h1, winner.h1) >= 0.5) action = 'Trata el mismo tema que la principal: fusiona lo útil en la principal y redirige esta con un 301 (o pon canonical hacia la principal si debe seguir existiendo).';
      else action = 'Responde a otra intención: ajusta su título y H1 para que no apunten a esta búsqueda, y enlaza desde ella a la principal usando la consulta como texto del enlace.';
      const l = await linked(p.page, winner.page);
      if (l === false && !/redirige/.test(action)) action += ' Hoy no enlaza a la principal.';
      actions.push({ page: p.page, action });
    }
    conflicts.push({ query: g.query, impressions: total, clicks, ctr: round(total ? (clicks / total) * 100 : 0), severity, winner: winner.page, pages, actions });
  }
  const rank = { alta: 0, media: 1, baja: 2 } as Record<string, number>;
  conflicts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.impressions - a.impressions);

  // Page pairs that compete across several queries: the real structural problem.
  const pairMap = new Map<string, { a: string; b: string; queries: string[]; impressions: number }>();
  for (const c of conflicts) {
    const ps = c.pages.map(p => p.page);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const [a, b] = [ps[i], ps[j]].sort();
        const k = `${a}|${b}`;
        const e = pairMap.get(k) ?? { a, b, queries: [], impressions: 0 };
        e.queries.push(c.query);
        e.impressions += c.impressions;
        pairMap.set(k, e);
      }
  }
  const pairs = [...pairMap.values()].filter(p => p.queries.length >= 2).sort((a, b) => b.queries.length - a.queries.length || b.impressions - a.impressions).slice(0, 50).map(p => ({ ...p, queries: p.queries.slice(0, 20), count: p.queries.length, titleSimilarity: round(similarity(byKey.get(gscKey(p.a))?.title, byKey.get(gscKey(p.b))?.title) * 100, 0) }));

  return {
    import: { startDate: imp.startDate, endDate: imp.endDate, property: imp.property },
    crawl: run ? { id: run.id, startedAt: run.startedAt } : null,
    options: { minImpressions, minShare },
    totals: { conflicts: conflicts.length, high: conflicts.filter(c => c.severity === 'alta').length, impressions: conflicts.reduce((n, c) => n + c.impressions, 0), clicks: conflicts.reduce((n, c) => n + c.clicks, 0), pagesInvolved: new Set(conflicts.flatMap(c => c.pages.map(p => p.page))).size },
    conflicts: conflicts.slice(0, 500),
    pairs
  };
}
