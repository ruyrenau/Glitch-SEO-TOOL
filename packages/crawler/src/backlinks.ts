import * as cheerio from 'cheerio';

/**
 * Backlink checking (pure functions): which CSV export a file comes from, whether a linking page still links to
 * the site (and how: rel, anchor), and plain-rule spam signals. Google ignores most spam links by itself, so the
 * signals are only hints to review, never an automatic disavow.
 */

export type BacklinkFormat = 'gsc' | 'ahrefs' | 'semrush' | 'moz' | 'majestic' | 'generic';

const norm = (h: string) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Column indexes for source URL, target URL and anchor, from the header row of a CSV export. */
export function detectBacklinkColumns(header: string[]): { format: BacklinkFormat; source: number; target: number; anchor: number } | null {
  const h = header.map(norm);
  const find = (...patterns: RegExp[]) => {
    for (const re of patterns) {
      const i = h.findIndex(x => re.test(x));
      if (i >= 0) return i;
    }
    return -1;
  };
  const source = find(/^referring page url$/, /^source url$/, /^source page$/, /^linking page$/, /^pagina de enlace$/, /^pagina que enlaza$/, /^url de origen$/, /^sourceurl$/, /^from url$/, /^url$/, /referring|source|linking|origen|enlaza/);
  if (source < 0) return null;
  const target = find(/^target url$/, /^target page$/, /^targeturl$/, /^url de destino$/, /^to url$/, /^pagina de destino$/, /target|destino/);
  const anchor = find(/^anchor$/, /^anchor text$/, /^anchortext$/, /^texto del enlace$/, /^texto de anclaje$/, /anchor|ancla/);
  const raw = header.join(' ').toLowerCase();
  const format: BacklinkFormat = /referring page url/.test(raw) ? 'ahrefs' : /source url/.test(raw) && /first seen|last seen/.test(raw) ? 'semrush' : /sourceurl|targeturl/.test(raw) ? 'majestic' : /linking page|pagina de enlace|última rastreo|last crawled/.test(raw) ? 'gsc' : /url.*target url|target url.*url/.test(raw) && /domain authority|page authority|spam score/.test(raw) ? 'moz' : 'generic';
  return { format, source, target: target === source ? -1 : target, anchor };
}

export const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
const sameSite = (host: string, siteHost: string) => {
  const a = host.replace(/^www\./, '');
  const b = siteHost.replace(/^www\./, '');
  return a === b || a.endsWith(`.${b}`);
};
const path = (u: URL) => u.pathname.replace(/\/+$/, '') + u.search;

export interface LinkOnPage {
  found: boolean;
  href: string | null;
  rel: string | null;
  anchor: string | null;
  /** External links on the page (a link farm has hundreds). */
  outlinks: number;
  /** All the links to the site on that page (the expected one may be gone while others remain). */
  siteLinks: number;
}

/** Looks for links to the site in a linking page; prefers the one pointing to `targetUrl` when known. */
export function findLinkOnPage(html: string, pageUrl: string, siteHost: string, targetUrl?: string | null): LinkOnPage {
  const $ = cheerio.load(html);
  const pageHost = domainOf(pageUrl);
  let outlinks = 0;
  const toSite: Array<{ href: string; rel: string; anchor: string; exact: boolean }> = [];
  let want: URL | null = null;
  try {
    want = targetUrl ? new URL(targetUrl) : null;
  } catch {
    want = null;
  }
  $('a[href]').each((_, el) => {
    let u: URL;
    try {
      u = new URL($(el).attr('href')!, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol)) return;
    const host = u.hostname.toLowerCase();
    if (host.replace(/^www\./, '') !== pageHost) outlinks++;
    if (!sameSite(host, siteHost)) return;
    const relTokens = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/).filter(r => ['nofollow', 'sponsored', 'ugc'].includes(r));
    const anchor = $(el).text().replace(/\s+/g, ' ').trim() || ($(el).find('img').attr('alt') ? `[imagen: ${$(el).find('img').attr('alt')}]` : '[imagen]');
    toSite.push({ href: u.toString(), rel: relTokens.length ? relTokens.join(',') : 'follow', anchor: anchor.slice(0, 300), exact: !!want && sameSite(u.hostname, want.hostname) && path(u) === path(want) });
  });
  // A page-level meta robots nofollow makes every link nofollow.
  const metaNofollow = /nofollow/i.test($('meta[name="robots"]').attr('content') ?? '');
  const hit = toSite.find(l => l.exact) ?? (want ? null : toSite[0]) ?? null;
  return {
    found: !!hit,
    href: hit?.href ?? null,
    rel: hit ? (metaNofollow && hit.rel === 'follow' ? 'nofollow' : hit.rel) : null,
    anchor: hit?.anchor ?? null,
    outlinks,
    siteLinks: toSite.length
  };
}

const SPAM_TLD = /\.(xyz|top|click|loan|work|gq|tk|ml|cf|ga|buzz|rest|bid|win|review|date|stream|racing|download|cricket|science|party|trade|webcam|accountant|faith|men)$/i;
const SPAM_WORDS = /\b(casino|viagra|cialis|porn|xxx|escort|sex|loan|payday|crypto|bitcoin|forex|bet|apuestas|replica|pharma|pills|seo[- ]?backlinks?|buy[- ]?links?)\b/i;

/** Plain-rule signals of a manipulative link (0–100). Review before doing anything with them. */
export function spamSignals(input: { sourceUrl: string; anchor?: string | null; outlinks?: number | null }) {
  const reasons: string[] = [];
  let score = 0;
  const d = domainOf(input.sourceUrl);
  if (SPAM_TLD.test(d)) {
    score += 20;
    reasons.push(`Dominio con extensión muy usada para spam (.${d.split('.').pop()}).`);
  }
  if ((d.match(/-/g) ?? []).length >= 3 || /\d{4,}/.test(d)) {
    score += 15;
    reasons.push('Nombre de dominio con muchos guiones o números (típico de redes de enlaces).');
  }
  if (SPAM_WORDS.test(`${d} ${input.sourceUrl} ${input.anchor ?? ''}`)) {
    score += 40;
    reasons.push('Palabras de temas spam (casino, farmacia, préstamos, adultos…) en el dominio, la URL o el texto del enlace.');
  }
  if ((input.outlinks ?? 0) >= 150) {
    score += 25;
    reasons.push(`La página tiene ${input.outlinks} enlaces a otros sitios (parece un directorio o una granja de enlaces).`);
  }
  return { score: Math.min(100, score), reasons };
}
