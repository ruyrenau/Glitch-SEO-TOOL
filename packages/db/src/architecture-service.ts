import zlib from 'zlib';
import * as cheerio from 'cheerio';
import { decryptSecret } from '@glitch/core';
import { WordPressSeoClient, WordPressError } from '@glitch/connectors';
import { anchorCandidates, findPhrase, fetchWithRedirects, htmlToMarkdown, internalPageRank, markJsOnly, matchRedirect, terms, tfidf, cosine, type Vec } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';
import { backlinkBrokenTargets } from './backlink-service';

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function pickRun(siteId: string, crawlRunId?: string, needHtml = false) {
  const run = crawlRunId
    ? await prisma.crawlRun.findFirst({ where: { id: crawlRunId, siteId } })
    : await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site', ...(needHtml ? { detailPurgedAt: null } : {}) }, orderBy: { startedAt: 'desc' } });
  if (crawlRunId && !run) throw new WorkflowError('CRAWL_NOT_FOUND', 'Ese crawl no existe en este sitio.', 404);
  if (run && needHtml && run.detailPurgedAt) throw new WorkflowError('CRAWL_PURGED', 'El detalle de ese crawl ya se borró para ahorrar espacio. Elige un crawl más reciente.', 409);
  return run;
}

async function gscByPage(siteId: string) {
  const imp = await latestGscImport(siteId);
  if (!imp) return { has: false, pages: new Map<string, { clicks: number; impressions: number }>(), queries: new Map<string, string[]>() };
  const [pages, q] = await Promise.all([
    prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true, impressions: true } }),
    prisma.gscQueryStat.findMany({ where: { importId: imp.id }, select: { page: true, query: true, impressions: true }, orderBy: { impressions: 'desc' } })
  ]);
  const queries = new Map<string, string[]>();
  for (const r of q) {
    const k = gscKey(r.page);
    const l = queries.get(k) ?? [];
    if (l.length < 8) l.push(r.query);
    queries.set(k, l);
  }
  return { has: true, pages: new Map(pages.map(p => [gscKey(p.page), p])), queries };
}

// ---------------------------------------------------------------------------
// Internal link graph
// ---------------------------------------------------------------------------

export async function internalLinkReport(siteId: string, opts: { crawlRunId?: string } = {}) {
  const run = await pickRun(siteId, opts.crawlRunId);
  if (!run) return { crawl: null, totals: null, pages: [], orphans: [] };
  const [pages, links, sitemap, gsc] = await Promise.all([
    prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, finalUrl: true, title: true, statusCode: true, isIndexable: true, depth: true, inSitemap: true, mimeType: true } }),
    prisma.crawledLink.findMany({ where: { crawlRunId: run.id, internal: true, nofollow: false }, select: { sourceUrl: true, targetUrl: true } }),
    prisma.sitemapUrl.findMany({ where: { siteId }, select: { url: true } }),
    gscByPage(siteId)
  ]);
  const html = pages.filter(p => p.statusCode === 200 && p.mimeType.includes('html'));
  const indexable = html.filter(p => p.isIndexable);
  const key = new Map<string, string>(); // any crawled spelling → indexable url
  for (const p of indexable) {
    key.set(gscKey(p.url), p.url);
    if (p.finalUrl) key.set(gscKey(p.finalUrl), p.url);
  }
  const edges: Array<[string, string]> = [];
  for (const l of links) {
    const a = key.get(gscKey(l.sourceUrl));
    const b = key.get(gscKey(l.targetUrl));
    if (a && b) edges.push([a, b]);
  }
  const pr = internalPageRank(indexable.map(p => p.url), edges);
  const rows = indexable
    .map(p => {
      const s = pr.get(p.url)!;
      const g = gsc.pages.get(gscKey(p.url));
      return { url: p.url, title: p.title, linkScore: s.score, inlinks: s.inlinks, outlinks: s.outlinks, depth: p.depth, inSitemap: p.inSitemap, clicks: g?.clicks ?? null, impressions: g?.impressions ?? null };
    })
    .sort((a, b) => b.linkScore - a.linkScore);

  // Orphans: known to Google or the sitemap but not reachable through links.
  const crawled = new Set(pages.map(p => gscKey(p.url)));
  const orphanMap = new Map<string, { url: string; source: string[]; clicks: number | null; impressions: number | null; inCrawl: boolean }>();
  const addOrphan = (url: string, source: string, inCrawl: boolean) => {
    const k = gscKey(url);
    const g = gsc.pages.get(k);
    const e = orphanMap.get(k) ?? { url, source: [], clicks: g?.clicks ?? null, impressions: g?.impressions ?? null, inCrawl };
    if (!e.source.includes(source)) e.source.push(source);
    orphanMap.set(k, e);
  };
  for (const r of rows) if (r.inlinks === 0 && gscKey(r.url) !== gscKey(run ? (pages.find(p => p.depth === 0)?.url ?? '') : '')) addOrphan(r.url, 'sin enlaces internos', true);
  for (const s of sitemap) if (!crawled.has(gscKey(s.url))) addOrphan(s.url, 'sitemap', false);
  for (const [k, g] of gsc.pages) if (!crawled.has(k) && g.impressions > 0) addOrphan(k, 'Search Console', false);
  const orphans = [...orphanMap.values()].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 1000);

  const deep = rows.filter(r => r.depth > 3);
  const weakWithDemand = rows.filter(r => r.linkScore < 30 && (r.impressions ?? 0) > 0).sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));
  return {
    crawl: { id: run.id, startedAt: run.startedAt },
    totals: { pages: rows.length, links: edges.length, orphans: orphans.length, deep: deep.length, weakWithDemand: weakWithDemand.length, avgInlinks: rows.length ? round(rows.reduce((n, r) => n + r.inlinks, 0) / rows.length) : 0, hasGsc: gsc.has },
    depthDistribution: [0, 1, 2, 3, 4, 5].map(d => ({ depth: d === 5 ? '5+' : String(d), pages: rows.filter(r => (d === 5 ? r.depth >= 5 : r.depth === d)).length })),
    pages: rows.slice(0, 2000),
    orphans,
    weakWithDemand: weakWithDemand.slice(0, 200).map(r => r.url)
  };
}

/** Paragraph texts of a page's main content, without the text that is already inside links. */
function paragraphs(html: string) {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, form, [role="navigation"]').remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  root.find('a, h1, h2, h3, h4, h5, h6, button').remove();
  return root.find('p, li, td').toArray().map(el => $(el).text().replace(/\s+/g, ' ').trim()).filter(t => t.length > 30);
}

/**
 * "Auto-interlinking": for pages that need links (low Link Score with Google demand, orphans in the crawl,
 * deep pages), finds related pages (TF-IDF cosine of their main text) whose body already contains a good
 * anchor (the target's main queries, H1 or title parts) and that do not link to the target yet.
 */
export async function internalLinkSuggestions(siteId: string, opts: { crawlRunId?: string; targetUrl?: string; maxTargets?: number; perTarget?: number } = {}) {
  const run = await pickRun(siteId, opts.crawlRunId, true);
  if (!run) throw new WorkflowError('NO_CRAWL', 'Haz un crawl del sitio para sugerir enlaces.', 409);
  const report = await internalLinkReport(siteId, { crawlRunId: run.id });
  const gsc = await gscByPage(siteId);
  const byUrl = new Map(report.pages.map(p => [p.url, p]));
  let targets: string[];
  if (opts.targetUrl) targets = [opts.targetUrl];
  else {
    const t = new Set<string>([...(report.weakWithDemand ?? []), ...report.pages.filter(p => p.inlinks <= 1).map(p => p.url), ...report.pages.filter(p => p.depth > 3).map(p => p.url)]);
    targets = [...t].slice(0, opts.maxTargets ?? 40);
  }
  if (!targets.length) return { crawl: report.crawl, suggestions: [], targets: 0 };

  const meta = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true, htmlGz: { not: null } }, select: { url: true, title: true, h1: true, htmlGz: true }, orderBy: { depth: 'asc' }, take: 3000 });
  const paras = meta.map(m => paragraphs(zlib.gunzipSync(Buffer.from(m.htmlGz!)).toString('utf8')));
  const vecs: Vec[] = tfidf(meta.map((m, i) => terms(`${m.title ?? ''} ${m.h1 ?? ''} ${paras[i].join(' ')}`)));
  const idx = new Map(meta.map((m, i) => [m.url, i]));
  const links = await prisma.crawledLink.findMany({ where: { crawlRunId: run.id, internal: true }, select: { sourceUrl: true, targetUrl: true } });
  const linked = new Set(links.map(l => `${gscKey(l.sourceUrl)}|${gscKey(l.targetUrl)}`));

  const suggestions = [];
  for (const target of targets) {
    const ti = idx.get(target);
    if (ti === undefined) continue;
    const anchors = anchorCandidates({ title: meta[ti].title, h1: meta[ti].h1, queries: gsc.queries.get(gscKey(target)) });
    if (!anchors.length) continue;
    const cands = meta
      .map((m, i) => ({ i, sim: i === ti ? -1 : cosine(vecs[i], vecs[ti]) }))
      .filter(c => c.sim >= 0.08 && !linked.has(`${gscKey(meta[c.i].url)}|${gscKey(target)}`))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 60);
    let n = 0;
    for (const c of cands) {
      const hit = findPhrase(paras[c.i], anchors);
      if (!hit) continue;
      const src = byUrl.get(meta[c.i].url);
      const tgt = byUrl.get(target);
      suggestions.push({
        sourceUrl: meta[c.i].url,
        sourceTitle: meta[c.i].title,
        sourceLinkScore: src?.linkScore ?? 0,
        targetUrl: target,
        targetTitle: meta[ti].title,
        targetLinkScore: tgt?.linkScore ?? 0,
        targetImpressions: tgt?.impressions ?? null,
        anchor: hit.found,
        anchorSource: (gsc.queries.get(gscKey(target)) ?? []).some(q => q.toLowerCase() === hit.phrase.toLowerCase()) ? 'consulta de Search Console' : 'título o H1',
        context: hit.context,
        similarity: Math.round(c.sim * 100),
        score: Math.round(c.sim * 100 * (0.5 + (src?.linkScore ?? 0) / 200))
      });
      if (++n >= (opts.perTarget ?? 5)) break;
    }
  }
  suggestions.sort((a, b) => (b.targetImpressions ?? 0) - (a.targetImpressions ?? 0) || b.score - a.score);
  return { crawl: report.crawl, targets: targets.length, suggestions: suggestions.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// 301 redirect map ("Migration & Rescue")
// ---------------------------------------------------------------------------

export async function redirectSuggestions(siteId: string, opts: { crawlRunId?: string } = {}) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const run = await pickRun(siteId, opts.crawlRunId);
  if (!run) return { crawl: null, rules: [], totals: null };
  let origin = site.canonicalUrl;
  try {
    origin = new URL(site.canonicalUrl).origin;
  } catch {
    /* keep */
  }
  const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { id: true, url: true, finalUrl: true, title: true, statusCode: true, isIndexable: true, mimeType: true, inlinks: true, htmlGz: false } });
  const live = pages.filter(p => p.statusCode === 200 && p.isIndexable && p.mimeType.includes('html'));
  const home = live.find(p => {
    try {
      return new URL(p.url).pathname === '/';
    } catch {
      return false;
    }
  })?.url ?? `${origin}/`;

  // Broken URLs: crawl 4xx, Googlebot / AI bots hitting 404 in the logs, Search Console pages that are 4xx.
  const broken = new Map<string, { url: string; sources: string[]; inlinks: number; botHits: number; impressions: number | null; backlinks: number }>();
  const add = (url: string, source: string, extra: Partial<{ inlinks: number; botHits: number; impressions: number | null; backlinks: number }> = {}) => {
    const k = gscKey(url);
    const e = broken.get(k) ?? { url, sources: [], inlinks: 0, botHits: 0, impressions: null, backlinks: 0 };
    e.backlinks += extra.backlinks ?? 0;
    if (!e.sources.includes(source)) e.sources.push(source);
    e.inlinks += extra.inlinks ?? 0;
    e.botHits += extra.botHits ?? 0;
    if (extra.impressions !== undefined) e.impressions = extra.impressions;
    broken.set(k, e);
  };
  for (const p of pages) if (p.statusCode === 404 || p.statusCode === 410) add(p.url, 'crawl', { inlinks: p.inlinks });
  const lastLog = await prisma.logImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
  if (lastLog) {
    const rows = await prisma.logAggregate.groupBy({ by: ['path'], where: { logImportId: lastLog.id, statusCode: { in: [404, 410] }, botCategory: { in: ['search', 'ai'] } }, _sum: { hits: true }, orderBy: { _sum: { hits: 'desc' } }, take: 500 });
    for (const r of rows) if (!/\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|map)$/i.test(r.path)) add(`${origin}${r.path.startsWith('/') ? '' : '/'}${r.path}`, 'logs de bots', { botHits: r._sum.hits ?? 0 });
  }
  const imp = await latestGscImport(siteId);
  if (imp) {
    const statusByKey = new Map(pages.map(p => [gscKey(p.url), p.statusCode]));
    for (const g of await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, impressions: true } })) {
      const st = statusByKey.get(gscKey(g.page));
      if (st === 404 || st === 410) add(g.page, 'Search Console', { impressions: g.impressions });
    }
  }

  // External sites that still link to a 404/410 of ours (Backlinks): authority to rescue first.
  for (const t of await backlinkBrokenTargets(siteId)) add(t.url, 'backlinks', { backlinks: t.links });

  // What the page was before (an earlier crawl where it answered 200): its title and text help the match.
  const earlier = await prisma.crawlRun.findMany({ where: { siteId, status: 'completed', startedAt: { lt: run.startedAt } }, orderBy: { startedAt: 'desc' }, take: 5, select: { id: true } });
  const old = new Map<string, { title: string | null; html: string | null }>();
  if (earlier.length && broken.size) {
    const urls = [...broken.values()].map(b => b.url);
    for (const r of await prisma.crawledPage.findMany({ where: { crawlRunId: { in: earlier.map(e => e.id) }, url: { in: urls }, statusCode: 200 }, select: { url: true, title: true, htmlGz: true } })) {
      if (!old.has(gscKey(r.url))) old.set(gscKey(r.url), { title: r.title, html: r.htmlGz ? zlib.gunzipSync(Buffer.from(r.htmlGz)).toString('utf8') : null });
    }
  }
  // Text vectors only when some old content is known (they are the expensive part).
  let liveVec: Map<string, Vec> | null = null;
  const oldVec = new Map<string, Vec>();
  const withHtml = [...old.entries()].filter(([, o]) => o.html);
  if (withHtml.length) {
    const liveHtml = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true, htmlGz: { not: null } }, select: { url: true, title: true, htmlGz: true }, take: 3000 });
    const docs = [...liveHtml.map(p => terms(`${p.title ?? ''} ${htmlToMarkdown(zlib.gunzipSync(Buffer.from(p.htmlGz!)).toString('utf8'), p.url).markdown}`)), ...withHtml.map(([, o]) => terms(`${o.title ?? ''} ${htmlToMarkdown(o.html!, 'https://x.invalid/').markdown}`))];
    const v = tfidf(docs);
    liveVec = new Map(liveHtml.map((p, i) => [p.url, v[i]]));
    withHtml.forEach(([k], i) => oldVec.set(k, v[liveHtml.length + i]));
  }
  const candidates = live.map(p => ({ url: p.url, title: p.title, vec: liveVec?.get(p.url) }));
  const rules = [...broken.values()]
    .map(b => {
      const o = old.get(gscKey(b.url));
      const m = matchRedirect({ url: b.url, oldTitle: o?.title ?? null, oldVec: oldVec.get(gscKey(b.url)) ?? null }, candidates, home);
      let from = b.url;
      try {
        const u = new URL(b.url);
        from = u.pathname + u.search;
      } catch {
        /* keep */
      }
      return { from, fromUrl: b.url, to: m.target, confidence: m.confidence, score: m.score, reason: m.reason, oldTitle: o?.title ?? null, sources: b.sources, inlinks: b.inlinks, botHits: b.botHits, impressions: b.impressions, backlinks: b.backlinks };
    })
    .sort((a, b) => b.backlinks - a.backlinks || (b.impressions ?? 0) - (a.impressions ?? 0) || b.botHits - a.botHits || b.inlinks - a.inlinks);
  return {
    crawl: { id: run.id, startedAt: run.startedAt },
    origin,
    totals: { rules: rules.length, high: rules.filter(r => r.confidence === 'alta').length, medium: rules.filter(r => r.confidence === 'media').length, low: rules.filter(r => r.confidence === 'baja').length, fromLogs: !!lastLog },
    rules: rules.slice(0, 2000)
  };
}

/** Creates the approved redirects in WordPress through the Redirection plugin. */
export async function pushRedirectsToWordPress(siteId: string, rules: Array<{ from: string; to: string }>, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Conecta WordPress para este sitio primero.', 400);
  const client = new WordPressSeoClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() });
  if (!(await client.hasRedirectionPlugin())) throw new WorkflowError('NO_REDIRECTION_PLUGIN', 'No se encontró el plugin "Redirection" en WordPress. Instálalo y actívalo (es gratuito), o exporta las reglas para .htaccess o Nginx.', 400);
  const results = [];
  for (const r of rules.slice(0, 500)) {
    if (!r.from.startsWith('/') || r.from === r.to) {
      results.push({ ...r, ok: false, error: 'Regla inválida' });
      continue;
    }
    try {
      await client.createRedirect(r.from, r.to);
      results.push({ ...r, ok: true, error: null });
    } catch (e) {
      results.push({ ...r, ok: false, error: e instanceof WordPressError ? e.message : (e as Error).message });
    }
  }
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'redirects.pushed', entity: 'Site', entityId: siteId, details: { created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length } });
  return { created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}

// ---------------------------------------------------------------------------
// Rendering audit (raw HTML vs rendered DOM)
// ---------------------------------------------------------------------------

type JsInfo = { rendered?: boolean; error?: string | null; errors?: string[]; raw?: { title: string | null; h1: string | null; canonical: string | null; robotsMeta: string | null; wordCount: number; internalLinks: number }; jsOnlyLinks?: string[] };

export async function renderReport(siteId: string, opts: { crawlRunId?: string } = {}) {
  const run = opts.crawlRunId
    ? await pickRun(siteId, opts.crawlRunId)
    : (await prisma.crawlRun.findMany({ where: { siteId, status: 'completed' }, orderBy: { startedAt: 'desc' }, take: 20 })).find(r => (r.config as { renderJs?: boolean } | null)?.renderJs) ?? null;
  if (!run) return { crawl: null, totals: null, pages: [] };
  const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, mimeType: { contains: 'html' } }, select: { id: true, url: true, title: true, h1: true, canonical: true, robotsMeta: true, wordCount: true, outlinks: true, js: true } });
  const rows = pages
    .filter(p => (p.js as JsInfo | null)?.rendered)
    .map(p => {
      const js = p.js as JsInfo;
      const raw = js.raw!;
      const textLoss = p.wordCount ? Math.max(0, Math.round((1 - raw.wordCount / p.wordCount) * 100)) : 0;
      const changed: string[] = [];
      const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      if (n(raw.title) !== n(p.title)) changed.push('título');
      if (n(raw.h1) !== n(p.h1)) changed.push('H1');
      if (n(raw.canonical) !== n(p.canonical)) changed.push('canonical');
      if (n(raw.robotsMeta) !== n(p.robotsMeta)) changed.push('meta robots');
      return { id: p.id, url: p.url, title: p.title, rawWords: raw.wordCount, renderedWords: p.wordCount, textLoss, rawLinks: raw.internalLinks, jsOnlyLinks: js.jsOnlyLinks?.length ?? 0, changed, jsErrors: js.errors?.length ?? 0 };
    })
    .sort((a, b) => b.textLoss - a.textLoss || b.jsOnlyLinks - a.jsOnlyLinks);
  const avg = (f: (r: (typeof rows)[number]) => number) => (rows.length ? round(rows.reduce((s, r) => s + f(r), 0) / rows.length) : 0);
  return {
    crawl: { id: run.id, startedAt: run.startedAt },
    totals: {
      pages: rows.length,
      avgTextLoss: avg(r => r.textLoss),
      over30: rows.filter(r => r.textLoss >= 30).length,
      emptyWithoutJs: rows.filter(r => r.rawWords < 50 && r.renderedWords >= 150).length,
      jsOnlyLinks: rows.reduce((s, r) => s + r.jsOnlyLinks, 0),
      metaChanged: rows.filter(r => r.changed.length).length,
      withErrors: rows.filter(r => r.jsErrors).length
    },
    pages: rows.slice(0, 2000)
  };
}

/** Side-by-side diff of one page: blocks and internal links present with and without JavaScript. */
export async function renderDiff(crawlRunId: string, pageId: string) {
  const page = await prisma.crawledPage.findFirst({ where: { id: pageId, crawlRunId }, select: { url: true, finalUrl: true, htmlGz: true, js: true, title: true, h1: true, canonical: true, robotsMeta: true } });
  if (!page) throw new WorkflowError('PAGE_NOT_FOUND', 'Esa página no está en este crawl.', 404);
  const js = page.js as JsInfo | null;
  if (!js?.rendered || !page.htmlGz) throw new WorkflowError('NOT_RENDERED', 'Esta página no se rastreó ejecutando JavaScript. Haz un crawl con "Ejecutar JavaScript" para comparar.', 409);
  const url = page.finalUrl || page.url;
  const r = await fetchWithRedirects(url, { userAgent: 'G.SEO (+auditoría de renderizado)', timeoutMs: 15_000, allowHosts: allowHosts(), maxBodyBytes: 3_000_000, anyContentType: true }).catch(() => null);
  if (!r || r.status < 200 || r.status >= 300 || !r.body) throw new WorkflowError('RAW_FETCH_FAILED', `No se pudo descargar el HTML sin JavaScript (${r?.error ?? `HTTP ${r?.status ?? 'error'}`}).`, 502);
  const rendered = zlib.gunzipSync(Buffer.from(page.htmlGz)).toString('utf8');
  const a = htmlToMarkdown(r.body, url);
  const b = htmlToMarkdown(rendered, url);
  const jsOnly = markJsOnly(b.blocks, a.blocks);
  // Blocks the raw HTML has that JavaScript removes (rare, but it happens with client-side templates).
  const rawOnlyBlocks = markJsOnly(a.blocks, b.blocks);
  const linksOf = (html: string) => {
    const $ = cheerio.load(html);
    const host = new URL(url).host;
    const out = new Set<string>();
    $('a[href]').each((_, el) => {
      try {
        const u = new URL($(el).attr('href')!, url);
        if (u.host === host && /^https?:$/.test(u.protocol)) out.add(u.origin + u.pathname + u.search);
      } catch {
        /* skip */
      }
    });
    return out;
  };
  const la = linksOf(r.body);
  const lb = linksOf(rendered);
  const raw$ = cheerio.load(r.body);
  const meta = (title: string | null, h1: string | null, canonical: string | null, robots: string | null) => ({ title, h1, canonical, robots });
  return {
    url,
    words: { raw: a.words, rendered: b.words, lossPct: b.words ? Math.max(0, Math.round((1 - a.words / b.words) * 100)) : 0 },
    links: { raw: la.size, rendered: lb.size, jsOnly: [...lb].filter(x => !la.has(x)).slice(0, 200), rawOnly: [...la].filter(x => !lb.has(x)).slice(0, 200) },
    meta: {
      raw: meta(raw$('title').first().text().trim() || null, raw$('h1').first().text().trim() || null, raw$('link[rel="canonical"]').attr('href') ?? null, raw$('meta[name="robots"]').attr('content') ?? null),
      rendered: meta(page.title, page.h1, page.canonical, page.robotsMeta)
    },
    blocks: {
      raw: a.blocks.map(x => ({ md: x.md, status: x.jsOnly ? 'removed-by-js' : 'both' })),
      rendered: b.blocks.map(x => ({ md: x.md, status: x.jsOnly ? 'js-only' : 'both' })),
      jsOnly,
      rawOnly: rawOnlyBlocks
    },
    jsErrors: js.errors ?? []
  };
}
