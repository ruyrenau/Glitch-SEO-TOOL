import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { crawlSite, CrawlOptions } from '../src';

// Home links to: 10 blog posts, 3 shop pages (one with 2 query params), a deep page, a very long URL and /docs/.
const long = `/landing-${'x'.repeat(150)}`;
const links = [...Array.from({ length: 10 }, (_, i) => `/blog/post-${i}`), '/tienda/a', '/tienda/b', '/tienda/c?color=rojo&talla=m', '/a/b/c/d', long, '/docs/'];
const page = (title: string, hrefs: string[] = []) => `<!doctype html><html lang="es"><head><title>${title}</title></head><body><h1>${title}</h1>${hrefs.map(h => `<a href="${h}">${h}</a>`).join(' ')}</body></html>`;

let server: http.Server;
let origin = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url ?? '/';
    let body: string | null = null;
    if (u === '/') body = page('Inicio', links);
    else if (u === '/docs/') body = page('Docs', ['/docs/guia', '/docs/api', '/']);
    else if (u === '/robots.txt') body = null;
    else if (u === '/old') {
      res.writeHead(301, { location: '/old2' });
      return res.end();
    } else if (u === '/old2') {
      res.writeHead(301, { location: '/old3' });
      return res.end();
    } else body = page(`Página ${u}`);
    res.writeHead(body === null ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'no');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const crawl = (o: Partial<CrawlOptions> = {}) => crawlSite({ startUrl: `${origin}/`, allowHosts: ['127.0.0.1'], rps: 200, concurrency: 4, checkResources: false, checkExternalLinks: false, ...o });
const paths = (r: Awaited<ReturnType<typeof crawl>>) => r.pages.map(p => new URL(p.url).pathname + new URL(p.url).search).sort();

describe('Screaming Frog-style crawl limits', () => {
  it('without limits crawls everything and skips nothing', async () => {
    const r = await crawl();
    expect(r.pages).toHaveLength(19);
    expect(r.skipped).toEqual({});
  });

  it('limits URLs per first-level folder', async () => {
    const r = await crawl({ maxUrlsPerFolder: 3 });
    expect(paths(r).filter(p => p.startsWith('/blog/'))).toHaveLength(3);
    expect(paths(r).filter(p => p.startsWith('/tienda/'))).toHaveLength(3);
    expect(r.skipped.maxUrlsPerFolder).toBe(7);
  });

  it('skips long URLs, deep folders and URLs with too many query parameters', async () => {
    const r = await crawl({ maxUrlLength: 120, maxFolderDepth: 2, maxQueryParams: 1 });
    const p = paths(r);
    expect(p).not.toContain(long);
    expect(p).not.toContain('/a/b/c/d');
    expect(p).not.toContain('/tienda/c?color=rojo&talla=m');
    expect(r.skipped).toMatchObject({ maxUrlLength: 1, maxFolderDepth: 1, maxQueryParams: 1 });
    expect((await crawl({ maxQueryParams: 0 })).skipped.maxQueryParams).toBe(1);
  });

  it('follows only the first N links of each page', async () => {
    const r = await crawl({ maxLinksPerPage: 4 });
    expect(paths(r)).toEqual(['/', '/blog/post-0', '/blog/post-1', '/blog/post-2', '/blog/post-3']);
    expect(r.skipped.maxLinksPerPage).toBe(12);
  });

  it('stays inside the start folder', async () => {
    const r = await crawl({ startUrl: `${origin}/docs/`, stayInStartFolder: true });
    expect(paths(r)).toEqual(['/docs/', '/docs/api', '/docs/guia']);
    expect(r.skipped.outsideStartFolder).toBe(1);
  });

  it('list mode crawls exactly the given URLs and follows no links', async () => {
    const r = await crawl({ listUrls: [`${origin}/blog/post-7`, `${origin}/docs/`, 'https://otro-sitio.example/x', `${origin}/blog/post-7`] });
    expect(paths(r)).toEqual(['/blog/post-7', '/docs/']);
    expect(r.pages.find(p => p.url.endsWith('/docs/'))!.extracted!.internalLinks.length).toBe(3); // links are still recorded
  });

  it('gives up after the allowed number of redirects', async () => {
    const r = await crawl({ listUrls: [`${origin}/old`], maxRedirects: 1 });
    expect(r.pages[0]).toMatchObject({ statusCode: 0, error: 'Too many redirects' });
    const ok = await crawl({ listUrls: [`${origin}/old`], maxRedirects: 5 });
    expect(ok.pages[0].redirectChain).toHaveLength(2);
  });

  it('a URL skipped from one page but crawled from another is not counted as skipped', async () => {
    // /docs/ is the 16th link of the home page (skipped there) but it is also a sitemap seed, so it gets crawled.
    const r = await crawl({ maxLinksPerPage: 15, seeds: [`${origin}/docs/`] });
    expect(paths(r)).toContain('/docs/');
    expect(r.skipped.maxLinksPerPage).toBeUndefined();
    expect((await crawl({ maxLinksPerPage: 15 })).skipped.maxLinksPerPage).toBe(1);
  });
});
