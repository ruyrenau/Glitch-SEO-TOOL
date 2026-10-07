import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';
import { buildAuthedApp, waitForJob } from './helpers';

let app: FastifyInstance;
let site: FixtureSite;
let crawlId: string;

type Summary = { totals: { urls: number; images: number }; tabs: Array<{ id: string; filters: Array<{ id: string; count: number }> }> };
const count = (s: Summary, tab: string, filter: string) => s.tabs.find(t => t.id === tab)!.filters.find(f => f.id === filter)!.count;

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  const siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Explorer', domain: '127.0.0.1', canonicalUrl: site.origin } })).json().id;
  const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, maxDepth: 10 } });
  crawlId = ((await waitForJob(app, r.json().jobId)).result as { crawlRunId: string }).crawlRunId;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await site.close();
  await prisma.$disconnect();
});

describe('SEO explorer', () => {
  it('summarises every tab filter with counts from the crawl', async () => {
    const s = (await app.inject(`/api/v1/crawls/${crawlId}/explorer/summary`)).json() as Summary;
    expect(s.totals.images).toBe(3);
    expect(count(s, 'titles', 'duplicate')).toBe(2);
    expect(count(s, 'titles', 'over-60')).toBe(1);
    expect(count(s, 'titles', 'below-30')).toBe(1);
    expect(count(s, 'meta', 'missing')).toBe(1);
    expect(count(s, 'h1', 'multiple')).toBe(1);
    expect(count(s, 'images', 'missing-alt')).toBe(1);
    expect(count(s, 'images', 'missing-dimensions')).toBe(3);
    expect(count(s, 'canonicals', 'canonicalised')).toBe(1);
    expect(count(s, 'canonicals', 'non-200')).toBe(1); // /canonical-to-redirect -> /old (301)
    expect(count(s, 'response', '4xx')).toBe(1);
    expect(count(s, 'response', '5xx')).toBe(1);
    expect(count(s, 'response', 'blocked')).toBe(1);
    expect(count(s, 'directives', 'noindex')).toBe(1);
    expect(count(s, 'structured', 'errors')).toBe(1);
    expect(count(s, 'uri', 'parameters')).toBe(1);
  });

  it('filters, searches, sorts and paginates rows', async () => {
    const dup = (await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=titles&filter=duplicate`)).json();
    expect(dup.rows.map((r: { url: string }) => r.url.replace(site.origin, '')).sort()).toEqual(['/dup-a', '/dup-b']);
    expect(dup.tab.columns.map((c: { key: string }) => c.key)).toContain('length');

    const deep = (await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=internal&q=deep&sort=depth&dir=desc`)).json();
    expect(deep.rows[0].url).toBe(`${site.origin}/deep/6`);
    expect(deep.rows.every((r: { url: string }) => r.url.includes('deep'))).toBe(true);

    const paged = (await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=internal&pageSize=5&page=2`)).json();
    expect(paged.rows).toHaveLength(5);
    expect(paged.page).toBe(2);

    expect((await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=nope`)).json().error.code).toBe('UNKNOWN_TAB');
  });

  it('shows one URL with inlinks (anchors), outlinks (status), images, headers and source', async () => {
    const page = await prisma.crawledPage.findFirstOrThrow({ where: { crawlRunId: crawlId, url: `${site.origin}/` } });
    const d = (await app.inject(`/api/v1/crawls/${crawlId}/explorer/pages/${page.id}`)).json();
    expect(d.source).toContain('<title>Glitch Demo Store');
    expect(d.page.headers['content-type']).toMatch(/text\/html/);
    expect(d.page.images).toEqual(expect.arrayContaining([expect.objectContaining({ alt: null })]));
    const toMissing = d.outlinks.find((o: { targetUrl: string }) => o.targetUrl.endsWith('/missing'));
    expect(toMissing).toMatchObject({ internal: true, status: 404, anchor: '/missing' });
    expect(d.outlinks.some((o: { internal: boolean }) => !o.internal)).toBe(true);
    expect(d.page.htmlGz).toBeUndefined();

    const about = await prisma.crawledPage.findFirstOrThrow({ where: { crawlRunId: crawlId, url: `${site.origin}/about` } });
    const da = (await app.inject(`/api/v1/crawls/${crawlId}/explorer/pages/${about.id}`)).json();
    expect(da.inlinks.length).toBeGreaterThan(5);
    expect(da.inlinks.map((l: { anchor: string }) => l.anchor)).toContain('Nosotros');
  });

  it('checks resources (CSS, JS, images, PDFs) and external links with status, type and size', async () => {
    const s = (await app.inject(`/api/v1/crawls/${crawlId}/explorer/summary`)).json() as Summary & { fileTypes: Array<{ kind: string; count: number }> };
    expect(count(s, 'resources', 'css')).toBe(1);
    expect(count(s, 'resources', 'js')).toBe(2);
    expect(count(s, 'resources', 'pdf')).toBe(1);
    expect(count(s, 'resources', 'broken')).toBe(1); // /missing.js
    expect(count(s, 'resources', 'heavy-image')).toBe(1); // /a.png, 300 KB
    expect(count(s, 'resources', 'type-mismatch')).toBe(1); // /b.png served as text/html
    expect(count(s, 'external', 'links')).toBe(1);
    expect(s.fileTypes.map(f => f.kind)).toEqual(expect.arrayContaining(['html', 'css', 'js', 'image', 'pdf']));

    const broken = (await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=resources&filter=broken`)).json();
    expect(broken.rows[0]).toMatchObject({ url: `${site.origin}/missing.js`, type: 'JavaScript', status: 404, foundOnCount: 1, foundOn: `${site.origin}/about` });
    const img = (await app.inject(`/api/v1/crawls/${crawlId}/explorer?tab=resources&filter=heavy-image`)).json();
    expect(img.rows[0]).toMatchObject({ contentType: 'image/png', sizeKb: 300 });
    // A linked PDF is checked as a file, not crawled as a page.
    expect(await prisma.crawledPage.count({ where: { crawlRunId: crawlId, url: `${site.origin}/guia.pdf` } })).toBe(0);
  });

  it('exports the current tab and filter as CSV', async () => {
    const r = await app.inject(`/api/v1/crawls/${crawlId}/explorer.csv?tab=images&filter=missing-alt`);
    expect(r.headers['content-type']).toContain('text/csv');
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toBe('Imagen,Página,Texto alternativo,Longitud alt,Dimensiones (atributos),loading');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('/b.png');
  });
});
