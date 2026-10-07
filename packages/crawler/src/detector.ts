import type { IssueSeverity } from '@glitch/core';
import type { CrawlResult, CrawledPageData } from './crawl';
import { findBrokenLinks } from './crawl';

export interface DetectedIssue {
  code: string;
  title: string;
  category: 'INDEXABILITY' | 'CRAWLABILITY' | 'CANONICAL' | 'METADATA' | 'CONTENT' | 'PERFORMANCE' | 'STRUCTURED_DATA' | 'INTERNATIONAL' | 'ACCESSIBILITY';
  severity: IssueSeverity;
  description: string;
  recommendation: string;
  impact: number; // 1-10
  effort: number; // 1-10
  risk: number; // 1-10
  confidence: number; // 0-1
  affectedUrls: string[];
  evidence?: Record<string, unknown>;
}

export interface AuditContext {
  environment: 'production' | 'staging' | 'development' | string;
  /** Absolute URLs listed in the sitemap. */
  sitemapUrls?: Set<string>;
}

export interface Indexability {
  indexable: boolean;
  reason: string | null;
}

const isNoindex = (p: CrawledPageData) => /noindex|none/i.test(`${p.extracted?.robotsMeta ?? ''} ${p.xRobotsTag ?? ''}`);

export function indexabilityOf(p: CrawledPageData): Indexability {
  if (p.blockedByRobots) return { indexable: false, reason: 'Blocked by robots.txt' };
  if (p.statusCode === 0) return { indexable: false, reason: p.error ?? 'Not fetched' };
  if (p.redirectChain.length) return { indexable: false, reason: `Redirects (${p.redirectChain[0].status})` };
  if (p.statusCode !== 200) return { indexable: false, reason: `HTTP ${p.statusCode}` };
  if (!p.extracted) return { indexable: false, reason: `Not HTML (${p.mimeType || 'unknown'})` };
  if (isNoindex(p)) return { indexable: false, reason: 'noindex' };
  const c = p.extracted.canonical;
  if (c && c !== p.url) return { indexable: false, reason: `Canonicalized to ${c}` };
  return { indexable: true, reason: null };
}

const groupBy = <T>(items: T[], key: (t: T) => string | null | undefined) => {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return m;
};

/**
 * Runs every rule against a crawl. Rules only fire with evidence from this crawl;
 * nothing is inferred from data we did not observe.
 */
export function auditCrawl(result: CrawlResult, ctx: AuditContext): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const add = (i: Omit<DetectedIssue, 'confidence'> & { confidence?: number }) => {
    if (i.affectedUrls.length) issues.push({ confidence: 0.9, ...i, affectedUrls: [...new Set(i.affectedUrls)] });
  };
  const pages = result.pages;
  const byUrl = new Map(pages.map(p => [p.url, p]));
  const html200 = pages.filter(p => p.statusCode === 200 && !p.redirectChain.length && p.extracted);
  const indexable = html200.filter(p => indexabilityOf(p).indexable);
  const sitemap = ctx.sitemapUrls ?? new Set<string>();
  const inSitemap = (p: CrawledPageData) => sitemap.has(p.url);
  const prod = ctx.environment === 'production';

  // --- HTTP status & crawlability -------------------------------------------------
  add({
    code: 'HTTP_4XX', title: 'Internal URLs returning 4xx', category: 'CRAWLABILITY', severity: 'HIGH',
    description: 'Crawled URLs answered with a client error.',
    recommendation: 'Fix or remove the links pointing to them, or 301-redirect to the closest live page.',
    impact: 7, effort: 3, risk: 2,
    affectedUrls: pages.filter(p => p.statusCode >= 400 && p.statusCode < 500).map(p => p.url)
  });
  add({
    code: 'HTTP_5XX', title: 'Internal URLs returning 5xx', category: 'CRAWLABILITY', severity: 'CRITICAL',
    description: 'Server errors during the crawl. Persistent 5xx reduce crawl rate and can drop pages from the index.',
    recommendation: 'Check application and upstream logs for these URLs; confirm whether the error is reproducible.',
    impact: 9, effort: 5, risk: 3,
    affectedUrls: pages.filter(p => p.statusCode >= 500).map(p => p.url)
  });
  add({
    code: 'FETCH_FAILED', title: 'URLs that could not be fetched', category: 'CRAWLABILITY', severity: 'MEDIUM',
    description: 'Timeouts, DNS or connection errors, oversized bodies.',
    recommendation: 'Review the error per URL; repeated timeouts usually indicate slow templates or rate limiting.',
    impact: 6, effort: 4, risk: 2, confidence: 0.7,
    affectedUrls: pages.filter(p => p.statusCode === 0 && !p.blockedByRobots && p.error !== 'Redirect loop').map(p => p.url),
    evidence: { errors: Object.fromEntries(pages.filter(p => p.statusCode === 0 && !p.blockedByRobots).slice(0, 50).map(p => [p.url, p.error])) }
  });
  add({
    code: 'REDIRECT_LOOP', title: 'Redirect loops', category: 'CRAWLABILITY', severity: 'CRITICAL',
    description: 'The redirect chain returns to a URL already visited.',
    recommendation: 'Fix the redirect rules so each URL resolves to a final 200 page.',
    impact: 9, effort: 3, risk: 3,
    affectedUrls: pages.filter(p => p.error === 'Redirect loop').map(p => p.url)
  });
  const chains = pages.filter(p => p.redirectChain.length >= 2 && p.error !== 'Redirect loop');
  add({
    code: 'REDIRECT_CHAIN', title: 'Redirect chains (2+ hops)', category: 'CRAWLABILITY', severity: 'MEDIUM',
    description: 'Each extra hop costs a request and delays the final page.',
    recommendation: 'Point the first redirect (and internal links) straight to the final URL.',
    impact: 5, effort: 2, risk: 2,
    affectedUrls: chains.map(p => p.url),
    evidence: { chains: Object.fromEntries(chains.slice(0, 50).map(p => [p.url, [...p.redirectChain.map(h => `${h.status} ${h.url}`), `→ ${p.finalUrl}`]])) }
  });
  add({
    code: 'INTERNAL_LINKS_TO_REDIRECTS', title: 'Internal links pointing to redirects', category: 'CRAWLABILITY', severity: 'LOW',
    description: 'Pages link to URLs that redirect instead of linking to the destination.',
    recommendation: 'Update internal links to the final URL.',
    impact: 3, effort: 2, risk: 1,
    affectedUrls: pages.filter(p => p.redirectChain.length && p.inlinks > 0).map(p => p.url)
  });
  const broken = findBrokenLinks(pages);
  add({
    code: 'BROKEN_INTERNAL_LINKS', title: 'Pages with broken internal links', category: 'CRAWLABILITY', severity: 'HIGH',
    description: 'Pages contain links to URLs that returned 4xx/5xx in this crawl.',
    recommendation: 'Edit or remove these links.',
    impact: 6, effort: 2, risk: 1,
    affectedUrls: broken.map(b => b.source),
    evidence: { links: broken.slice(0, 100) }
  });
  add({
    code: 'ROBOTS_BLOCKED', title: 'URLs blocked by robots.txt', category: 'CRAWLABILITY', severity: 'INFO',
    description: 'Linked URLs that robots.txt disallows for this crawler. Often intentional.',
    recommendation: 'Confirm each blocked section is meant to be blocked.',
    impact: 3, effort: 1, risk: 3, confidence: 0.6,
    affectedUrls: pages.filter(p => p.blockedByRobots && !inSitemap(p)).map(p => p.url)
  });
  add({
    code: 'ROBOTS_MISSING', title: 'robots.txt not found', category: 'CRAWLABILITY', severity: 'LOW',
    description: `robots.txt returned ${result.robots.status ?? 'no response'}.`,
    recommendation: 'Serve a robots.txt (even an allow-all one) that also lists the sitemap.',
    impact: 3, effort: 1, risk: 1,
    affectedUrls: result.robots.found ? [] : [new URL('/robots.txt', pages[0]?.url ?? 'http://invalid').toString()]
  });
  add({
    code: 'ROBOTS_NO_SITEMAP', title: 'robots.txt does not reference a sitemap', category: 'CRAWLABILITY', severity: 'INFO',
    description: 'A Sitemap: line helps every crawler discover the sitemap.',
    recommendation: 'Add "Sitemap: https://…/sitemap.xml" to robots.txt.',
    impact: 2, effort: 1, risk: 1,
    affectedUrls: result.robots.found && !result.robots.sitemaps.length ? [new URL('/robots.txt', pages[0]?.url ?? 'http://invalid').toString()] : []
  });
  for (const v of result.hostVariants) {
    const isHttp = v.kind === 'http_to_https';
    const target = pages[0] ? new URL(pages[0].url).origin : '';
    const ok = v.finalUrl !== null && v.finalUrl.startsWith(target) && v.status >= 300 && v.status < 400;
    if (ok || (v.error && /ENOTFOUND|getaddrinfo|unresolvable/i.test(v.error))) continue;
    add({
      code: isHttp ? 'HTTP_NOT_REDIRECTED_TO_HTTPS' : 'HOST_VARIANT_NOT_REDIRECTED',
      title: isHttp ? 'HTTP version does not redirect to HTTPS' : 'www / non-www variant does not redirect',
      category: 'CANONICAL', severity: 'HIGH',
      description: `${v.url} answered ${v.status || v.error} and ended at ${v.finalUrl ?? 'nothing'} instead of redirecting to ${target}.`,
      recommendation: 'Add a single 301 from every protocol/host variant to the canonical origin.',
      impact: 7, effort: 2, risk: 3,
      affectedUrls: [v.url],
      evidence: { ...v }
    });
  }

  // --- Indexability ---------------------------------------------------------------
  const noindex = html200.filter(isNoindex);
  add({
    code: 'NOINDEX_IN_SITEMAP', title: 'noindex pages listed in the sitemap', category: 'INDEXABILITY', severity: prod ? 'CRITICAL' : 'MEDIUM',
    description: 'The sitemap asks for indexing while the page asks not to be indexed. One of the two is wrong.',
    recommendation: 'Remove noindex if the page should rank (common after a staging deploy), otherwise remove it from the sitemap.',
    impact: 9, effort: 1, risk: 3,
    affectedUrls: noindex.filter(inSitemap).map(p => p.url)
  });
  add({
    code: 'NOINDEX', title: 'Pages with noindex', category: 'INDEXABILITY', severity: 'INFO',
    description: 'Pages excluded from the index via meta robots or X-Robots-Tag. Review that each is intentional.',
    recommendation: 'Keep noindex only on pages that should not appear in search.',
    impact: 4, effort: 1, risk: 3, confidence: 0.5,
    affectedUrls: noindex.filter(p => !inSitemap(p)).map(p => p.url)
  });
  add({
    code: 'STAGING_INDEXABLE', title: 'Staging site is indexable', category: 'INDEXABILITY', severity: 'CRITICAL',
    description: 'This site is registered as staging/development but serves indexable pages (no noindex, not blocked).',
    recommendation: 'Protect staging with authentication or X-Robots-Tag: noindex on every response.',
    impact: 9, effort: 2, risk: 2,
    affectedUrls: ctx.environment !== 'production' ? indexable.slice(0, 200).map(p => p.url) : []
  });
  if (sitemap.size) {
    const smNonIndexable = pages.filter(p => inSitemap(p) && !indexabilityOf(p).indexable && !isNoindex(p));
    add({
      code: 'SITEMAP_NON_INDEXABLE', title: 'Sitemap lists non-indexable URLs', category: 'INDEXABILITY', severity: 'HIGH',
      description: 'Sitemap URLs that redirect, error, are blocked or canonicalize elsewhere.',
      recommendation: 'The sitemap should only contain final, 200, self-canonical URLs.',
      impact: 7, effort: 2, risk: 1,
      affectedUrls: smNonIndexable.map(p => p.url),
      evidence: { reasons: Object.fromEntries(smNonIndexable.slice(0, 100).map(p => [p.url, indexabilityOf(p).reason])) }
    });
    add({
      code: 'INDEXABLE_NOT_IN_SITEMAP', title: 'Indexable pages missing from the sitemap', category: 'INDEXABILITY', severity: 'LOW',
      description: 'Crawlable, indexable pages that the sitemap does not list.',
      recommendation: 'Add them to the sitemap if they should rank; otherwise consider noindex or removing links.',
      impact: 4, effort: 2, risk: 1, confidence: 0.8,
      affectedUrls: indexable.filter(p => !inSitemap(p)).map(p => p.url)
    });
    add({
      code: 'SITEMAP_ORPHAN', title: 'Sitemap pages without internal links (orphans)', category: 'CRAWLABILITY', severity: 'MEDIUM',
      description: 'Pages reached only through the sitemap: no crawled page links to them. Estimated from the crawled subset.',
      recommendation: 'Link them from relevant category or hub pages, or retire them.',
      impact: 6, effort: 3, risk: 1, confidence: result.limitReached ? 0.5 : 0.8,
      affectedUrls: html200.filter(p => inSitemap(p) && p.inlinks === 0 && p.depth > 0).map(p => p.url)
    });
  }

  // --- Canonicals -----------------------------------------------------------------
  add({
    code: 'CANONICAL_MISSING', title: 'Missing canonical', category: 'CANONICAL', severity: 'MEDIUM',
    description: 'Indexable HTML pages without rel=canonical.',
    recommendation: 'Add a self-referencing canonical to every indexable page.',
    impact: 5, effort: 2, risk: 1,
    affectedUrls: html200.filter(p => !p.extracted!.canonical && !isNoindex(p)).map(p => p.url)
  });
  const badCanon = html200.filter(p => {
    const c = p.extracted!.canonical;
    if (!c || c === p.url) return false;
    const target = byUrl.get(c);
    return target ? target.statusCode !== 200 || target.redirectChain.length > 0 || isNoindex(target) : false;
  });
  add({
    code: 'CANONICAL_TO_NON_INDEXABLE', title: 'Canonical points to a redirect, error or noindex URL', category: 'CANONICAL', severity: 'HIGH',
    description: 'Search engines usually ignore a canonical whose target is not a clean 200 page.',
    recommendation: 'Point the canonical to the final, indexable URL.',
    impact: 7, effort: 2, risk: 2,
    affectedUrls: badCanon.map(p => p.url),
    evidence: { canonicals: Object.fromEntries(badCanon.slice(0, 50).map(p => [p.url, p.extracted!.canonical])) }
  });
  const crossHost = html200.filter(p => p.extracted!.canonical && new URL(p.extracted!.canonical!).hostname !== new URL(p.url).hostname);
  add({
    code: 'CANONICAL_CROSS_HOST', title: 'Canonical points to another host', category: 'CANONICAL', severity: 'HIGH',
    description: 'The canonical sends signals to a different hostname (often staging or http/www mix-ups).',
    recommendation: 'Confirm the cross-host canonical is intentional.',
    impact: 8, effort: 2, risk: 3, confidence: 0.7,
    affectedUrls: crossHost.map(p => p.url)
  });
  const paramIndexable = indexable.filter(p => new URL(p.url).search);
  add({
    code: 'PARAMETER_URLS_INDEXABLE', title: 'Parameterized URLs are indexable', category: 'CANONICAL', severity: 'MEDIUM',
    description: 'URLs with query strings are self-canonical and indexable, which can multiply near-duplicates (facets, sorting, tracking).',
    recommendation: 'Canonicalize parameter variants to the clean URL or block crawl of non-valuable facets.',
    impact: 5, effort: 3, risk: 3, confidence: 0.7,
    affectedUrls: paramIndexable.map(p => p.url)
  });

  // --- Metadata --------------------------------------------------------------------
  const titled = indexable.filter(p => p.extracted!.title);
  add({ code: 'TITLE_MISSING', title: 'Missing <title>', category: 'METADATA', severity: 'HIGH', description: 'Indexable pages without a title element.', recommendation: 'Write a unique, descriptive title.', impact: 7, effort: 2, risk: 1, affectedUrls: indexable.filter(p => !p.extracted!.title).map(p => p.url) });
  add({ code: 'TITLE_TOO_SHORT', title: 'Title shorter than 30 characters', category: 'METADATA', severity: 'LOW', description: 'Very short titles rarely describe the page well.', recommendation: 'Add the main topic and a qualifier.', impact: 3, effort: 2, risk: 1, confidence: 0.6, affectedUrls: titled.filter(p => p.extracted!.title!.length < 30).map(p => p.url) });
  add({ code: 'TITLE_TOO_LONG', title: 'Title longer than 60 characters', category: 'METADATA', severity: 'LOW', description: 'Long titles are usually truncated in results.', recommendation: 'Front-load the important words; trim to ~60 characters.', impact: 2, effort: 2, risk: 1, confidence: 0.6, affectedUrls: titled.filter(p => p.extracted!.title!.length > 60).map(p => p.url) });
  const dupTitles = [...groupBy(titled, p => p.extracted!.title!.toLowerCase()).values()].filter(g => g.length > 1);
  add({ code: 'TITLE_DUPLICATE', title: 'Duplicate titles', category: 'METADATA', severity: 'MEDIUM', description: 'Several indexable pages share the same title.', recommendation: 'Make each title specific to its page.', impact: 5, effort: 3, risk: 1, affectedUrls: dupTitles.flat().map(p => p.url), evidence: { groups: dupTitles.slice(0, 30).map(g => ({ title: g[0].extracted!.title, urls: g.map(p => p.url) })) } });
  add({ code: 'META_DESCRIPTION_MISSING', title: 'Missing meta description', category: 'METADATA', severity: 'LOW', description: 'Search engines will build a snippet from page text.', recommendation: 'Write a description summarizing the page.', impact: 3, effort: 2, risk: 1, affectedUrls: indexable.filter(p => !p.extracted!.metaDescription).map(p => p.url) });
  const dupDesc = [...groupBy(indexable, p => p.extracted!.metaDescription?.toLowerCase()).values()].filter(g => g.length > 1);
  add({ code: 'META_DESCRIPTION_DUPLICATE', title: 'Duplicate meta descriptions', category: 'METADATA', severity: 'LOW', description: 'Several pages share the same description.', recommendation: 'Write page-specific descriptions.', impact: 3, effort: 3, risk: 1, affectedUrls: dupDesc.flat().map(p => p.url) });
  add({ code: 'H1_MISSING', title: 'Missing H1', category: 'CONTENT', severity: 'MEDIUM', description: 'Indexable pages without an h1.', recommendation: 'Add one visible h1 that states the page topic.', impact: 4, effort: 2, risk: 1, affectedUrls: indexable.filter(p => !p.extracted!.h1.length).map(p => p.url) });
  add({ code: 'H1_MULTIPLE', title: 'Multiple H1', category: 'CONTENT', severity: 'INFO', description: 'More than one h1. Not an error by itself, but often a template issue.', recommendation: 'Use one h1 and h2/h3 for sections.', impact: 2, effort: 2, risk: 1, confidence: 0.5, affectedUrls: indexable.filter(p => p.extracted!.h1.length > 1).map(p => p.url) });
  add({ code: 'LANG_MISSING', title: 'Missing html lang', category: 'INTERNATIONAL', severity: 'LOW', description: '<html> has no lang attribute.', recommendation: 'Set lang to the content language (e.g. es-MX).', impact: 2, effort: 1, risk: 1, affectedUrls: indexable.filter(p => !p.extracted!.lang).map(p => p.url) });
  const badHreflang = indexable.filter(p => {
    const h = p.extracted!.hreflang;
    if (!h.length) return false;
    const valid = h.every(x => /^(x-default|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/i.test(x.lang) && x.href);
    return !valid || !h.some(x => x.href === p.url);
  });
  add({ code: 'HREFLANG_INVALID', title: 'Invalid hreflang (bad code or no self-reference)', category: 'INTERNATIONAL', severity: 'MEDIUM', description: 'hreflang sets need valid ISO codes and a self-referencing entry.', recommendation: 'Fix language/region codes and include the page itself in its hreflang set.', impact: 5, effort: 3, risk: 2, affectedUrls: badHreflang.map(p => p.url) });

  // --- Content ------------------------------------------------------------------------
  add({ code: 'CONTENT_THIN', title: 'Thin content (under 150 words)', category: 'CONTENT', severity: 'MEDIUM', description: 'Main content (excluding nav, header, footer) has fewer than 150 words. Word count alone does not mean low quality.', recommendation: 'Add useful, specific content, consolidate, or noindex.', impact: 5, effort: 5, risk: 2, confidence: 0.6, affectedUrls: indexable.filter(p => p.extracted!.wordCount < 150).map(p => p.url) });
  const dupContent = [...groupBy(indexable, p => p.extracted!.contentHash).values()].filter(g => g.length > 1);
  add({ code: 'CONTENT_DUPLICATE', title: 'Exact duplicate main content', category: 'CONTENT', severity: 'HIGH', description: 'Indexable pages with identical main text.', recommendation: 'Consolidate with a 301 or point canonicals to one version.', impact: 7, effort: 3, risk: 2, affectedUrls: dupContent.flat().map(p => p.url), evidence: { groups: dupContent.slice(0, 30).map(g => g.map(p => p.url)) } });
  add({ code: 'DEPTH_EXCESSIVE', title: 'Pages deeper than 4 clicks', category: 'CRAWLABILITY', severity: 'LOW', description: 'Far from the homepage in the link graph.', recommendation: 'Surface important deep pages through hubs, breadcrumbs or related links.', impact: 4, effort: 4, risk: 1, confidence: 0.7, affectedUrls: indexable.filter(p => p.depth > 4).map(p => p.url) });
  add({ code: 'IMAGES_MISSING_ALT', title: 'Images without alt attribute', category: 'ACCESSIBILITY', severity: 'LOW', description: 'img elements with no alt (decorative images should use alt="").', recommendation: 'Describe informative images; use empty alt for decorative ones.', impact: 3, effort: 2, risk: 1, affectedUrls: html200.filter(p => p.extracted!.imagesMissingAlt > 0).map(p => p.url) });

  // --- Structured data & performance ---------------------------------------------------
  add({ code: 'SCHEMA_INVALID_JSON', title: 'JSON-LD with syntax errors', category: 'STRUCTURED_DATA', severity: 'HIGH', description: 'A JSON-LD block could not be parsed, so it is ignored entirely.', recommendation: 'Fix the JSON syntax (often trailing commas or unescaped quotes).', impact: 6, effort: 2, risk: 1, affectedUrls: html200.filter(p => p.extracted!.schemaErrors.length).map(p => p.url), evidence: { errors: Object.fromEntries(html200.filter(p => p.extracted!.schemaErrors.length).slice(0, 30).map(p => [p.url, p.extracted!.schemaErrors])) } });
  add({ code: 'SCHEMA_MISSING', title: 'No JSON-LD found', category: 'STRUCTURED_DATA', severity: 'INFO', description: 'No structured data. Only some types can produce rich results, and none are guaranteed.', recommendation: 'Add markup that matches visible content (Organization, BreadcrumbList, Article, Product…).', impact: 3, effort: 3, risk: 1, confidence: 0.5, affectedUrls: indexable.filter(p => !p.extracted!.schemaTypes.length && !p.extracted!.schemaErrors.length).map(p => p.url) });
  add({ code: 'SLOW_RESPONSE', title: 'Slow server response (over 1 s)', category: 'PERFORMANCE', severity: 'MEDIUM', description: 'Time to fetch the full HTML from the crawler location. Lab measurement, not user data.', recommendation: 'Check server caching and slow queries for these templates.', impact: 5, effort: 5, risk: 2, confidence: 0.6, affectedUrls: html200.filter(p => p.responseTimeMs > 1000).map(p => p.url) });

  return issues;
}
