import zlib from 'zlib';
import { fingerprint, mainText, nearDuplicatePairs } from '@glitch/crawler';
import { prisma } from './client';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
export const FINGERPRINT_MAX_PAGES = 10_000;

// ---------------------------------------------------------------------------
// 8. Duplicate, near-duplicate and thin content
// ---------------------------------------------------------------------------

async function ensureFingerprints(crawlRunId: string) {
  if (await prisma.contentFingerprint.count({ where: { crawlRunId } })) return;
  const ids = await prisma.crawledPage.findMany({ where: { crawlRunId, statusCode: 200, mimeType: { contains: 'html' }, htmlGz: { not: null } }, select: { id: true }, orderBy: { depth: 'asc' }, take: FINGERPRINT_MAX_PAGES });
  for (let i = 0; i < ids.length; i += 200) {
    const pages = await prisma.crawledPage.findMany({ where: { id: { in: ids.slice(i, i + 200).map(p => p.id) } }, select: { url: true, htmlGz: true } });
    await prisma.contentFingerprint.createMany({
      data: pages.map(p => {
        const f = fingerprint(mainText(zlib.gunzipSync(Buffer.from(p.htmlGz!)).toString('utf8')));
        return { crawlRunId, url: p.url, words: f.words, textHash: f.textHash, minhash: f.minhash };
      })
    });
  }
}

async function pickRun(siteId: string, crawlRunId?: string) {
  const run = crawlRunId
    ? await prisma.crawlRun.findFirst({ where: { id: crawlRunId, siteId } })
    : await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', detailPurgedAt: null }, orderBy: { startedAt: 'desc' } });
  if (crawlRunId && !run) throw new WorkflowError('CRAWL_NOT_FOUND', 'Ese crawl no existe en este sitio.', 404);
  if (run?.detailPurgedAt) throw new WorkflowError('CRAWL_PURGED', 'El HTML de ese crawl ya se borró para ahorrar espacio. Elige un crawl más reciente.', 409);
  return run;
}

export async function duplicateContentReport(siteId: string, opts: { crawlRunId?: string; threshold?: number; minWords?: number } = {}) {
  const threshold = opts.threshold ?? 0.85;
  const minWords = opts.minWords ?? 200;
  const run = await pickRun(siteId, opts.crawlRunId);
  if (!run) return { crawl: null, options: { threshold, minWords }, totals: null, exact: [], near: [], thin: [] };
  await ensureFingerprints(run.id);

  const [fps, pages, gsc] = await Promise.all([
    prisma.contentFingerprint.findMany({ where: { crawlRunId: run.id } }),
    prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200 }, select: { url: true, title: true, h1: true, canonical: true, isIndexable: true, indexabilityReason: true, inlinks: true, depth: true } }),
    latestGscImport(siteId).then(imp => (imp ? prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true, impressions: true } }) : []))
  ]);
  const meta = new Map(pages.map(p => [p.url, p]));
  const g = new Map(gsc.map(r => [gscKey(r.page), r]));
  const info = (url: string, words: number) => {
    const m = meta.get(url);
    const s = g.get(gscKey(url));
    return { url, title: m?.title ?? null, words, indexable: m?.isIndexable ?? true, reason: m?.indexabilityReason ?? null, canonical: m?.canonical ?? null, inlinks: m?.inlinks ?? 0, clicks: s?.clicks ?? null, impressions: s?.impressions ?? null };
  };
  type Info = ReturnType<typeof info>;
  // Keep the page with the most clicks, then the most internal links, then the shortest URL.
  const keeperOf = (list: Info[]) => [...list].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0) || b.inlinks - a.inlinks || a.url.length - b.url.length)[0];
  const advise = (p: Info, keeper: Info) => {
    if (!p.indexable) return { status: 'resuelto', action: `Ya no se indexa (${p.reason ?? 'canonical o noindex'}): no compite.` };
    if (p.canonical && gscKey(p.canonical) === gscKey(keeper.url)) return { status: 'resuelto', action: 'Ya tiene canonical hacia la página principal.' };
    return { status: 'pendiente', action: (p.clicks ?? 0) > 0 ? 'Recibe tráfico: fusiona su contenido útil en la principal y redirige con 301, o reescríbela para que sea distinta.' : 'Pon canonical hacia la principal, redirige con 301 o reescríbela con contenido propio.' };
  };
  const group = (list: Info[], similarity: number) => {
    const keeper = keeperOf(list);
    const others = list.filter(p => p.url !== keeper.url).map(p => ({ ...p, ...advise(p, keeper) }));
    return { similarity: round(similarity * 100, 0), keeper, pages: others, pending: others.filter(o => o.status === 'pendiente').length, impressions: list.reduce((n, p) => n + (p.impressions ?? 0), 0) };
  };

  // Exact: same normalized main text (ignoring very short pages, which are usually empty templates).
  const byHash = new Map<string, typeof fps>();
  for (const f of fps) if (f.words >= 20) byHash.set(f.textHash, [...(byHash.get(f.textHash) ?? []), f]);
  const exact = [...byHash.values()].filter(l => l.length > 1).map(l => group(l.map(f => info(f.url, f.words)), 1));

  // Near: MinHash + LSH, then join pairs into clusters (union-find), excluding exact groups.
  const cand = fps.filter(f => f.words >= 50);
  const pairs = nearDuplicatePairs(cand.map(f => f.minhash as number[]), threshold);
  const parent = cand.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const best = new Map<number, number>();
  for (const p of pairs) {
    if (cand[p.a].textHash === cand[p.b].textHash) continue;
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const clusters = new Map<number, number[]>();
  cand.forEach((_, i) => {
    const r = find(i);
    if (r !== i || clusters.has(r)) clusters.set(r, [...(clusters.get(r) ?? []), i]);
  });
  for (const p of pairs) {
    const r = find(p.a);
    best.set(r, Math.min(best.get(r) ?? 1, p.similarity));
  }
  const near = [...clusters.entries()]
    .filter(([, l]) => new Set(l.map(i => cand[i].textHash)).size > 1)
    .map(([r, l]) => {
      // One page per exact-copy group (the best one; its copies are listed under "Duplicados exactos").
      const byText = new Map<string, Info[]>();
      for (const i of l) byText.set(cand[i].textHash, [...(byText.get(cand[i].textHash) ?? []), info(cand[i].url, cand[i].words)]);
      return group([...byText.values()].map(keeperOf), best.get(r) ?? threshold);
    });

  const sortG = (a: { pending: number; impressions: number; pages: unknown[] }, b: typeof a) => b.pending - a.pending || b.impressions - a.impressions || b.pages.length - a.pages.length;
  exact.sort(sortG);
  near.sort(sortG);

  const thin = fps
    .filter(f => f.words < minWords && meta.get(f.url)?.isIndexable)
    .map(f => info(f.url, f.words))
    .sort((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1) || a.words - b.words);

  return {
    crawl: { id: run.id, startedAt: run.startedAt },
    options: { threshold, minWords },
    totals: { pages: fps.length, exactGroups: exact.length, exactPages: exact.reduce((n, x) => n + x.pages.length + 1, 0), nearGroups: near.length, nearPages: near.reduce((n, x) => n + x.pages.length + 1, 0), thin: thin.length, capped: fps.length >= FINGERPRINT_MAX_PAGES, hasGsc: gsc.length > 0 },
    exact: exact.slice(0, 300),
    near: near.slice(0, 300),
    thin: thin.slice(0, 1000)
  };
}

// ---------------------------------------------------------------------------
// 9. Declining content (month by month clicks from Search Console)
// ---------------------------------------------------------------------------

export async function decliningContentReport(siteId: string, opts: { minClicks?: number; minDrop?: number } = {}) {
  const minClicks = opts.minClicks ?? 30;
  const minDrop = opts.minDrop ?? 0.2;
  const rows = await prisma.gscPageMonth.findMany({ where: { siteId }, orderBy: { month: 'asc' } });
  const months = [...new Set(rows.map(r => r.month))].sort();
  if (months.length < 4) return { months, ready: false, options: { minClicks, minDrop }, totals: null, site: [], pages: [] };

  const last3 = months.slice(-3);
  const prev3 = months.slice(-6, -3);
  const yoy3 = last3.map(m => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
  const hasYoy = yoy3.every(m => months.includes(m));

  const byPage = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    const k = gscKey(r.page);
    if (!byPage.has(k)) byPage.set(k, new Map());
    const m = byPage.get(k)!;
    const e = m.get(r.month);
    // Two URL spellings of the same page (trailing slash) add up.
    if (e) m.set(r.month, { ...e, clicks: e.clicks + r.clicks, impressions: e.impressions + r.impressions, position: (e.position * e.impressions + r.position * r.impressions) / Math.max(1, e.impressions + r.impressions) });
    else m.set(r.month, r);
  }
  const sum = (m: Map<string, (typeof rows)[number]>, ms: string[], f: 'clicks' | 'impressions') => ms.reduce((n, x) => n + (m.get(x)?.[f] ?? 0), 0);
  const pos = (m: Map<string, (typeof rows)[number]>, ms: string[]) => {
    const imp = sum(m, ms, 'impressions');
    return imp ? ms.reduce((n, x) => n + (m.get(x)?.position ?? 0) * (m.get(x)?.impressions ?? 0), 0) / imp : null;
  };

  const crawl = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const crawled = crawl ? new Map((await prisma.crawledPage.findMany({ where: { crawlRunId: crawl.id }, select: { url: true, title: true, statusCode: true, isIndexable: true, indexabilityReason: true } })).map(p => [gscKey(p.url), p])) : new Map();

  // SERP tracker: result blocks that appeared for the keywords a page ranks with (last snapshot vs ~4 weeks before).
  const serpByPage = new Map<string, string[]>();
  const LABEL: Record<string, string> = { ai_overview: 'AI Overview', featured_snippet: 'fragmento destacado', people_also_ask: 'People Also Ask', forums: 'foros/Reddit', videos: 'videos', local_pack: 'mapa local', shopping: 'compras', top_stories: 'noticias', ads: 'anuncios' };
  for (const k of await prisma.serpKeyword.findMany({ where: { siteId }, include: { snapshots: { orderBy: { date: 'desc' }, take: 12 } } })) {
    const [last, ...rest] = k.snapshots;
    if (!last?.url) continue;
    const ref = rest.find(s => new Date(last.date).getTime() - new Date(s.date).getTime() >= 21 * 86400_000) ?? rest.at(-1);
    if (!ref) continue;
    const added = (last.features as string[]).filter(f => !(ref.features as string[]).includes(f) && LABEL[f]);
    if (added.length) serpByPage.set(gscKey(last.url), [...(serpByPage.get(gscKey(last.url)) ?? []), `En Google, para «${k.keyword}», aparecieron ${added.map(f => LABEL[f]).join(', ')} desde el ${ref.date}${last.aiCitesUs === false && added.includes('ai_overview') ? ' (el AI Overview no te cita)' : ''}: puede explicar la caída aunque la posición se mantenga.`]);
  }

  const pages = [];
  for (const [key, m] of byPage) {
    const before = sum(m, prev3, 'clicks');
    const after = sum(m, last3, 'clicks');
    if (before < minClicks) continue;
    const drop = (before - after) / before;
    if (drop < minDrop) continue;
    const impB = sum(m, prev3, 'impressions');
    const impA = sum(m, last3, 'impressions');
    const posB = pos(m, prev3);
    const posA = pos(m, last3);
    const ctrB = impB ? before / impB : 0;
    const ctrA = impA ? after / impA : 0;
    const yoyBefore = hasYoy ? sum(m, yoy3, 'clicks') : null;
    // Consecutive monthly drops up to the last month.
    let streak = 0;
    for (let i = months.length - 1; i > 0 && (m.get(months[i])?.clicks ?? 0) < (m.get(months[i - 1])?.clicks ?? 0); i--) streak++;

    const c = crawled.get(key);
    const reasons: string[] = [];
    if (c && (c.statusCode !== 200 || !c.isIndexable)) reasons.push(`Hoy ${c.statusCode !== 200 ? `responde ${c.statusCode}` : `no es indexable (${c.indexabilityReason ?? 'noindex o canonical'})`}: revisa si fue intencional.`);
    if (posB !== null && posA !== null && posA - posB >= 2) reasons.push(`Perdió posiciones (de ${round(posB)} a ${round(posA)}): la competencia mejoró o el contenido envejeció. Actualiza datos, amplía lo que falte y refuerza los enlaces internos.`);
    if (impB && (impB - impA) / impB >= 0.2 && !(posB !== null && posA !== null && posA - posB >= 2)) reasons.push(`Bajaron las impresiones ${Math.round(((impB - impA) / impB) * 100)} % con posición parecida: hay menos búsquedas del tema o dejó de aparecer en algunas consultas.`);
    if (ctrB && (ctrB - ctrA) / ctrB >= 0.2 && impA >= impB * 0.8) reasons.push(`Misma visibilidad, menos clics (CTR de ${round(ctrB * 100)} % a ${round(ctrA * 100)} %): revisa título y description, y si ahora hay AI Overviews o resultados enriquecidos en esa búsqueda.`);
    reasons.push(...(serpByPage.get(key) ?? []));
    if (!reasons.length) reasons.push('Bajó sin una causa clara en los datos: compara su contenido con las páginas que hoy están arriba en Google (o sigue sus keywords en Autoridad y SERP).');
    const seasonal = yoyBefore !== null && yoyBefore > 0 && after >= yoyBefore * 0.9;
    pages.push({
      page: [...m.values()][0].page,
      title: c?.title ?? null,
      before,
      after,
      lost: before - after,
      drop: Math.round(drop * 100),
      positionBefore: posB === null ? null : round(posB),
      positionAfter: posA === null ? null : round(posA),
      yoy: yoyBefore === null ? null : { before: yoyBefore, change: yoyBefore ? Math.round(((after - yoyBefore) / yoyBefore) * 100) : null },
      seasonal,
      streak,
      reasons,
      series: months.map(x => ({ month: x, clicks: m.get(x)?.clicks ?? 0 }))
    });
  }
  pages.sort((a, b) => Number(a.seasonal) - Number(b.seasonal) || b.lost - a.lost);

  const site = months.map(x => ({ month: x, clicks: rows.filter(r => r.month === x).reduce((n, r) => n + r.clicks, 0) }));
  return {
    months,
    ready: true,
    periods: { before: prev3, after: last3, yoy: hasYoy ? yoy3 : null },
    options: { minClicks, minDrop },
    totals: { pages: pages.length, lost: pages.reduce((n, p) => n + p.lost, 0), seasonal: pages.filter(p => p.seasonal).length },
    site,
    pages: pages.slice(0, 500)
  };
}

// ---------------------------------------------------------------------------
// 10. Keyword topics: group Search Console queries and find the page each group should rank with
// ---------------------------------------------------------------------------

const STOP = new Set('a al algo algun alguna como con cual cuales cuando de del desde donde el ella en entre es esa ese eso esta este esto hay la las le lo los mas me mi mis muy no o para pero por que se si sin sobre su sus te tu un una uno unos y ya the of and for to in on with what how is are a an or best mejor mejores'.split(' '));
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = (w: string) => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
export const topicTokens = (q: string) => [...new Set((norm(q).match(/[a-z0-9ñ]+/g) ?? []).filter(w => !STOP.has(w) && w.length > 1).map(stem))];
const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const s = new Set(b);
  const inter = a.filter(x => s.has(x)).length;
  return inter / (a.length + b.length - inter);
};

export async function keywordTopicsReport(siteId: string, opts: { maxQueries?: number } = {}) {
  const imp = await latestGscImport(siteId);
  if (!imp) return { import: null, totals: null, topics: [] };
  const rows = await prisma.gscQueryStat.findMany({ where: { importId: imp.id } });
  // Per query: totals and the impressions of each page.
  const qs = new Map<string, { query: string; clicks: number; impressions: number; posW: number; pages: Map<string, { clicks: number; impressions: number; posW: number }> }>();
  for (const r of rows) {
    const k = norm(r.query).replace(/\s+/g, ' ').trim();
    const q = qs.get(k) ?? { query: r.query, clicks: 0, impressions: 0, posW: 0, pages: new Map() };
    q.clicks += r.clicks;
    q.impressions += r.impressions;
    q.posW += r.position * r.impressions;
    const p = q.pages.get(r.page) ?? { clicks: 0, impressions: 0, posW: 0 };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.posW += r.position * r.impressions;
    q.pages.set(r.page, p);
    qs.set(k, q);
  }
  const list = [...qs.values()].sort((a, b) => b.impressions - a.impressions).slice(0, opts.maxQueries ?? 5000);

  // Greedy clustering: the biggest query starts a topic; others join the topic whose lead query shares
  // enough words, or some words plus the same ranking pages (Google treats them as the same intent).
  interface Topic { head: string[]; members: typeof list; pages: Map<string, number> }
  const topics: Topic[] = [];
  const index = new Map<string, number[]>();
  for (const q of list) {
    const t = topicTokens(q.query);
    const top = [...q.pages.entries()].sort((a, b) => b[1].impressions - a[1].impressions)[0]?.[0];
    let bestI = -1;
    let bestS = 0;
    for (const i of new Set(t.flatMap(w => index.get(w) ?? []))) {
      const tp = topics[i];
      const j = jaccard(t, tp.head);
      const sharesPage = top !== undefined && tp.pages.has(top);
      const s = j >= 0.5 ? j : sharesPage && j >= 0.25 ? j + 0.25 : 0;
      if (s > bestS) (bestS = s), (bestI = i);
    }
    if (bestI < 0) {
      topics.push({ head: t, members: [], pages: new Map() });
      bestI = topics.length - 1;
      for (const w of t) index.set(w, [...(index.get(w) ?? []), bestI]);
    }
    const tp = topics[bestI];
    tp.members.push(q);
    for (const [p, v] of q.pages) tp.pages.set(p, (tp.pages.get(p) ?? 0) + v.impressions);
  }

  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const titles = run ? new Map((await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, title: true } })).map(p => [gscKey(p.url), p.title])) : new Map<string, string | null>();

  const out = topics
    .map(tp => {
      const clicks = tp.members.reduce((n, q) => n + q.clicks, 0);
      const impressions = tp.members.reduce((n, q) => n + q.impressions, 0);
      const pageStats = new Map<string, { clicks: number; impressions: number; posW: number }>();
      for (const q of tp.members)
        for (const [p, v] of q.pages) {
          const e = pageStats.get(p) ?? { clicks: 0, impressions: 0, posW: 0 };
          e.clicks += v.clicks;
          e.impressions += v.impressions;
          e.posW += v.posW;
          pageStats.set(p, e);
        }
      const pages = [...pageStats.entries()].map(([page, v]) => ({ page, title: titles.get(gscKey(page)) ?? null, clicks: v.clicks, impressions: v.impressions, share: Math.round((v.impressions / (impressions || 1)) * 100), position: round(v.posW / (v.impressions || 1)) })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
      const target = pages[0];
      const position = impressions ? tp.members.reduce((n, q) => n + q.posW, 0) / impressions : 0;
      const opportunity = tp.members.filter(q => q.impressions && q.posW / q.impressions >= 4 && q.posW / q.impressions <= 20).reduce((n, q) => n + q.impressions, 0);
      const status = position > 20 ? 'sin-pagina-fuerte' : target.share < 70 && pages.length > 1 ? 'disperso' : 'claro';
      const advice =
        status === 'sin-pagina-fuerte'
          ? 'Ninguna página posiciona bien para este tema: crea una página dedicada (o amplía la que más aparece) que cubra todas estas búsquedas.'
          : status === 'disperso'
            ? `Las impresiones se reparten entre ${pages.length} páginas. Haz de ${target.page} la página del tema: cubre ahí las búsquedas del grupo y enlázala desde las demás (revisa Canibalización).`
            : opportunity > 0
              ? 'Hay una página clara. Para subir, cubre en ella las búsquedas del grupo que están en posición 4–20 (secciones, preguntas frecuentes) y enlázala con esos textos.'
              : 'Bien cubierto: una página concentra el tema.';
      return {
        name: tp.members[0].query,
        keywords: tp.head,
        queries: tp.members.slice(0, 200).map(q => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: round(q.posW / (q.impressions || 1)) })),
        queryCount: tp.members.length,
        clicks,
        impressions,
        position: round(position),
        opportunity,
        target: target.page,
        targetTitle: target.title,
        targetShare: target.share,
        pages: pages.slice(0, 10),
        pageCount: pages.length,
        status,
        advice
      };
    })
    .filter(t => t.queryCount >= 2 || t.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions);

  return {
    import: { startDate: imp.startDate, endDate: imp.endDate },
    totals: { topics: out.length, queries: list.length, scattered: out.filter(t => t.status === 'disperso').length, weak: out.filter(t => t.status === 'sin-pagina-fuerte').length, capped: qs.size > list.length },
    topics: out.slice(0, 500)
  };
}
