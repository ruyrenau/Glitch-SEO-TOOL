import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let other: http.Server;
let serp: http.Server;
let origin: string;
let siteId: string;
const T = 'https://tienda.example.com';
const serpCalls: string[] = [];

const pages: Record<string, string> = {
  '/robots.txt': 'User-agent: *\nDisallow: /privado/',
  '/ok': `<p>Recomendamos estas <a href="${T}/sillas">sillas ergonómicas</a>.</p>`,
  '/nofollow': `<p><a rel="nofollow sponsored" href="${T}/sillas">patrocinado</a></p>`,
  '/perdido': '<p>Antes te enlazábamos, ya no.</p>',
  '/a-404': `<p><a href="${T}/vieja-silla">la silla vieja</a></p>`,
  '/granja': `${Array.from({ length: 160 }, (_, i) => `<a href="https://sitio${i}.example.net/">x</a>`).join('')}<a href="${T}/">casino online bonos</a>`,
  '/privado/x': `<a href="${T}/">x</a>`
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  process.env.BACKLINK_DELAY_MS = '0';
  other = http.createServer((req, res) => {
    const body = pages[req.url ?? ''];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('no');
    }
    res.writeHead(200, { 'content-type': req.url === '/robots.txt' ? 'text/plain' : 'text/html; charset=utf-8' });
    res.end(req.url === '/robots.txt' ? body : `<html><body>${body}</body></html>`);
  });
  serp = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    serpCalls.push(u.searchParams.get('q') ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (u.searchParams.get('api_key') !== 'serp-test-key-0123456789abcdef') return res.end(JSON.stringify({ error: 'Invalid API key.' }));
    res.end(
      JSON.stringify({
        organic_results: [
          { position: 1, link: 'https://www.reddit.com/r/oficina/x', title: 'Reddit' },
          { position: 2, link: `${T}/sillas`, title: 'Sillas ergonómicas' },
          { position: 3, link: 'https://competencia.example.com/sillas', title: 'Competencia' }
        ],
        ai_overview: { text_blocks: [{ snippet: '…' }], references: [{ link: 'https://competencia.example.com/sillas', title: 'Competencia' }] },
        related_questions: [{ question: '¿Qué silla es mejor?' }],
        discussions_and_forums: [{ title: 'Reddit' }]
      })
    );
  });
  await Promise.all([new Promise<void>(r => other.listen(0, '127.0.0.1', () => r())), new Promise<void>(r => serp.listen(0, '127.0.0.1', () => r()))]);
  origin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  process.env.SERPAPI_URL = `http://127.0.0.1:${(serp.address() as AddressInfo).port}/search.json`;
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Tienda', domain: 'tienda.example.com', canonicalUrl: T } })).json().id;
  // Our pages as the latest crawl saw them.
  const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, config: {} } });
  await prisma.crawledPage.createMany({
    data: [
      { url: `${T}/`, statusCode: 200, title: 'Tienda' },
      { url: `${T}/sillas`, statusCode: 200, title: 'Sillas ergonómicas de oficina' },
      { url: `${T}/vieja-silla`, statusCode: 404, title: null }
    ].map(p => ({ crawlRunId: run.id, finalUrl: p.url, responseTimeMs: 5, mimeType: 'text/html', sizeBytes: 1, isIndexable: p.statusCode === 200, depth: 1, ...p }))
  });
});
afterAll(async () => {
  for (const k of ['CRAWL_ALLOW_PRIVATE_HOSTS', 'BACKLINK_DELAY_MS', 'SERPAPI_URL']) delete process.env[k];
  await app.close();
  await new Promise<void>(r => other.close(() => r()));
  await new Promise<void>(r => serp.close(() => r()));
  await prisma.$disconnect();
});

describe('Backlinks', () => {
  it('reads an Ahrefs-style CSV, checks every linking page and finds authority to rescue', async () => {
    const csv = ['Referring page URL,Target URL,Anchor', ...['/ok', '/nofollow', '/perdido', '/no-existe', '/a-404', '/granja', '/privado/x'].map(p => `${origin}${p},${p === '/a-404' ? `${T}/vieja-silla` : p === '/granja' || p === '/privado/x' ? `${T}/` : `${T}/sillas`},x`), `${T}/interna,${T}/sillas,interno`].join('\n');
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/backlinks?fileName=ahrefs.csv`, headers: { 'content-type': 'text/csv' }, payload: csv });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ rows: 7, format: 'ahrefs' }); // the internal link is skipped
    expect((await waitForJob(app, r.json().jobId)).status).toBe('COMPLETED');

    const rep = (await app.inject(`/api/v1/sites/${siteId}/backlinks`)).json().report;
    const by = Object.fromEntries(rep.links.map((l: { sourceUrl: string }) => [new URL(l.sourceUrl).pathname, l]));
    expect(by['/ok']).toMatchObject({ status: 'live', rel: 'follow', anchor: 'sillas ergonómicas', targetStatus: 200 });
    expect(by['/nofollow']).toMatchObject({ status: 'live', rel: 'nofollow,sponsored' });
    expect(by['/perdido'].status).toBe('lost');
    expect(by['/no-existe']).toMatchObject({ status: 'source-error', sourceStatus: 404 });
    expect(by['/a-404']).toMatchObject({ status: 'live', targetStatus: 404 });
    expect(by['/granja'].toxicScore).toBeGreaterThanOrEqual(40);
    expect(by['/privado/x'].status).toBe('blocked');
    expect(rep.totals).toMatchObject({ links: 7, live: 4, lost: 1, sourceError: 1, blocked: 1, follow: 3, nofollow: 1, sponsored: 1, toBroken: 1, suspicious: 1 });
    expect(rep.rescue).toEqual([{ target: `${T}/vieja-silla`, links: 1, domains: 1, follow: 1 }]);

    // The 301 map in Arquitectura puts that URL first.
    const redirects = (await app.inject(`/api/v1/sites/${siteId}/architecture/redirects`)).json();
    expect(redirects.rules[0]).toMatchObject({ from: '/vieja-silla', backlinks: 1, to: `${T}/sillas` });
    expect(redirects.rules[0].sources).toEqual(expect.arrayContaining(['crawl', 'backlinks']));
  });

  it('rejects a CSV without a linking-page column and needs an operator', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/backlinks?fileName=x.csv`, headers: { 'content-type': 'text/csv' }, payload: 'foo,bar\n1,2' })).json().error.code).toBe('NO_SOURCE_COLUMN');
    const editor = await loginAs(app, 'EDITOR');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/backlinks?fileName=x.csv`, headers: { 'content-type': 'text/csv', cookie: editor.cookie }, payload: 'Linking page\nhttps://a.example/x' })).statusCode).toBe(403);
  });
});

describe('SERP & AI tracker', () => {
  it('needs a SerpAPI key, snapshots the results page and explains a click drop without a ranking drop', async () => {
    await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/serp/keywords`, payload: { keywords: ['Sillas Ergonómicas', 'sillas ergonómicas', ' '] } });
    const cfg = (await app.inject(`/api/v1/sites/${siteId}/serp`)).json().config;
    expect(cfg.keywords).toEqual([expect.objectContaining({ keyword: 'sillas ergonómicas' })]);
    const noKey = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/serp/run` });
    expect((await waitForJob(app, noKey.json().jobId)).error).toMatch(/clave de SerpAPI/);

    await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/serpapi', payload: { key: 'serp-test-key-0123456789abcdef' } });
    const kw = await prisma.serpKeyword.findFirstOrThrow({ where: { siteId } });
    // Four weeks ago the page had no AI Overview nor forums, and the site was also 2nd.
    const old = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    await prisma.serpSnapshot.create({ data: { keywordId: kw.id, date: old, position: 2, features: ['people_also_ask'], aboveUs: [], topDomains: [] } });
    // Search Console: 10 clicks a day before, 4 a day in the last 4 weeks, same position.
    const days = Array.from({ length: 56 }, (_, i) => new Date(Date.now() - (2 + i) * 86400_000).toISOString().slice(0, 10));
    await prisma.gscQueryDay.createMany({ data: days.map((date, i) => ({ siteId, date, query: 'sillas ergonómicas', clicks: i < 28 ? 4 : 10, impressions: 200, position: 2.1 })) });

    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/serp/run` });
    const job = await waitForJob(app, r.json().jobId);
    expect(job.error ?? null).toBeNull();
    expect(job.status).toBe('COMPLETED');
    expect(serpCalls).toContain('sillas ergonómicas');
    const rep = (await app.inject(`/api/v1/sites/${siteId}/serp`)).json();
    const item = rep.items[0];
    expect(item.last).toMatchObject({ position: 2, aiCitesUs: false, features: expect.arrayContaining(['ai_overview', 'people_also_ask', 'forums']) });
    expect(item.added.sort()).toEqual(['ai_overview', 'forums']);
    expect(item.gsc).toMatchObject({ clicks: 112, clicksBefore: 280, clickChange: -60 });
    expect(item.insights[0]).toMatchObject({ tone: 'bad' });
    expect(item.insights[0].text).toMatch(/sin caer en ranking.*AI Overview.*No te cita|sin caer en ranking.*AI Overview/s);
    expect(rep.totals).toMatchObject({ checked: 1, aiOverview: 100, aiWithoutUs: 1, explainedDrops: 1 });
  });
});
