import zlib from 'zlib';
import { CHUNK_FLAGS, chunkBlocks, fetchWithRedirects, generateLlmsTxt, htmlToMarkdown, markJsOnly, validateLlmsTxt, type ChunkFlag } from '@glitch/crawler';
import { prisma } from './client';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const fetchOpts = (maxBodyBytes: number) => ({ userAgent: 'G.SEO (+vista de bot de IA)', timeoutMs: 15_000, allowHosts: allowHosts(), maxBodyBytes, anyContentType: true });

// ---------------------------------------------------------------------------
// "Vista de bot de IA" (RAG simulator) for one crawled page
// ---------------------------------------------------------------------------

export async function aiBotView(crawlRunId: string, pageId: string, opts: { maxTokens?: number } = {}) {
  const maxTokens = opts.maxTokens ?? 512;
  const page = await prisma.crawledPage.findFirst({ where: { id: pageId, crawlRunId }, select: { url: true, finalUrl: true, htmlGz: true, js: true } });
  if (!page) throw new WorkflowError('PAGE_NOT_FOUND', 'Esa página no está en este crawl.', 404);
  if (!page.htmlGz) throw new WorkflowError('NO_HTML', 'No se guardó el HTML de esta página (no es HTML 2xx o el crawl ya se limpió).', 409);
  const stored = zlib.gunzipSync(Buffer.from(page.htmlGz)).toString('utf8');
  const js = page.js as { rendered?: boolean } | null;
  const url = page.finalUrl || page.url;

  // What an AI crawler receives: the HTML without running JavaScript.
  let raw = stored;
  let rendered: string | null = null;
  let rawError: string | null = null;
  if (js?.rendered) {
    rendered = stored;
    const r = await fetchWithRedirects(url, { ...fetchOpts(3_000_000), readBody: true }).catch(e => ({ status: 0, body: null, error: (e as Error).message }) as { status: number; body: string | null; error?: string });
    if (r.status >= 200 && r.status < 300 && r.body) raw = r.body;
    else rawError = `No se pudo descargar el HTML sin JavaScript (${(r as { error?: string }).error ?? `HTTP ${r.status}`}); se muestra el contenido con JavaScript.`;
  }

  const bot = htmlToMarkdown(raw, url);
  const withJs = rendered && !rawError ? htmlToMarkdown(rendered, url) : null;
  const jsOnlyBlocks = withJs ? markJsOnly(withJs.blocks, bot.blocks) : 0;
  const botChunks = chunkBlocks(bot.blocks, maxTokens);
  const jsChunks = withJs ? chunkBlocks(withJs.blocks, maxTokens) : null;
  // Without a JavaScript crawl we can only suspect: almost no text but an app shell.
  const jsSuspect = !js?.rendered && bot.words < 80 && /<div[^>]+id=["'](app|root|__next|__nuxt)["'][^>]*>\s*<\/div>|<script[^>]+src=[^>]+(main|app|bundle|chunk)[^>]*\.js/i.test(raw);

  const count = (chunks: typeof botChunks) => {
    const c: Partial<Record<ChunkFlag, number>> = {};
    for (const ch of chunks) for (const f of ch.flags) c[f] = (c[f] ?? 0) + 1;
    return c;
  };
  return {
    url,
    maxTokens,
    source: js?.rendered ? (rawError ? 'rendered-only' : 'live-raw+rendered') : 'stored-raw',
    rawError,
    jsSuspect,
    flags: CHUNK_FLAGS,
    bot: { title: bot.title, markdown: bot.markdown, words: bot.words, imagesWithoutAlt: bot.imagesWithoutAlt, chunks: botChunks, flagCounts: count(botChunks) },
    withJs: withJs && jsChunks ? { markdown: withJs.markdown, words: withJs.words, chunks: jsChunks, flagCounts: count(jsChunks), jsOnlyBlocks, jsOnly: withJs.blocks.filter(b => b.jsOnly).map(b => b.md).slice(0, 100) } : null
  };
}

// ---------------------------------------------------------------------------
// llms.txt and llms-full.txt
// ---------------------------------------------------------------------------

async function latestRun(siteId: string, crawlRunId?: string) {
  const run = crawlRunId
    ? await prisma.crawlRun.findFirst({ where: { id: crawlRunId, siteId } })
    : await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  if (crawlRunId && !run) throw new WorkflowError('CRAWL_NOT_FOUND', 'Ese crawl no existe en este sitio.', 404);
  return run;
}
const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/$/, '');
  }
};

export async function generateSiteLlmsTxt(siteId: string, opts: { crawlRunId?: string; perSection?: number; maxLinks?: number; summary?: string | null; full?: boolean; fullPages?: number } = {}) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const run = await latestRun(siteId, opts.crawlRunId);
  if (!run) throw new WorkflowError('NO_CRAWL', 'Haz un crawl del sitio para generar el llms.txt.', 409);
  const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true, mimeType: { contains: 'html' } }, select: { id: true, url: true, finalUrl: true, title: true, metaDescription: true, inlinks: true, depth: true } });
  const imp = await latestGscImport(siteId);
  const clicks = new Map((imp ? await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true } }) : []).map(p => [gscKey(p.page), p.clicks]));
  const priority = (p: (typeof pages)[number]) => (clicks.get(gscKey(p.url)) ?? 0) * 1000 + p.inlinks * 10 - p.depth;
  const uniq = [...new Map(pages.map(p => [gscKey(p.finalUrl || p.url), p])).values()];
  const home = uniq.find(p => {
    try {
      return new URL(p.url).pathname === '/';
    } catch {
      return false;
    }
  });
  const g = generateLlmsTxt(uniq.map(p => ({ url: p.finalUrl || p.url, title: p.title, description: p.metaDescription, priority: priority(p) })), { siteName: site.name, summary: opts.summary ?? home?.metaDescription ?? null, perSection: opts.perSection, maxLinks: opts.maxLinks });

  let full: { text: string; pages: number; truncated: boolean } | null = null;
  if (opts.full) {
    const top = [...uniq].sort((a, b) => priority(b) - priority(a)).slice(0, Math.min(opts.fullPages ?? 30, 200));
    const parts = [`# ${site.name}`, '', ...(home?.metaDescription ? [`> ${home.metaDescription.replace(/\s+/g, ' ').trim()}`, ''] : [])];
    let size = 0;
    let n = 0;
    let truncated = false;
    for (const p of top) {
      const row = await prisma.crawledPage.findUnique({ where: { id: p.id }, select: { htmlGz: true } });
      if (!row?.htmlGz) continue;
      const md = htmlToMarkdown(zlib.gunzipSync(Buffer.from(row.htmlGz)).toString('utf8'), p.finalUrl || p.url).markdown.replace(/^# /gm, '### ').replace(/^## /gm, '### ');
      const block = `## ${p.title ?? p.url}\n\nURL: ${p.finalUrl || p.url}\n\n${md}\n`;
      if (size + block.length > 1_500_000) {
        truncated = true;
        break;
      }
      parts.push(block);
      size += block.length;
      n++;
    }
    full = { text: parts.join('\n'), pages: n, truncated };
  }
  return { crawl: { id: run.id, startedAt: run.startedAt }, ...g, full };
}

export async function validateSiteLlmsTxt(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const origin = originOf(site.canonicalUrl);
  const host = new URL(origin).hostname;
  const [main, full] = await Promise.all([
    fetchWithRedirects(`${origin}/llms.txt`, { ...fetchOpts(1_000_000), readBody: true }).catch(() => null),
    fetchWithRedirects(`${origin}/llms-full.txt`, { ...fetchOpts(200_000), readBody: true }).catch(() => null)
  ]);
  const looksHtml = (b: string | null | undefined) => !!b && /^\s*(<!doctype html|<html)/i.test(b.slice(0, 300));
  const fullFound = full?.status === 200 && !!full.body && !looksHtml(full.body);
  if (!main || main.status !== 200 || !main.body || looksHtml(main.body)) {
    return { url: `${origin}/llms.txt`, found: false, status: main?.status ?? null, servesHtml: looksHtml(main?.body), fullFound, result: null };
  }
  const run = await latestRun(siteId);
  const known = new Map<string, { status: number; indexable: boolean }>();
  if (run) {
    for (const p of await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, statusCode: true, isIndexable: true, redirectChain: true } })) {
      const chain = p.redirectChain as Array<{ status: number }> | null;
      known.set(gscKey(p.url), { status: chain?.length ? chain[0].status : p.statusCode, indexable: p.isIndexable });
    }
  }
  const result = validateLlmsTxt(main.body, { host, contentType: main.headers?.get('content-type') ?? null, known: u => known.get(gscKey(u)) ?? null });
  return { url: `${origin}/llms.txt`, found: true, status: 200, servesHtml: false, fullFound, crawled: !!run, text: main.body.slice(0, 200_000), result };
}
