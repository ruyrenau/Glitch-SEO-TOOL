import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, analyzeExperiment } from '@glitch/db';
import { startMockGoogle, MockGoogle } from '@glitch/testing';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let google: MockGoogle;
let siteId: string;
const origin = 'https://exp.example.com';
const property = `${origin}/`;
const u = (p: string) => `${origin}${p}`;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

async function connect() {
  const start = await app.inject('/api/v1/gsc/oauth/start');
  const consent = await fetch(start.headers.location as string, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  await app.inject(callback.pathname + callback.search);
}

beforeAll(async () => {
  google = await startMockGoogle();
  Object.assign(process.env, google.env, { GSC_CLIENT_ID: 'test-client.apps.googleusercontent.com', GSC_CLIENT_SECRET: 'GOCSPX-test' });
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Exp', domain: 'exp.example.com', canonicalUrl: origin } })).json().id;
  google.properties.push({ siteUrl: property, permissionLevel: 'siteOwner' });
  // 100 days. The whole site has a seasonal +20 % from day −40 on; the test pages double from day −40 (the change).
  const pageDays: Array<{ date: string; page: string; clicks: number; impressions: number; position: number }> = [];
  for (let i = -100; i <= -3; i++) {
    const season = i > -40 ? 1.2 : 1;
    const wobble = [0, 2, -1, 1, -2, 1, 0][(i + 100) % 7];
    for (const p of ['/a', '/b']) pageDays.push({ date: day(i), page: u(p), clicks: Math.round((i > -40 ? 20 : 10) * season) + wobble, impressions: 400, position: i > -40 ? 4 : 6 });
    for (const p of ['/c', '/d', '/e']) pageDays.push({ date: day(i), page: u(p), clicks: Math.round(50 * season) + wobble, impressions: 1000, position: 5 });
  }
  google.data.set(property, { pages: [], queries: [], pageDays });
  await connect();
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/gsc`, payload: { property } });
});
afterAll(async () => {
  for (const k of [...Object.keys(google.env), 'GSC_CLIENT_ID', 'GSC_CLIENT_SECRET']) delete process.env[k];
  await app.close();
  await google.close();
  await prisma.$disconnect();
});

describe('Experimentos SEO', () => {
  let expId: string;

  it('validates the experiment: own URLs, no overlap, no future dates', async () => {
    const base = { name: 'Títulos con precio', changeDate: day(-40), testUrls: [u('/a'), u('/b')] };
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/experiments`, payload: { ...base, testUrls: ['https://otro.com/x'] } })).json().error.code).toBe('FOREIGN_URL');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/experiments`, payload: { ...base, controlUrls: [u('/a')] } })).json().error.code).toBe('OVERLAP');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/experiments`, payload: { ...base, changeDate: day(5) } })).json().error.code).toBe('FUTURE_DATE');
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/experiments`, payload: { ...base, hypothesis: 'Poner el precio en el título sube el CTR' } });
    expect(r.statusCode).toBe(201);
    expId = r.json().id;
    expect((await app.inject(`/api/v1/sites/${siteId}/experiments`)).json()).toMatchObject({ gscReady: true, items: [{ id: expId, windowDays: 28, analysis: null }] });
  });

  it('measures the change against the rest of the site, discounting seasonality', async () => {
    const r = (await app.inject({ method: 'POST', url: `/api/v1/experiments/${expId}/analyze` })).json();
    const a = r.analysis;
    expect(a.control.kind).toBe('site');
    expect(a.daysAfter).toBe(28);
    expect(a.pagesWithData).toBe(2);
    expect(a.test.after.clicks).toBeGreaterThan(a.test.before.clicks * 2); // raw: ×2.4 including the season
    expect(a.effect.clicks).toBeGreaterThan(0.8); // net of the +20 % the whole site got: about ×2
    expect(a.effect.clicks).toBeLessThan(1.2);
    expect(a.effect.position).toBeLessThan(0); // improved from 6 to 4
    expect(a.verdict).toBe('positive');
    expect(a.pValue).toBeLessThan(0.05);
    expect(a.series.length).toBe(28 + 1 + 28);
  });

  it('uses chosen control pages, clears the analysis when the experiment changes, and deletes', async () => {
    const p = await app.inject({ method: 'PATCH', url: `/api/v1/experiments/${expId}`, payload: { controlUrls: [u('/c')], notes: 'Cambiamos también la meta' } });
    expect(p.json()).toMatchObject({ analysis: null, notes: 'Cambiamos también la meta' });
    const a = (await app.inject({ method: 'POST', url: `/api/v1/experiments/${expId}/analyze` })).json().analysis;
    expect(a.control.kind).toBe('pages');
    expect(a.verdict).toBe('positive');
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/experiments/${expId}`, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/experiments/${expId}` })).statusCode).toBe(204);
  });

  it('waits for a week of data and flags too little traffic', () => {
    const rows = (from: number, to: number, clicks: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ date: day(from + i), clicks, impressions: 100, posImpr: 500 }));
    const recent = analyzeExperiment({ changeDate: day(-6), windowDays: 28, lastDataDate: day(-3), test: rows(-40, -3, 10), control: rows(-40, -3, 50), controlKind: 'site', pagesWithData: 1 });
    expect(recent.verdict).toBe('waiting');
    const tiny = analyzeExperiment({ changeDate: day(-40), windowDays: 28, lastDataDate: day(-3), test: rows(-70, -3, 0).map((r, i) => ({ ...r, clicks: i % 30 === 0 ? 1 : 0 })), control: rows(-70, -3, 50), controlKind: 'site', pagesWithData: 1 });
    expect(tiny.verdict).toBe('low_data');
  });
});
