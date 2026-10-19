import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startFixtureSite, startMockWordPress, FixtureSite, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let wp: MockWordPress;
let site: FixtureSite;
let wpSite: string;
let fxSite: string;
const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload: payload as object });

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  wp = await startMockWordPress();
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  wpSite = (await post('/api/v1/sites', { name: 'Blog WP', domain: new URL(wp.url).hostname, canonicalUrl: wp.url })).json().id;
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${wpSite}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
  fxSite = (await post('/api/v1/sites', { name: 'Fixture', domain: '127.0.0.1', canonicalUrl: site.origin })).json().id;
  await waitForJob(app, (await post(`/api/v1/sites/${fxSite}/crawls`, { rps: 20, concurrency: 4, maxDepth: 10 })).json().jobId);
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await site.close();
  await prisma.$disconnect();
});

describe('internal links into WordPress', () => {
  it('proposes, applies, verifies and reverts a link without touching the rest of the post', async () => {
    const body = '<!-- wp:heading --><h2>Sillas ergonómicas</h2><!-- /wp:heading -->Para trabajar horas te recomendamos unas sillas ergonómicas buenas.';
    const a = wp.addPublished({ slug: 'guia-oficina', title: 'Guía de oficina', content: body });
    wp.addPublished({ slug: 'sillas-ergonomicas', title: 'Sillas ergonómicas' });
    const target = `${wp.url}/sillas-ergonomicas/`;

    expect((await post(`/api/v1/sites/${wpSite}/seo-edits/link`, { url: `${wp.url}/guia-oficina/`, targetUrl: target, anchor: 'mesas de madera' })).json().error.code).toBe('ANCHOR_NOT_FOUND');
    const p = await post(`/api/v1/sites/${wpSite}/seo-edits/link`, { url: `${wp.url}/guia-oficina/`, targetUrl: target, anchor: 'sillas ergonomicas' });
    expect(p.statusCode).toBe(201);
    const id = p.json().id;
    expect(p.json()).toMatchObject({ field: 'internalLink', linkAnchor: 'sillas ergonómicas', newValue: `<a href="${target}">sillas ergonómicas</a>` });
    expect(p.json().oldValue).toContain('te recomendamos unas sillas ergonómicas buenas');

    await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' });
    // Someone edits the post in WordPress meanwhile: the link still goes in and the edit is kept.
    wp.humanEdit(a.id, `${body} Nuevo párrafo.`);
    expect((await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true })).json().status).toBe('applied');
    expect(wp.posts.get(a.id)!.content).toBe(`<!-- wp:heading --><h2>Sillas ergonómicas</h2><!-- /wp:heading -->Para trabajar horas te recomendamos unas <a href="${target}">sillas ergonómicas</a> buenas. Nuevo párrafo.`);
    expect((await post(`/api/v1/seo-edits/${id}/verify`)).json().verifyStatus).toBe('verified');

    expect((await post(`/api/v1/seo-edits/${id}/revert`, { confirm: true })).json().status).toBe('reverted');
    expect(wp.posts.get(a.id)!.content).toBe(`${body} Nuevo párrafo.`);
  });

  it('pushes 301s to the Redirection plugin only when it is installed', async () => {
    const rules = [{ from: '/vieja/', to: `${wp.url}/sillas-ergonomicas/` }];
    expect((await post(`/api/v1/sites/${wpSite}/architecture/redirects/wordpress`, { rules })).json().error.code).toBe('NO_REDIRECTION_PLUGIN');
    wp.enableRedirection();
    const r = (await post(`/api/v1/sites/${wpSite}/architecture/redirects/wordpress`, { rules: [...rules, { from: '/vieja/', to: `${wp.url}/` }] })).json();
    expect(r).toMatchObject({ created: 1, failed: 1 });
    expect(wp.redirects).toEqual([{ url: '/vieja/', to: `${wp.url}/sillas-ergonomicas/`, code: 301 }]);
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${wpSite}/architecture/redirects/wordpress`, headers: { cookie: viewer.cookie }, payload: { rules } })).statusCode).toBe(403);
  });
});

describe('architecture reports over a crawl', () => {
  it('scores pages by internal PageRank and lists depth', async () => {
    const r = (await app.inject(`/api/v1/sites/${fxSite}/architecture/links`)).json();
    expect(r.totals.pages).toBeGreaterThan(3);
    const home = r.pages.find((p: { url: string }) => p.url === `${site.origin}/`);
    expect(home.linkScore).toBeGreaterThan(0);
    expect(r.pages[0].linkScore).toBe(100);
    expect(r.depthDistribution.find((d: { depth: string }) => d.depth === '5+').pages).toBeGreaterThan(0);
  });

  it('maps broken URLs to the most similar live page', async () => {
    const r = (await app.inject(`/api/v1/sites/${fxSite}/architecture/redirects`)).json();
    const missing = r.rules.find((x: { from: string }) => x.from === '/missing');
    expect(missing).toMatchObject({ sources: ['crawl'] });
    expect(missing.to.startsWith(site.origin)).toBe(true);
    expect(['alta', 'media', 'baja']).toContain(missing.confidence);
  });

  it('says when there is no JavaScript crawl to audit', async () => {
    expect((await app.inject(`/api/v1/sites/${fxSite}/architecture/render`)).json()).toMatchObject({ crawl: null });
  });
});

describe('link suggestions', () => {
  it('suggests linking a phrase of a related page to a weak target, never to pages it already links', async () => {
    const zlib = await import('zlib');
    const O = 'https://muebles.example.com';
    const id = (await post('/api/v1/sites', { name: 'Muebles', domain: 'muebles.example.com', canonicalUrl: O })).json().id;
    const run = await prisma.crawlRun.create({ data: { siteId: id, status: 'completed', mode: 'site', urlsCrawled: 4, config: {} } });
    const html = (title: string, body: string) => zlib.gzipSync(`<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`);
    const pages = [
      { url: `${O}/`, title: 'Muebles de oficina', depth: 0, body: '<p>Tienda de muebles de oficina: escritorios, sillas y archiveros para tu empresa.</p>' },
      { url: `${O}/blog/postura`, title: 'Cómo cuidar la postura en la oficina', depth: 1, body: '<p>Pasar ocho horas sentado daña la espalda si no usas sillas ergonómicas con soporte lumbar ajustable.</p>' },
      { url: `${O}/blog/escritorios`, title: 'Escritorios de pie para oficina', depth: 1, body: '<p>Los escritorios de pie ayudan a la postura; combínalos con <a href="/sillas-ergonomicas">sillas ergonómicas</a> de soporte lumbar.</p>' },
      { url: `${O}/sillas-ergonomicas`, title: 'Sillas ergonómicas | Muebles', depth: 4, body: '<p>Sillas ergonómicas con soporte lumbar, reposabrazos y malla transpirable para la oficina.</p>' }
    ];
    await prisma.crawledPage.createMany({ data: pages.map(p => ({ crawlRunId: run.id, url: p.url, finalUrl: p.url, title: p.title, h1: p.title, statusCode: 200, responseTimeMs: 5, mimeType: 'text/html', sizeBytes: 1, isIndexable: true, depth: p.depth, htmlGz: html(p.title, p.body) })) });
    await prisma.crawledLink.createMany({
      data: [
        [`${O}/`, `${O}/blog/postura`],
        [`${O}/`, `${O}/blog/escritorios`],
        [`${O}/blog/postura`, `${O}/`],
        [`${O}/blog/escritorios`, `${O}/sillas-ergonomicas`]
      ].map(([s, t]) => ({ crawlRunId: run.id, sourceUrl: s, targetUrl: t, anchor: 'x', internal: true }))
    });
    const r = (await app.inject(`/api/v1/sites/${id}/architecture/link-suggestions?targetUrl=${encodeURIComponent(`${O}/sillas-ergonomicas`)}`)).json();
    expect(r.suggestions).toEqual([expect.objectContaining({ sourceUrl: `${O}/blog/postura`, targetUrl: `${O}/sillas-ergonomicas`, anchor: 'sillas ergonómicas' })]);
    expect(r.suggestions[0].context).toContain('[[sillas ergonómicas]]');
  });
});
