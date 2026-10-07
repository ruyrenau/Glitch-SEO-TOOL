import crypto from 'crypto';
import * as cheerio from 'cheerio';

export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  robotsMeta: string | null;
  canonical: string | null;
  h1: string[];
  h2Count: number;
  lang: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  ogTitle: string | null;
  schemaTypes: string[];
  schemaErrors: string[];
  internalLinks: string[];
  externalLinks: number;
  nofollowLinks: number;
  imagesMissingAlt: number;
  images: number;
  wordCount: number;
  contentHash: string | null;
}

/** Strips fragment, lowercases host, drops default ports. Returns null for non-http(s). */
export function normalizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  return u.toString();
}

function collectTypes(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) return node.forEach(n => collectTypes(n, out));
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) t.forEach(x => typeof x === 'string' && out.add(x));
  if (obj['@graph']) collectTypes(obj['@graph'], out);
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).hostname.toLowerCase();
  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? normalizeUrl(baseHref, pageUrl) ?? pageUrl : pageUrl;
  const text = (sel: string) => $(sel).first().text().trim() || null;
  const attr = (sel: string, a: string) => $(sel).first().attr(a)?.trim() || null;

  // JSON-LD
  const types = new Set<string>();
  const schemaErrors: string[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    const raw = $(el).text();
    try {
      collectTypes(JSON.parse(raw), types);
    } catch (e) {
      schemaErrors.push(`Block ${i + 1}: ${(e as Error).message.slice(0, 120)}`);
    }
  });

  // Links
  const internal = new Set<string>();
  let external = 0;
  let nofollow = 0;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (/^(mailto|tel|javascript):/i.test(href)) return;
    const abs = normalizeUrl(href, base);
    if (!abs) return;
    if (/\bnofollow\b/i.test($(el).attr('rel') ?? '')) nofollow++;
    if (new URL(abs).hostname === host) internal.add(abs);
    else external++;
  });

  const imgs = $('img');
  const missingAlt = imgs.filter((_, el) => $(el).attr('alt') === undefined).length;

  // Main content: drop chrome before counting words / hashing (duplicate detection).
  const $c = cheerio.load(html);
  $c('script, style, noscript, template, svg, nav, header, footer, aside, form').remove();
  $c('body *').after(' '); // keep words from adjacent elements apart
  const mainRoot = $c('main').length ? $c('main') : $c('body');
  const mainText = mainRoot.text().replace(/\s+/g, ' ').trim();
  const words = mainText ? mainText.split(' ').length : 0;

  return {
    title: text('head > title') ?? text('title'),
    metaDescription: attr('meta[name="description" i]', 'content'),
    robotsMeta: $('meta[name="robots" i], meta[name="googlebot" i]').map((_, el) => $(el).attr('content') ?? '').get().join(', ') || null,
    canonical: (() => {
      const c = attr('link[rel="canonical" i]', 'href');
      return c ? normalizeUrl(c, base) : null;
    })(),
    h1: $('h1').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get(),
    h2Count: $('h2').length,
    lang: attr('html', 'lang'),
    hreflang: $('link[rel="alternate" i][hreflang]')
      .map((_, el) => ({ lang: $(el).attr('hreflang') ?? '', href: normalizeUrl($(el).attr('href') ?? '', base) ?? '' }))
      .get(),
    ogTitle: attr('meta[property="og:title"]', 'content'),
    schemaTypes: [...types],
    schemaErrors,
    internalLinks: [...internal],
    externalLinks: external,
    nofollowLinks: nofollow,
    imagesMissingAlt: missingAlt,
    images: imgs.length,
    wordCount: words,
    contentHash: words ? crypto.createHash('sha256').update(mainText.toLowerCase()).digest('hex').slice(0, 32) : null
  };
}
