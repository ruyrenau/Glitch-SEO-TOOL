import http from 'http';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let wp: MockWordPress;
let wikidata: http.Server;
let claude: http.Server;
let siteId: string;
const claudeBodies: Array<{ system: string; messages: Array<{ content: string }> }> = [];
const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload: payload as object });
const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  // Wikidata: search + sitelinks.
  wikidata = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (u.searchParams.get('action') === 'wbsearchentities') return res.end(JSON.stringify({ search: [{ id: 'Q1078765', label: 'silla de oficina', description: 'silla para trabajar en un escritorio' }, { id: 'Q999', label: 'Silla Oficina (banda)', description: 'grupo musical' }] }));
    res.end(JSON.stringify({ entities: { Q1078765: { sitelinks: { eswiki: { url: 'https://es.wikipedia.org/wiki/Silla_de_oficina' } } }, Q999: { sitelinks: {} } } }));
  });
  claude = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      claudeBodies.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'TÍTULO: Sillas ergonómicas: guía completa\n---\n<p>Una silla ergonómica cuida tu espalda.</p>\n<h2>¿Cuál elegir?</h2>\n<ul><li>Soporte lumbar</li></ul>\n---\nNOTAS:\n- Intro de la página A\n- Lista de la página B' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
    });
  });
  await Promise.all([new Promise<void>(r => wikidata.listen(0, '127.0.0.1', () => r())), new Promise<void>(r => claude.listen(0, '127.0.0.1', () => r()))]);
  process.env.WIKIDATA_API_URL = `http://127.0.0.1:${(wikidata.address() as AddressInfo).port}/w/api.php`;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(claude.address() as AddressInfo).port}`;
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  siteId = (await post('/api/v1/sites', { name: 'Muebles WP', domain: new URL(wp.url).hostname, canonicalUrl: wp.url })).json().id;
  await put(`/api/v1/sites/${siteId}/wordpress`, { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword });
  expect((await put('/api/v1/ai-keys/anthropic', { key: 'sk-ant-api03-test-key-0123456789abcdef' })).statusCode).toBe(200);
});
afterAll(async () => {
  for (const k of ['CRAWL_ALLOW_PRIVATE_HOSTS', 'WIKIDATA_API_URL', 'ANTHROPIC_BASE_URL']) delete process.env[k];
  await app.close();
  await wp.close();
  await new Promise<void>(r => wikidata.close(() => r()));
  await new Promise<void>(r => claude.close(() => r()));
  await prisma.$disconnect();
});

describe('Perfil de entidad', () => {
  let authorId: string;
  const article = () => `${wp.url}/blog/sillas/`;

  it('stores the Organization and authors, and builds one connected graph per page', async () => {
    const orgRes = await put(`/api/v1/sites/${siteId}/entities/org`, { name: 'Muebles SA', url: `${wp.url}/`, logo: `${wp.url}/logo.png`, description: 'Fabricantes de muebles de oficina desde 1998.', telephone: '+52 222 000 0000', sameAs: ['https://www.linkedin.com/company/muebles', 'https://www.facebook.com/muebles'] });
    expect(orgRes.json()).toMatchObject({ sameAs: ['https://www.linkedin.com/company/muebles', 'https://www.facebook.com/muebles'] });
    const a = await post(`/api/v1/sites/${siteId}/entities/authors`, { name: 'Ana López', url: `${wp.url}/autor/ana/`, jobTitle: 'Ergonomista', description: 'Ergonomista certificada con 12 años de experiencia diseñando puestos de trabajo para oficinas.', image: `${wp.url}/ana.jpg`, sameAs: ['https://www.linkedin.com/in/ana'] });
    expect(a.statusCode).toBe(201);
    authorId = a.json().id;
    expect(a.json().slug).toBe('ana-lopez');

    const sug = (await app.inject(`/api/v1/wikidata/search?q=${encodeURIComponent('silla de oficina')}`)).json();
    expect(sug[0]).toEqual({ qid: 'Q1078765', label: 'silla de oficina', description: 'silla para trabajar en un escritorio', wikipedia: 'https://es.wikipedia.org/wiki/Silla_de_oficina' });

    await put(`/api/v1/sites/${siteId}/entities/pages`, { url: article(), type: 'BlogPosting', authorId, about: [{ label: sug[0].label, qid: sug[0].qid, wikipedia: sug[0].wikipedia }], datePublished: '2026-10-01' });
    const g = (await app.inject(`/api/v1/sites/${siteId}/entities/graph?url=${encodeURIComponent(article())}`)).json();
    const nodes = g.graph['@graph'] as Array<Record<string, any>>;
    const byType = (t: string) => nodes.find(n => n['@type'] === t)!;
    const origin = wp.url;
    expect(byType('Organization')).toMatchObject({ '@id': `${origin}/#organization`, sameAs: ['https://www.linkedin.com/company/muebles', 'https://www.facebook.com/muebles'] });
    expect(byType('BlogPosting')).toMatchObject({ author: { '@id': `${origin}/#/schema/person/ana-lopez` }, publisher: { '@id': `${origin}/#organization` }, about: [{ '@type': 'Thing', name: 'silla de oficina', sameAs: ['https://www.wikidata.org/wiki/Q1078765', 'https://es.wikipedia.org/wiki/Silla_de_oficina'] }] });
    expect(byType('Person')).toMatchObject({ name: 'Ana López', worksFor: { '@id': `${origin}/#organization` } });
    expect(g.warnings).toEqual([]);
  });

  it('audits E-E-A-T over the crawl and the profile', async () => {
    const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, config: {} } });
    const html = (s: string) => zlib.gzipSync(`<html><body>${s}</body></html>`);
    await prisma.crawledPage.createMany({
      data: [
        { url: `${wp.url}/`, depth: 0, htmlGz: html('<h1>Muebles</h1>') },
        { url: `${wp.url}/nosotros/`, depth: 1, htmlGz: html('<h1>Nosotros</h1>') },
        { url: article(), depth: 1, htmlGz: html('<article><h1>Sillas</h1><p class="byline">Por Ana López</p><time datetime="2026-10-01">1 oct</time></article>') },
        { url: `${wp.url}/blog/mesas/`, depth: 1, htmlGz: html('<article><h1>Mesas</h1><p>Sin autor.</p></article>') }
      ].map(p => ({ crawlRunId: run.id, finalUrl: p.url, statusCode: 200, responseTimeMs: 5, mimeType: 'text/html', sizeBytes: 1, isIndexable: true, ...p }))
    });
    const a = (await app.inject(`/api/v1/sites/${siteId}/entities/eeat`)).json();
    const by = Object.fromEntries(a.checks.map((c: { id: string }) => [c.id, c]));
    expect(by['org-profile'].status).toBe('ok');
    expect(by['org-schema'].status).toBe('fail'); // not published yet
    expect(by.about.status).toBe('ok');
    expect(by.contact.status).toBe('fail');
    expect(by['article-author']).toMatchObject({ status: 'partial', detail: '1 de 2 (50 %).' });
    expect(by['author-pages'].status).toBe('fail'); // /autor/ana/ is not in the crawl
    expect(a.score).toBeGreaterThan(20);
    expect(a.score).toBeLessThan(90);
  });

  it('publishes the graph to WordPress through the review flow (mu-plugin v2)', async () => {
    const p = wp.addPublished({ slug: 'sillas', title: 'Sillas' });
    const url = `${wp.url}/sillas/`;
    const json = (await app.inject(`/api/v1/sites/${siteId}/entities/graph?url=${encodeURIComponent(url)}`)).json().json;
    expect((await post(`/api/v1/sites/${siteId}/seo-edits`, { url, field: 'schemaJsonLd', newValue: '{"no": "context"}' })).json().error.code).toBe('INVALID_JSON_LD');
    const prop = await post(`/api/v1/sites/${siteId}/seo-edits`, { url, field: 'schemaJsonLd', newValue: json });
    expect(prop.statusCode).toBe(201);
    await post(`/api/v1/seo-edits/${prop.json().id}/review`, { decision: 'approved' });
    expect((await post(`/api/v1/seo-edits/${prop.json().id}/apply`, { confirm: true })).json().status).toBe('applied');
    expect(wp.posts.get(p.id)!.meta!._glitch_schema_jsonld).toBe(json);
    expect((await post(`/api/v1/seo-edits/${prop.json().id}/verify`)).json().verifyStatus).toBe('verified');
  });

  it('only admins change the Organization; editors manage authors', async () => {
    const editor = await loginAs(app, 'EDITOR');
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/entities/org`, headers: { cookie: editor.cookie }, payload: { name: 'X', url: `${wp.url}/` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/entities/authors`, headers: { cookie: editor.cookie }, payload: { name: 'Luis' } })).statusCode).toBe(201);
  });
});

describe('Consolidación', () => {
  it('drafts with Claude, applies to the winner with a 301, and reverts everything', async () => {
    wp.enableRedirection();
    const a = wp.addPublished({ slug: 'sillas-ergonomicas', title: 'Sillas ergonómicas', content: '<p>Texto original A.</p>' });
    wp.addPublished({ slug: 'mejores-sillas', title: 'Mejores sillas', content: '<p>Texto B.</p>' });
    const A = `${wp.url}/sillas-ergonomicas/`;
    const B = `${wp.url}/mejores-sillas/`;
    const c = await post(`/api/v1/sites/${siteId}/consolidations`, { a: A, b: B, winnerUrl: A, queries: ['silla ergonomica'] });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;
    expect(c.json()).toMatchObject({ winnerUrl: A, loserUrl: B, status: 'draft' });
    expect((await post(`/api/v1/sites/${siteId}/consolidations`, { a: B, b: `${wp.url}/otra/` })).json().error.code).toBe('PENDING_EXISTS');

    const d = (await post(`/api/v1/consolidations/${id}/draft-ai`)).json();
    expect(d).toMatchObject({ draftTitle: 'Sillas ergonómicas: guía completa', aiModel: 'claude-opus-5-5' });
    expect(d.draftHtml).toContain('<h2>¿Cuál elegir?</h2>');
    expect(d.draftHtml).toContain('<!-- G.SEO (notas de la fusión');
    expect(claudeBodies.at(-1)!.system).toMatch(/no inventes datos/);
    expect(claudeBodies.at(-1)!.messages[0].content).toContain('silla ergonomica');

    await put(`/api/v1/consolidations/${id}/draft`, { html: '<p>Texto fusionado y revisado.</p>' });
    expect((await post(`/api/v1/consolidations/${id}/apply`, { confirm: true })).json().error.code).toBe('NOT_APPROVED');
    await post(`/api/v1/consolidations/${id}/approve`);
    const applied = (await post(`/api/v1/consolidations/${id}/apply`, { confirm: true })).json();
    expect(applied).toMatchObject({ status: 'applied', redirectMethod: 'wordpress', redirectRule: { from: '/mejores-sillas/', htaccess: `Redirect 301 /mejores-sillas/ ${A}` } });
    expect(wp.posts.get(a.id)).toMatchObject({ content: '<p>Texto fusionado y revisado.</p>', title: 'Sillas ergonómicas: guía completa' });
    expect(wp.redirects.at(-1)).toEqual({ url: '/mejores-sillas/', to: A, code: 301 });

    expect((await post(`/api/v1/consolidations/${id}/revert`, { confirm: true })).json().status).toBe('reverted');
    expect(wp.posts.get(a.id)).toMatchObject({ content: '<p>Texto original A.</p>', title: 'Sillas ergonómicas' });
    expect(wp.redirects.at(-1)!.url).toBe(''); // the 301 was removed
  });

  it('a manual draft starts from both pages, and viewers cannot apply', async () => {
    const A = `${wp.url}/escritorios/`;
    const B = `${wp.url}/escritorios-de-pie/`;
    const id = (await post(`/api/v1/sites/${siteId}/consolidations`, { a: A, b: B })).json().id;
    expect((await post(`/api/v1/consolidations/${id}/draft-manual`)).statusCode).toBe(200);
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/consolidations/${id}/apply`, headers: { cookie: viewer.cookie }, payload: { confirm: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/consolidations/${id}` })).json()).toEqual({ deleted: true });
  });
});
