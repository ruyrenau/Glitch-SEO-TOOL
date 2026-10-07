import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseRobotsTxt, isAllowedByRobots, crawlDelayFor, extractPage, normalizeUrl, crawlSite, auditCrawl, indexabilityOf, CrawlResult } from '@glitch/crawler';
import { startFixtureSite, FixtureSite } from '@glitch/testing';

describe('robots.txt', () => {
  const robots = parseRobotsTxt(`
# comment
User-agent: *
Disallow: /private/
Allow: /private/public
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: Googlebot
User-agent: Bingbot
Disallow: /no-google/

Sitemap: https://example.com/sitemap.xml
`);
  it('applies the longest matching rule, Allow winning ties', () => {
    expect(isAllowedByRobots(robots, 'GlitchBot/1.0', '/private/x')).toBe(false);
    expect(isAllowedByRobots(robots, 'GlitchBot/1.0', '/private/public-note')).toBe(true);
    expect(isAllowedByRobots(robots, 'GlitchBot/1.0', '/ok')).toBe(true);
  });
  it('supports * and $', () => {
    expect(isAllowedByRobots(robots, 'GlitchBot', '/files/a.pdf')).toBe(false);
    expect(isAllowedByRobots(robots, 'GlitchBot', '/files/a.pdf?x=1')).toBe(true);
  });
  it('uses the most specific group and ignores "*" for it', () => {
    expect(isAllowedByRobots(robots, 'Googlebot/2.1', '/no-google/a')).toBe(false);
    expect(isAllowedByRobots(robots, 'Googlebot/2.1', '/private/x')).toBe(true);
    expect(crawlDelayFor(robots, 'GlitchBot')).toBe(2);
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });
  it('treats an empty Disallow as allow-all', () => {
    expect(isAllowedByRobots(parseRobotsTxt('User-agent: *\nDisallow:'), 'x', '/anything')).toBe(true);
  });
});

describe('extractPage', () => {
  it('extracts metadata, links, JSON-LD and main-content words', () => {
    const html = `<html lang="es"><head><title> Hola </title><meta name="Description" content="desc"><link rel="canonical" href="/a?x=1#frag">
      <meta name="robots" content="noindex"><link rel="alternate" hreflang="en" href="/en/a">
      <script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Product","Thing"]}]}</script>
      <script type="application/ld+json">{bad json}</script></head>
      <body><nav>menu menu menu</nav><main><h1>T</h1><p>uno dos tres</p><a href="/b">b</a><a href="https://other.com/">o</a><a href="mailto:x@y.z">m</a><img src=x></main><footer>pie</footer></body></html>`;
    const e = extractPage(html, 'https://Example.com/a');
    expect(e.title).toBe('Hola');
    expect(e.metaDescription).toBe('desc');
    expect(e.canonical).toBe('https://example.com/a?x=1');
    expect(e.robotsMeta).toBe('noindex');
    expect(e.schemaTypes.sort()).toEqual(['Product', 'Thing', 'WebPage']);
    expect(e.schemaErrors).toHaveLength(1);
    expect(e.internalLinks).toEqual(['https://example.com/b']);
    expect(e.externalLinks).toBe(1);
    expect(e.imagesMissingAlt).toBe(1);
    expect(e.wordCount).toBe(7); // "T uno dos tres b o m": nav and footer excluded
  });
  it('normalizes URLs', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.com:443/a#x')).toBe('https://example.com/a');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('crawlSite + auditCrawl against a local fixture site', () => {
  let site: FixtureSite;
  let result: CrawlResult;

  beforeAll(async () => {
    site = await startFixtureSite();
    const sitemapUrls = [...site.sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    result = await crawlSite({ startUrl: `${site.origin}/`, seeds: sitemapUrls, allowHosts: ['127.0.0.1'], rps: 200, concurrency: 4, maxDepth: 10 });
  });
  afterAll(() => site.close());

  const page = (p: string) => result.pages.find(x => x.url === `${site.origin}${p}`);

  it('reads robots.txt and never requests disallowed or excluded paths', () => {
    expect(result.robots.found).toBe(true);
    expect(page('/private/secret')?.blockedByRobots).toBe(true);
    expect(site.requests).not.toContain('/private/secret');
    expect(site.requests).not.toContain('/cart');
  });

  it('records redirect chains and loops', () => {
    expect(page('/old')?.redirectChain.map(h => h.status)).toEqual([301, 302]);
    expect(page('/old')?.finalUrl).toBe(`${site.origin}/about`);
    expect(page('/loop-a')?.error).toBe('Redirect loop');
  });

  it('computes depth, inlinks and indexability', () => {
    expect(page('/')?.depth).toBe(0);
    expect(page('/deep/6')?.depth).toBe(6);
    expect(page('/orphan')?.inlinks).toBe(0);
    expect(page('/about')!.inlinks).toBeGreaterThan(1);
    expect(indexabilityOf(page('/noindex-page')!)).toEqual({ indexable: false, reason: 'noindex' });
    expect(indexabilityOf(page('/canonical-to-redirect')!).reason).toMatch(/Canonicalized/);
  });

  it('detects the planted problems', () => {
    const issues = auditCrawl(result, { environment: 'production', sitemapUrls: new Set([...site.sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1])) });
    const byCode = Object.fromEntries(issues.map(i => [i.code, i.affectedUrls.map(u => u.replace(site.origin, ''))]));
    expect(byCode.HTTP_4XX).toContain('/missing');
    expect(byCode.HTTP_5XX).toEqual(['/error']);
    expect(byCode.REDIRECT_CHAIN).toEqual(['/old']);
    expect(byCode.REDIRECT_LOOP).toEqual(['/loop-a']);
    expect(byCode.BROKEN_INTERNAL_LINKS).toContain('/');
    expect(byCode.NOINDEX_IN_SITEMAP).toEqual(['/noindex-page']);
    expect(byCode.SITEMAP_NON_INDEXABLE).toEqual(expect.arrayContaining(['/old', '/missing', '/private/secret']));
    expect(byCode.SITEMAP_ORPHAN).toEqual(['/orphan']);
    expect(byCode.TITLE_DUPLICATE?.sort()).toEqual(['/dup-a', '/dup-b']);
    expect(byCode.CONTENT_DUPLICATE?.sort()).toEqual(['/dup-a', '/dup-b']);
    expect(byCode.META_DESCRIPTION_DUPLICATE?.sort()).toEqual(['/dup-a', '/dup-b']);
    expect(byCode.CONTENT_THIN).toContain('/thin');
    expect(byCode.TITLE_TOO_SHORT).toContain('/thin');
    expect(byCode.TITLE_TOO_LONG).toContain('/bad-schema');
    expect(byCode.META_DESCRIPTION_MISSING).toContain('/thin');
    expect(byCode.H1_MISSING).toContain('/thin');
    expect(byCode.H1_MULTIPLE).toEqual(['/bad-schema']);
    expect(byCode.CANONICAL_MISSING).toContain('/thin');
    expect(byCode.CANONICAL_TO_NON_INDEXABLE).toEqual(['/canonical-to-redirect']);
    expect(byCode.LANG_MISSING).toContain('/thin');
    expect(byCode.SCHEMA_INVALID_JSON).toEqual(['/bad-schema']);
    expect(byCode.PARAMETER_URLS_INDEXABLE).toEqual(['/products?sort=asc']);
    expect(byCode.DEPTH_EXCESSIVE).toEqual(['/deep/5', '/deep/6']);
    expect(byCode.IMAGES_MISSING_ALT).toEqual(['/']);
    expect(byCode.INTERNAL_LINKS_TO_REDIRECTS).toContain('/old');
    expect(byCode.STAGING_INDEXABLE).toBeUndefined();
    expect(Object.keys(byCode).length).toBeGreaterThanOrEqual(25);
  });

  it('checks protocol and www variants by kind', () => {
    const base = { ...result, pages: [{ ...result.pages[0], url: 'https://www.example.com/' }] };
    const issues = auditCrawl(
      {
        ...base,
        hostVariants: [
          { kind: 'http_to_https', url: 'http://www.example.com/', status: 200, finalUrl: 'http://www.example.com/', error: null },
          { kind: 'www_variant', url: 'https://example.com/', status: 301, finalUrl: 'https://www.example.com/', error: null }
        ]
      },
      { environment: 'production' }
    );
    expect(issues.map(i => i.code)).toContain('HTTP_NOT_REDIRECTED_TO_HTTPS');
    expect(issues.map(i => i.code)).not.toContain('HOST_VARIANT_NOT_REDIRECTED');
    expect(result.hostVariants).toEqual([]); // IP origins skip the www check
  });

  it('flags an indexable staging environment', () => {
    const issues = auditCrawl(result, { environment: 'staging' });
    expect(issues.find(i => i.code === 'STAGING_INDEXABLE')?.severity).toBe('CRITICAL');
  });

  it('respects maxUrls and cancellation', async () => {
    const limited = await crawlSite({ startUrl: `${site.origin}/`, allowHosts: ['127.0.0.1'], rps: 200, maxUrls: 3 });
    expect(limited.pages.length).toBe(3);
    expect(limited.limitReached).toBe(true);
    const ac = new AbortController();
    ac.abort();
    const cancelled = await crawlSite({ startUrl: `${site.origin}/`, allowHosts: ['127.0.0.1'], rps: 200, signal: ac.signal });
    expect(cancelled.cancelled).toBe(true);
  });

  it('refuses private targets without an allowlist (SSRF)', async () => {
    const r = await crawlSite({ startUrl: `${site.origin}/`, rps: 200 });
    expect(r.pages[0].statusCode).toBe(0);
    expect(r.pages[0].error).toMatch(/Blocked private/);
  });
});
