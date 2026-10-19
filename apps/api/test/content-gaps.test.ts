import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let serp: http.Server;
let claude: http.Server;
let siteId: string;
const T = 'https://muebles.example.com';
const queries: string[] = [];
const claudeBodies: Array<{ system: string; messages: Array<{ content: string }> }> = [];

const r = (position: number, link: string, title = `Resultado ${position}`) => ({ position, link, title, snippet: `Snippet de ${title}` });
// Three shared URLs make the "silla" keywords one intent group.
const shared = [r(5, 'https://wiki.example.org/silla'), r(6, 'https://blog.example.net/sillas'), r(7, 'https://guia.example.net/silla')];
const SERPS: Record<string, unknown> = {
  'silla ergonomica': { organic_results: [r(1, 'https://rival1.com/sillas', 'Sillas ergonómicas | Rival 1'), r(3, 'https://www.rival2.mx/silla', 'Rival 2 sillas'), ...shared], related_questions: [{ question: '¿Cuánto cuesta una silla ergonómica?' }, { question: '¿Qué silla es mejor para la espalda?' }], related_searches: [{ query: 'silla ergonomica precio' }, { query: 'mejor silla ergonomica' }] },
  'silla ergonomica precio': { organic_results: [r(2, 'https://rival1.com/sillas-precio', 'Precios de sillas'), ...shared], related_questions: [{ question: '¿Cuánto cuesta una silla ergonómica?' }] },
  'mejor silla ergonomica': { organic_results: [r(1, 'https://www.rival2.mx/mejores', 'Las mejores sillas'), ...shared] },
  'escritorio de pie': { organic_results: [r(2, `${T}/escritorios`, 'Escritorios de pie'), r(5, 'https://rival1.com/escritorios', 'Escritorios')] },
  'lampara led': { organic_results: [r(1, 'https://otro.com/lamparas')] },
  'sillas gamer': { organic_results: [r(4, 'https://rival1.com/gamer', 'Sillas gamer'), r(8, `${T}/gamer`, 'Gamer'), r(9, 'https://x.com/a'), r(10, 'https://y.com/b')] }
};

beforeAll(async () => {
  serp = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const q = u.searchParams.get('q') ?? '';
    queries.push(q);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(SERPS[q] ?? { organic_results: [] }));
  });
  claude = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      claudeBodies.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '# Sillas ergonómicas: precios y guía\n\n**Intención de búsqueda:** comparar y comprar.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
    });
  });
  await Promise.all([new Promise<void>(x => serp.listen(0, '127.0.0.1', () => x())), new Promise<void>(x => claude.listen(0, '127.0.0.1', () => x()))]);
  process.env.SERPAPI_URL = `http://127.0.0.1:${(serp.address() as AddressInfo).port}/search.json`;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(claude.address() as AddressInfo).port}`;
  ({ app } = await buildAuthedApp());
  // Test files share the database: start without keys saved by other files.
  await prisma.aiProviderKey.deleteMany({ where: { provider: { in: ['serpapi', 'anthropic'] } } });
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Muebles', domain: 'muebles.example.com', canonicalUrl: T } })).json().id;
});
afterAll(async () => {
  delete process.env.SERPAPI_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  await app.close();
  await new Promise<void>(x => serp.close(() => x()));
  await new Promise<void>(x => claude.close(() => x()));
  await prisma.$disconnect();
});

describe('Brechas de contenido', () => {
  let gapId: string;
  const start = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/content-gaps`, payload });

  it('needs the SerpAPI key, competitors and keywords within the search budget', async () => {
    expect((await start({ competitors: ['rival1.com'], keywords: ['silla ergonomica'] })).json().error.code).toBe('SERPAPI_KEY_MISSING');
    await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/serpapi', payload: { key: 'serp-test-key-0123456789abcdef' } });
    expect((await start({ competitors: ['muebles.example.com'], keywords: ['silla'] })).json().error.code).toBe('NO_COMPETITORS'); // your own domain is not a competitor
    expect((await start({ competitors: ['rival1.com'], keywords: Array.from({ length: 10 }, (_, i) => `k${i}`), maxSearches: 5 })).json().error.code).toBe('TOO_MANY_KEYWORDS');
  });

  it('finds where competitors rank and the site does not, expanding with related searches', async () => {
    const res = await start({ competitors: ['https://www.rival1.com/', 'rival2.mx'], keywords: ['silla ergonomica', 'escritorio de pie', 'lampara led', 'sillas gamer'], maxSearches: 10 });
    expect(res.statusCode).toBe(202);
    gapId = res.json().gapId;
    expect((await waitForJob(app, res.json().jobId)).status).toBe('COMPLETED');
    expect(queries).toEqual(expect.arrayContaining(['silla ergonomica precio', 'mejor silla ergonomica'])); // expansion
    const g = (await app.inject(`/api/v1/sites/${siteId}/content-gaps`)).json().latest;
    expect(g.status).toBe('completed');
    const k = Object.fromEntries(g.result.keywords.map((x: { keyword: string }) => [x.keyword, x]));
    expect(k['silla ergonomica']).toMatchObject({ kind: 'missing', ownPosition: null, competitors: { 'rival1.com': { position: 1 }, 'rival2.mx': { position: 3 } } });
    expect(k['escritorio de pie']).toMatchObject({ kind: 'win', ownPosition: 2 });
    expect(k['lampara led'].kind).toBe('none');
    expect(k['sillas gamer']).toMatchObject({ kind: 'weak', ownPosition: 8, ownUrl: `${T}/gamer` });
    expect(k['silla ergonomica precio'].source).toBe('related');

    // The three "silla" keywords share 3 results: one group, a new page to create.
    const silla = g.result.clusters.find((c: { lead: string }) => c.lead === 'silla ergonomica');
    expect(silla).toMatchObject({ kind: 'missing', ownUrl: null });
    expect(silla.keywords.sort()).toEqual(['mejor silla ergonomica', 'silla ergonomica', 'silla ergonomica precio']);
    expect(silla.questions).toEqual(['¿Cuánto cuesta una silla ergonómica?', '¿Qué silla es mejor para la espalda?']);
    expect(g.result.clusters.find((c: { lead: string }) => c.lead === 'sillas gamer')).toMatchObject({ kind: 'weak', ownUrl: `${T}/gamer` });
    expect(g.result.competitors).toEqual(expect.arrayContaining([expect.objectContaining({ domain: 'rival1.com', top10: 4 })]));
  });

  it('writes briefs: an outline without AI, or with Claude from the real results', async () => {
    const g = (await app.inject(`/api/v1/sites/${siteId}/content-gaps`)).json().latest;
    const c = g.result.clusters.find((x: { lead: string }) => x.lead === 'silla ergonomica');
    const manual = (await app.inject({ method: 'POST', url: `/api/v1/content-gaps/${gapId}/briefs`, payload: { clusterId: c.id } })).json();
    expect(manual.source).toBe('manual');
    expect(manual.markdown).toContain('## Preguntas que debe responder');
    expect(manual.markdown).toContain('¿Cuánto cuesta una silla ergonómica?');
    expect(manual.markdown).toContain('rival1.com');
    expect((await app.inject({ method: 'POST', url: `/api/v1/content-gaps/${gapId}/briefs`, payload: { clusterId: c.id, useAi: true } })).json().error.code).toBe('AI_KEY_MISSING');
    await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/anthropic', payload: { key: 'sk-ant-api03-test-key-0123456789abcdef' } });
    const ai = (await app.inject({ method: 'POST', url: `/api/v1/content-gaps/${gapId}/briefs`, payload: { clusterId: c.id, useAi: true } })).json();
    expect(ai).toMatchObject({ source: 'ai', title: 'Sillas ergonómicas: precios y guía' });
    expect(claudeBodies[0].messages[0].content).toContain('Rival 2 sillas');
    expect(claudeBodies[0].system).toMatch(/no inventes/);
    const stored = (await app.inject(`/api/v1/sites/${siteId}/content-gaps`)).json().latest.result.briefs;
    expect(stored[c.id].source).toBe('ai');
  });

  it('viewers can read but not spend credit', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/content-gaps`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/content-gaps`, headers: { cookie: viewer.cookie }, payload: { competitors: ['a.com'], keywords: ['x'] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/content-gaps/${gapId}/briefs`, headers: { cookie: viewer.cookie }, payload: { clusterId: 'c1' } })).statusCode).toBe(403);
  });
});
