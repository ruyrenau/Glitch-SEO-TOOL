import { assertSafeUrl, SafeUrlOptions } from './ssrf';

export interface SitemapEntry {
  url: string;
  path: string;
  lastmod: Date | null;
}

export interface ParsedSitemap {
  kind: 'urlset' | 'sitemapindex' | 'unknown';
  urls: SitemapEntry[];
  childSitemaps: string[];
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

/**
 * Minimal, dependency-free sitemap parser. It only reads <loc>/<lastmod>
 * and never resolves entities or DTDs (no XXE surface).
 */
export function parseSitemapXml(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const isUrlset = /<urlset[\s>]/i.test(xml);
  const blockTag = isIndex ? 'sitemap' : 'url';
  const blocks = xml.match(new RegExp(`<${blockTag}[\\s>][\\s\\S]*?</${blockTag}>`, 'gi')) ?? [];
  const urls: SitemapEntry[] = [];
  const childSitemaps: string[] = [];

  for (const block of blocks) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(block)?.[1];
    if (!loc) continue;
    const href = decodeXml(loc.replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    if (isIndex) {
      childSitemaps.push(href);
      continue;
    }
    let path: string;
    try {
      const u = new URL(href);
      path = u.pathname + u.search;
    } catch {
      continue;
    }
    const lm = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1];
    const lastmod = lm ? new Date(decodeXml(lm)) : null;
    urls.push({ url: href, path, lastmod: lastmod && !isNaN(lastmod.getTime()) ? lastmod : null });
  }
  return { kind: isIndex ? 'sitemapindex' : isUrlset ? 'urlset' : 'unknown', urls, childSitemaps };
}

export interface FetchSitemapOptions extends SafeUrlOptions {
  userAgent?: string;
  maxSitemaps?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

async function fetchText(url: string, opts: FetchSitemapOptions): Promise<string> {
  await assertSafeUrl(url, opts);
  const res = await fetch(url, {
    headers: { 'user-agent': opts.userAgent ?? 'GlitchSeoOpsBot/1.0 (+https://github.com/glitch-seo-ops)' },
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`Redirect without location from ${url}`);
    return fetchText(new URL(loc, url).toString(), opts);
  }
  if (!res.ok) throw new Error(`Sitemap ${url} returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > (opts.maxBytes ?? 50 * 1024 * 1024)) throw new Error(`Sitemap ${url} exceeds size limit`);
  return text;
}

/** Fetches a sitemap or sitemap index (following children) with SSRF protection. */
export async function fetchSitemap(url: string, opts: FetchSitemapOptions = {}): Promise<{ urls: SitemapEntry[]; fetched: string[]; errors: string[] }> {
  const queue = [url];
  const fetched: string[] = [];
  const errors: string[] = [];
  const urls: SitemapEntry[] = [];
  const max = opts.maxSitemaps ?? 50;
  while (queue.length && fetched.length < max) {
    const next = queue.shift()!;
    try {
      const parsed = parseSitemapXml(await fetchText(next, opts));
      fetched.push(next);
      urls.push(...parsed.urls);
      queue.push(...parsed.childSitemaps.filter(c => !fetched.includes(c)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { urls, fetched, errors };
}
