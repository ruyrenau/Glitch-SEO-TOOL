import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { prisma, mentionScore, citeScore } from '@glitch/db';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let siteId: string;
let mock: http.Server;
const seen: Array<{ path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
const KEY = 'sk-ant-api03-test-key-0000000000000000000000ABCD';

beforeAll(async () => {
  // Local stand-in for the Anthropic Messages API.
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(body || '{}') });
      if (req.headers['x-api-key'] !== KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '## Resumen\n- ChatGPT dejó de mencionarte en "mejor universidad en línea".' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
    });
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'IEXE', domain: 'www.iexe.edu.mx', canonicalUrl: 'https://www.iexe.edu.mx' } })).json().id;
});
afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  await app.close();
  await new Promise<void>(r => mock.close(() => r()));
  await prisma.$disconnect();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
let promptA: string;
let promptB: string;

describe('Visibilidad en IA', () => {
  it('uses the team scale: Directo 5/4/3, Citación 3/2/1', () => {
    expect([mentionScore(true, 1), mentionScore(true, 3), mentionScore(true, 4), mentionScore(false, 1)]).toEqual([5, 4, 3, 0]);
    expect([citeScore(true, 1), citeScore(true, 3), citeScore(true, 4), citeScore(false, null)]).toEqual([3, 2, 1, 0]);
  });

  it('manages questions with their keyword group', async () => {
    const a = await post(`/api/v1/sites/${siteId}/ai-visibility/prompts`, { text: '¿Cuál es la mejor universidad en línea de México?', keyword: 'Universidad en línea' });
    expect(a.statusCode).toBe(201);
    promptA = a.json().id;
    promptB = (await post(`/api/v1/sites/${siteId}/ai-visibility/prompts`, { text: '¿Dónde estudiar una maestría en políticas públicas en línea?', keyword: 'Políticas Públicas' })).json().id;
    expect((await post(`/api/v1/sites/${siteId}/ai-visibility/prompts`, { text: '¿Cuál es la mejor universidad en línea de México?', keyword: 'x' })).json().error.code).toBe('DUPLICATE_PROMPT');
  });

  it('records checks with the Directo and Citación rows, and computes result and trend', async () => {
    const save = (date: string, extra: object) => post(`/api/v1/sites/${siteId}/ai-visibility/observations`, { promptId: promptA, engine: 'chatgpt', date, mentioned: false, cited: false, ...extra });
    expect((await save('2026-09-21', { mentioned: true })).json().error.code).toBe('POSITION_REQUIRED');
    await save('2026-09-21', { mentioned: true, mentionPos: 1, mentionText: 'La mejor es IEXE Universidad...', cited: true, citePos: 3 });
    await save('2026-09-28', { mentioned: true, mentionPos: 3, cited: true, citePos: 3, citeComment: 'Ahora sale UNAM primero' });
    await save('2026-10-05', { mentioned: false, cited: false, mentionText: 'ignored when not shown' });
    // Saving the same question, engine and date again replaces it.
    await save('2026-10-05', { mentioned: false, cited: true, citePos: 4 });

    const h = (await app.inject(`/api/v1/sites/${siteId}/ai-visibility/history?promptId=${promptA}&engine=chatgpt`)).json();
    expect(h.map((o: { date: string }) => o.date)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(h.map((o: { mentionScore: number; citeScore: number }) => [o.mentionScore, o.citeScore])).toEqual([[5, 2], [4, 2], [0, 1]]);
    expect(h.map((o: { mentionTrend: string }) => o.mentionTrend)).toEqual(['primera', 'empeoro', 'empeoro']);
    expect(h.map((o: { citeTrend: string }) => o.citeTrend)).toEqual(['primera', 'neutral', 'empeoro']);
    expect(h[2].mentionText).toBeNull(); // a pasted answer is only kept when the row says "Sí"
    expect(h[1].citeComment).toBe('Ahora sale UNAM primero');

    await post(`/api/v1/sites/${siteId}/ai-visibility/observations`, { promptId: promptB, engine: 'gemini', date: '2026-10-05', mentioned: true, mentionPos: 1, cited: true, citePos: 1 });
  });

  it('builds the matrix, the weekly evolution, keyword groups and plain-language changes', async () => {
    const m = (await app.inject(`/api/v1/sites/${siteId}/ai-visibility/matrix`)).json();
    const rowA = m.rows.find((r: { prompt: { id: string } }) => r.prompt.id === promptA);
    expect(rowA.cells.chatgpt).toMatchObject({ total: 1, mentionScore: 0, citeScore: 1, trend: 'empeoro', checks: 3 });
    expect(rowA.cells.claude).toBeNull();
    expect(m.evolution.map((w: { week: string }) => w.week)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(m.evolution[0].chatgpt).toBe(7);
    expect(m.byKeyword.find((k: { keyword: string }) => k.keyword === 'Políticas Públicas')).toMatchObject({ checks: 1, avgPoints: 8, mentionRate: 100 });
    expect(m.insights[0]).toMatchObject({ tone: 'bad', text: expect.stringMatching(/bajó de 6 a 1 puntos.*Dejó de mencionarte/) });
    const filtered = (await app.inject(`/api/v1/sites/${siteId}/ai-visibility/matrix?keyword=${encodeURIComponent('Políticas Públicas')}`)).json();
    expect(filtered.rows).toHaveLength(1);
    const csv = (await app.inject(`/api/v1/sites/${siteId}/ai-visibility/export.csv`)).body;
    expect(csv).toContain('Pregunta,Keyword,Motor,Fecha,Fila,Aparece,Posición,Respuesta,Resultado,Tendencia,Comentarios');
    expect(csv).toContain('Citación,Sí,Top 3,,2,Neutral,Ahora sale UNAM primero');
  });

  it('stores API keys encrypted, shows only a hint, and only Admins manage them', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/anthropic', payload: { key: 'abc' } })).json().error.code).toBe('INVALID_KEY');
    expect((await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/anthropic', payload: { key: 'AIzaSyWrongProviderKey1234567890' } })).json().error.code).toBe('INVALID_KEY');
    const keys = (await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/anthropic', payload: { key: KEY } })).json();
    expect(keys.find((k: { provider: string }) => k.provider === 'anthropic')).toMatchObject({ configured: true, hint: '…ABCD' });
    expect(JSON.stringify(keys)).not.toContain('test-key');
    expect((await prisma.aiProviderKey.findFirstOrThrow()).keyEnc).not.toContain('test-key');
    const editor = await loginAs(app, 'EDITOR');
    expect((await app.inject({ url: '/api/v1/ai-keys', headers: { cookie: editor.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/ai-visibility/observations`, headers: { cookie: editor.cookie }, payload: { promptId: promptB, engine: 'claude', date: '2026-10-05', mentioned: false, cited: false } })).statusCode).toBe(200);
  });

  it('asks Claude for a written analysis with the matrix and the pasted answers', async () => {
    const r = await post(`/api/v1/sites/${siteId}/ai-visibility/analyses`, {});
    expect(r.statusCode).toBe(201);
    expect(r.json().text).toMatch(/dejó de mencionarte/);
    const call = seen[seen.length - 1];
    expect(call.path).toMatch(/^\/v1\/messages/);
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(String(call.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    const content = JSON.stringify(call.body.messages);
    expect(content).toContain('mejor universidad en línea');
    expect(content).toContain('La mejor es IEXE Universidad');
    expect((await app.inject(`/api/v1/sites/${siteId}/ai-visibility/analyses`)).json()).toHaveLength(1);

    await app.inject({ method: 'PUT', url: '/api/v1/ai-keys/anthropic', payload: { key: 'sk-ant-api03-wrong-key-00000000000000000000WXYZ' } });
    expect((await post(`/api/v1/sites/${siteId}/ai-visibility/analyses`, {})).json().error.code).toBe('AI_AUTH');
    await app.inject({ method: 'DELETE', url: '/api/v1/ai-keys/anthropic' });
    expect((await post(`/api/v1/sites/${siteId}/ai-visibility/analyses`, {})).json().error.code).toBe('AI_KEY_MISSING');
  });
});
