import crypto from 'crypto';
import net from 'net';
import { assertSafeUrl } from './ssrf';
import { parseRobotsTxt, isAllowedByRobots, crawlDelayFor, RobotsTxt } from './robots';
import { extractPage, normalizeUrl, ExtractedPage, ResourceKind, resourceKindFromUrl } from './extract';

export interface CrawlOptions {
  startUrl: string;
  /** Extra seeds (e.g. sitemap URLs). Only same-host URLs are used. */
  seeds?: string[];
  maxUrls?: number;
  maxDepth?: number;
  concurrency?: number;
  /** Requests per second against the host. */
  rps?: number;
  timeoutMs?: number;
  userAgent?: string;
  respectRobots?: boolean;
  include?: string[];
  exclude?: string[];
  /** Hosts allowed to resolve to private IPs (local development only). */
  allowHosts?: string[];
  maxBodyBytes?: number;
  signal?: AbortSignal;
  onProgress?: (p: { crawled: number; queued: number; current: string }) => void;
  /** Check status, type and size of CSS/JS/images/fonts/PDFs used by the pages (default true). */
  checkResources?: boolean;
  /** Check that external links answer (default true). */
  checkExternalLinks?: boolean;
  /** Cap on resources + external URLs checked (default 2000). */
  maxResources?: number;
}

export interface CrawledResource {
  url: string;
  kind: ResourceKind | 'html';
  internal: boolean;
  /** true = found as an <a href> link, false = loaded by the page (src/href of a resource tag). */
  isLink: boolean;
  statusCode: number;
  finalUrl: string;
  redirected: boolean;
  contentType: string;
  sizeBytes: number | null;
  responseTimeMs: number;
  error: string | null;
  foundOn: string[];
  foundOnCount: number;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface CrawledPageData {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  mimeType: string;
  sizeBytes: number;
  xRobotsTag: string | null;
  redirectChain: RedirectHop[];
  depth: number;
  blockedByRobots: boolean;
  error: string | null;
  extracted: ExtractedPage | null;
  inlinks: number;
  /** Raw HTML of 2xx HTML pages (for "view source" and re-analysis). */
  html: string | null;
  /** Selected response headers. */
  headers: Record<string, string>;
}

export interface HostVariantCheck {
  kind: 'http_to_https' | 'www_variant';
  url: string;
  status: number;
  finalUrl: string | null;
  error: string | null;
}

export interface CrawlResult {
  pages: CrawledPageData[];
  resources: CrawledResource[];
  robots: { found: boolean; status: number | null; sitemaps: string[]; crawlDelay: number | null; hash: string | null };
  hostVariants: HostVariantCheck[];
  discovered: number;
  cancelled: boolean;
  limitReached: boolean;
}

export const HARD_MAX_URLS = 5_000;

/** Never crawled: state-changing or private areas and internal search. */
export const DEFAULT_EXCLUDES = [
  '/(logout|log-out|signout|sign-out|salir)\\b',
  '/(cart|carrito|basket|checkout|pago)\\b',
  '/(wp-admin|wp-login\\.php|my-account|mi-cuenta|account)\\b',
  '[?&](s|q|search|query|add-to-cart)=',
  '/search\\b',
  '/(feed|xmlrpc\\.php)\\b'
];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

interface FetchOutcome {
  finalUrl: string;
  status: number;
  chain: RedirectHop[];
  headers: Headers | null;
  body: string | null;
  sizeBytes: number;
  ms: number;
  error: string | null;
}

async function readBody(res: Response, maxBytes: number): Promise<{ text: string; size: number; truncated: boolean }> {
  if (!res.body) return { text: '', size: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), size, truncated };
}

class Throttle {
  private next = 0;
  constructor(private intervalMs: number) {}
  setInterval(ms: number) {
    this.intervalMs = Math.max(this.intervalMs, ms);
  }
  async wait(signal?: AbortSignal) {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    await sleep(at - now, signal);
  }
}

export async function fetchWithRedirects(
  url: string,
  opts: { userAgent: string; timeoutMs: number; allowHosts?: string[]; maxBodyBytes: number; maxHops?: number; readBody?: boolean; anyContentType?: boolean; throttle?: Throttle; signal?: AbortSignal }
): Promise<FetchOutcome> {
  const chain: RedirectHop[] = [];
  const seen = new Set<string>();
  const t0 = Date.now();
  let current = url;
  for (let hop = 0; hop <= (opts.maxHops ?? 10); hop++) {
    if (seen.has(current)) return { finalUrl: current, status: 0, chain, headers: null, body: null, sizeBytes: 0, ms: Date.now() - t0, error: 'Redirect loop' };
    seen.add(current);
    try {
      await assertSafeUrl(current, { allowHosts: opts.allowHosts });
      await opts.throttle?.wait(opts.signal);
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])])
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        chain.push({ url: current, status: res.status });
        await res.body?.cancel();
        const next = normalizeUrl(res.headers.get('location')!, current);
        if (!next) return { finalUrl: current, status: res.status, chain, headers: res.headers, body: null, sizeBytes: 0, ms: Date.now() - t0, error: 'Invalid redirect target' };
        current = next;
        continue;
      }
      const isHtml = /text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '');
      if (opts.readBody === false || (!isHtml && !opts.anyContentType)) {
        await res.body?.cancel();
        return { finalUrl: current, status: res.status, chain, headers: res.headers, body: null, sizeBytes: Number(res.headers.get('content-length') ?? 0), ms: Date.now() - t0, error: null };
      }
      const b = await readBody(res, opts.maxBodyBytes);
      return { finalUrl: current, status: res.status, chain, headers: res.headers, body: b.text, sizeBytes: b.size, ms: Date.now() - t0, error: b.truncated ? `Body truncated at ${opts.maxBodyBytes} bytes` : null };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'TimeoutError' ? `Timeout after ${opts.timeoutMs} ms` : e.message) : String(e);
      return { finalUrl: current, status: 0, chain, headers: null, body: null, sizeBytes: 0, ms: Date.now() - t0, error: msg };
    }
  }
  return { finalUrl: current, status: 0, chain, headers: null, body: null, sizeBytes: 0, ms: Date.now() - t0, error: 'Too many redirects' };
}

/** Checks that http:// and the www/non-www variant of the origin redirect to the canonical origin. */
async function checkHostVariants(origin: URL, opts: Parameters<typeof fetchWithRedirects>[1]): Promise<HostVariantCheck[]> {
  const variants: Array<{ kind: HostVariantCheck['kind']; url: string }> = [];
  if (origin.protocol === 'https:') variants.push({ kind: 'http_to_https', url: `http://${origin.host}/` });
  const isIpOrLocal = net.isIP(origin.hostname) !== 0 || origin.hostname === 'localhost' || !origin.hostname.includes('.');
  if (!isIpOrLocal) {
    const altHost = origin.hostname.startsWith('www.') ? origin.hostname.slice(4) : `www.${origin.hostname}`;
    variants.push({ kind: 'www_variant', url: `${origin.protocol}//${altHost}${origin.port ? `:${origin.port}` : ''}/` });
  }
  const out: HostVariantCheck[] = [];
  for (const v of variants) {
    const r = await fetchWithRedirects(v.url, { ...opts, readBody: false });
    out.push({ kind: v.kind, url: v.url, status: r.chain[0]?.status ?? r.status, finalUrl: r.status ? r.finalUrl : null, error: r.error });
  }
  return out;
}

export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const start = new URL(normalizeUrl(options.startUrl) ?? options.startUrl);
  const host = start.hostname;
  const userAgent = options.userAgent ?? 'GlitchSeoOpsBot/0.2 (+https://github.com/glitch-seo-ops)';
  const maxUrls = Math.min(options.maxUrls ?? 500, HARD_MAX_URLS);
  const maxDepth = options.maxDepth ?? 5;
  const concurrency = Math.min(Math.max(options.concurrency ?? 2, 1), 8);
  const throttle = new Throttle(1000 / Math.min(Math.max(options.rps ?? 2, 0.1), 20));
  const fetchOpts = {
    userAgent,
    timeoutMs: options.timeoutMs ?? 15_000,
    allowHosts: options.allowHosts,
    maxBodyBytes: options.maxBodyBytes ?? 5 * 1024 * 1024,
    throttle,
    signal: options.signal
  };
  const include = (options.include ?? []).map(p => new RegExp(p, 'i'));
  const exclude = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])].map(p => new RegExp(p, 'i'));

  // robots.txt
  let robots: RobotsTxt = { groups: [], sitemaps: [] };
  const robotsInfo: CrawlResult['robots'] = { found: false, status: null, sitemaps: [], crawlDelay: null, hash: null };
  const r = await fetchWithRedirects(`${start.origin}/robots.txt`, { ...fetchOpts, anyContentType: true, maxBodyBytes: 500_000 });
  robotsInfo.status = r.status || null;
  if (r.status === 200 && r.body !== null) {
    robots = parseRobotsTxt(r.body);
    robotsInfo.found = true;
    robotsInfo.hash = crypto.createHash('sha256').update(r.body).digest('hex').slice(0, 16);
    robotsInfo.sitemaps = robots.sitemaps;
    const delay = crawlDelayFor(robots, userAgent);
    if (delay !== undefined) {
      robotsInfo.crawlDelay = delay;
      throttle.setInterval(Math.min(delay, 30) * 1000);
    }
  }
  const respectRobots = options.respectRobots !== false;

  const pages: CrawledPageData[] = [];
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  const linkGraph = new Map<string, Set<string>>(); // target -> sources
  let limitReached = false;

  const allowedByFilters = (u: string) => {
    const url = new URL(u);
    if (url.hostname !== host) return false;
    const pq = url.pathname + url.search;
    if (exclude.some(re => re.test(pq))) return false;
    if (include.length && !include.some(re => re.test(pq))) return false;
    return true;
  };
  const enqueue = (u: string, depth: number) => {
    if (visited.has(u) || depth > maxDepth || !allowedByFilters(u)) return;
    if (visited.size >= maxUrls) {
      limitReached = true;
      return;
    }
    visited.add(u);
    queue.push({ url: u, depth });
  };

  enqueue(start.toString(), 0);
  for (const s of options.seeds ?? []) {
    const n = normalizeUrl(s);
    if (n) enqueue(n, 1);
  }

  const crawlOne = async ({ url, depth }: { url: string; depth: number }) => {
    const u = new URL(url);
    if (respectRobots && !isAllowedByRobots(robots, userAgent, u.pathname + u.search)) {
      pages.push({ url, finalUrl: url, statusCode: 0, responseTimeMs: 0, mimeType: '', sizeBytes: 0, xRobotsTag: null, redirectChain: [], depth, blockedByRobots: true, error: 'Blocked by robots.txt', extracted: null, inlinks: 0, html: null, headers: {} });
      return;
    }
    const res = await fetchWithRedirects(url, fetchOpts);
    const finalSameHost = new URL(res.finalUrl).hostname === host;
    let extracted: ExtractedPage | null = null;
    if (res.chain.length) {
      // The redirect target is crawled as its own page (same depth) so its status and content are recorded once.
      if (finalSameHost) {
        if (!linkGraph.has(res.finalUrl)) linkGraph.set(res.finalUrl, new Set());
        linkGraph.get(res.finalUrl)!.add(url);
        enqueue(res.finalUrl, depth);
      }
    } else if (res.body && res.status >= 200 && res.status < 300) {
      extracted = extractPage(res.body, res.finalUrl);
      for (const link of extracted.internalLinks) {
        if (!linkGraph.has(link)) linkGraph.set(link, new Set());
        linkGraph.get(link)!.add(url);
        // Files (PDF, images, docs…) are checked as resources, not crawled as pages.
        if (!resourceKindFromUrl(link)) enqueue(link, depth + 1);
      }
    }
    pages.push({
      url,
      finalUrl: res.finalUrl,
      statusCode: res.status,
      responseTimeMs: res.ms,
      mimeType: res.headers?.get('content-type')?.split(';')[0] ?? '',
      sizeBytes: res.sizeBytes,
      xRobotsTag: res.headers?.get('x-robots-tag') ?? null,
      redirectChain: res.chain,
      depth,
      blockedByRobots: false,
      error: res.error,
      extracted,
      inlinks: 0,
      html: extracted ? res.body : null,
      headers: Object.fromEntries(['content-type', 'cache-control', 'content-encoding', 'last-modified', 'etag', 'x-robots-tag', 'link', 'server', 'vary'].map(h => [h, res.headers?.get(h)]).filter((e): e is [string, string] => !!e[1]))
    });
  };

  const hostVariants = await checkHostVariants(start, fetchOpts);

  // Worker pool over a growing queue.
  let active = 0;
  let cancelled = false;
  await new Promise<void>(resolve => {
    const pump = () => {
      if (options.signal?.aborted) cancelled = true;
      while (!cancelled && active < concurrency && queue.length) {
        const item = queue.shift()!;
        active++;
        options.onProgress?.({ crawled: pages.length, queued: queue.length, current: item.url });
        crawlOne(item)
          .catch(() => undefined)
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (queue.length === 0 || cancelled)) resolve();
    };
    pump();
  });

  for (const p of pages) p.inlinks = linkGraph.get(p.url)?.size ?? 0;
  const resources = cancelled ? [] : await checkResources(pages, host, options, fetchOpts, () => cancelled || !!options.signal?.aborted);
  return { pages, resources, robots: robotsInfo, hostVariants, discovered: visited.size, cancelled, limitReached };
}

/**
 * Checks every file the crawled pages use (CSS, JS, images, fonts, PDFs, media) and every external link:
 * status, final URL, content type and size. Bodies are never downloaded (the response is cancelled after the headers).
 * Internal URLs share the site throttle; external hosts get their own polite rate.
 */
async function checkResources(
  pages: CrawledPageData[],
  host: string,
  options: CrawlOptions,
  fetchOpts: Parameters<typeof fetchWithRedirects>[1],
  stop: () => boolean
): Promise<CrawledResource[]> {
  const wantRes = options.checkResources !== false;
  const wantExt = options.checkExternalLinks !== false;
  if (!wantRes && !wantExt) return [];
  const crawled = new Set(pages.map(p => p.url));
  const found = new Map<string, { kind: CrawledResource['kind']; internal: boolean; isLink: boolean; pages: Set<string> }>();
  const add = (url: string, kind: CrawledResource['kind'], isLink: boolean, page: string) => {
    if (crawled.has(url)) return;
    let internal: boolean;
    try {
      internal = new URL(url).hostname === host;
    } catch {
      return;
    }
    const e = found.get(url) ?? { kind, internal, isLink, pages: new Set<string>() };
    e.isLink = e.isLink && isLink;
    e.pages.add(page);
    found.set(url, e);
  };
  for (const p of pages) {
    if (!p.extracted) continue;
    if (wantRes) for (const r of p.extracted.resources) add(r.url, r.kind, false, p.url);
    if (wantExt) for (const l of p.extracted.links) if (!l.internal) add(l.url, resourceKindFromUrl(l.url) ?? 'html', true, p.url);
  }
  const max = Math.min(options.maxResources ?? 2000, 10_000);
  const todo = [...found].slice(0, max);
  const extThrottles = new Map<string, Throttle>();
  const throttleFor = (u: string, internal: boolean) => {
    if (internal) return fetchOpts.throttle;
    const h = new URL(u).hostname;
    if (!extThrottles.has(h)) extThrottles.set(h, new Throttle(500));
    return extThrottles.get(h);
  };
  const out: CrawledResource[] = [];
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !stop()) {
      const [url, e] = todo[i++];
      const r = await fetchWithRedirects(url, { ...fetchOpts, readBody: false, anyContentType: true, maxHops: 5, timeoutMs: Math.min(fetchOpts.timeoutMs, 10_000), throttle: throttleFor(url, e.internal) });
      const len = r.headers?.get('content-length');
      out.push({
        url,
        kind: e.kind,
        internal: e.internal,
        isLink: e.isLink,
        statusCode: r.status,
        finalUrl: r.finalUrl,
        redirected: r.chain.length > 0,
        contentType: r.headers?.get('content-type')?.split(';')[0].trim() ?? '',
        sizeBytes: len ? Number(len) : null,
        responseTimeMs: r.ms,
        error: r.error,
        foundOn: [...e.pages].slice(0, 20),
        foundOnCount: e.pages.size
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return out;
}

/** Internal links pointing to URLs that returned 4xx/5xx in this crawl (source -> target). */
export function findBrokenLinks(pages: CrawledPageData[]): Array<{ source: string; target: string; status: number }> {
  const status = new Map(pages.map(p => [p.url, p.statusCode]));
  const out: Array<{ source: string; target: string; status: number }> = [];
  for (const p of pages) {
    for (const l of p.extracted?.internalLinks ?? []) {
      const s = status.get(l);
      if (s !== undefined && s >= 400) out.push({ source: p.finalUrl, target: l, status: s });
    }
  }
  return out;
}
