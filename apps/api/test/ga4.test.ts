import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockGoogle, MockGoogle } from '@glitch/testing';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let google: MockGoogle;
let siteId: string;
const O = 'https://tienda.example.com';
const P = 'properties/123456';

async function connect(back?: string) {
  const start = await app.inject(`/api/v1/gsc/oauth/start${back ? `?back=${back}` : ''}`);
  const consent = await fetch(start.headers.location as string, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  // Browsers do not send the SameSite=Lax session cookie when Google redirects back after its consent form.
  return new URL((await app.inject({ url: callback.pathname + callback.search, headers: { cookie: '' } })).headers.location as string);
}
const m = (sessions: number, engaged: number, keyEvents = 0, revenue = 0) => ({ sessions, users: Math.round(sessions * 0.8), engaged, engagementSec: engaged * 60, keyEvents, revenue });

beforeAll(async () => {
  google = await startMockGoogle();
  Object.assign(process.env, google.env, { GSC_CLIENT_ID: 'test-client.apps.googleusercontent.com', GSC_CLIENT_SECRET: 'GOCSPX-test' });
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Tienda', domain: 'tienda.example.com', canonicalUrl: O } })).json().id;
  google.ga4Properties.push({ property: P, displayName: 'Tienda GA4' });
  google.ga4.set(P, {
    organic: [{ page: '/sillas', ...m(500, 350, 20, 15000) }, { page: '/blog/guia', ...m(300, 60, 1) }, { page: '/', ...m(200, 150, 5) }],
    ai: [
      { page: '/sillas', source: 'chatgpt.com', ...m(40, 30, 3) },
      { page: '/sillas', source: 'perplexity.ai', ...m(10, 8, 1) },
      { page: '/blog/guia', source: 'gemini.google.com', ...m(5, 2) }
    ],
    daily: [
      { date: '2026-10-01', channel: 'Organic Search', sessions: 600, keyEvents: 15 },
      { date: '2026-10-01', channel: 'Direct', sessions: 300, keyEvents: 5 },
      { date: '2026-10-02', channel: 'Organic Search', sessions: 400, keyEvents: 11 }
    ]
  });
  // Search Console clicks for the cross.
  const imp = await prisma.gscImport.create({ data: { siteId, property: `${O}/`, startDate: '2026-07-01', endDate: '2026-10-15', status: 'completed', completedAt: new Date() } });
  await prisma.gscPageStat.create({ data: { importId: imp.id, page: `${O}/blog/guia`, clicks: 320, impressions: 9000, ctr: 0.035, position: 4.2 } });
});
afterAll(async () => {
  for (const k of [...Object.keys(google.env), 'GSC_CLIENT_ID', 'GSC_CLIENT_SECRET']) delete process.env[k];
  await app.close();
  await google.close();
  await prisma.$disconnect();
});

describe('Google Analytics 4', () => {
  it('asks to reconnect when the Google account has no Analytics permission', async () => {
    google.grantScopes('openid email https://www.googleapis.com/auth/webmasters.readonly');
    await connect();
    google.grantScopes(null);
    expect((await app.inject('/api/v1/ga4/status')).json()).toMatchObject({ connected: true, analytics: false });
    const r = await app.inject('/api/v1/ga4/properties');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('GA4_SCOPE_MISSING');
  });

  it('reconnects from the Analytics page, lists properties and assigns one to the site', async () => {
    const landed = await connect('ga4');
    expect(landed.searchParams.get('nav')).toBe('ga4');
    expect(landed.searchParams.get('gsc')).toBe('connected');
    // A tampered state is refused even though the route needs no cookie.
    const forged = await app.inject({ url: '/api/v1/gsc/oauth/callback?code=x&state=abc.def', headers: { cookie: '' } });
    expect(new URL(forged.headers.location as string).searchParams.get('gsc')).toBe('error');
    expect((await app.inject('/api/v1/ga4/status')).json()).toMatchObject({ analytics: true });
    expect((await app.inject('/api/v1/ga4/properties')).json()).toEqual([{ property: P, displayName: 'Tienda GA4', account: 'Cuenta de prueba' }]);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/ga4`, payload: { property: 'properties/999' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/ga4`, payload: { property: P } })).json()).toMatchObject({ ga4Property: P, ga4PropertyName: 'Tienda GA4 (Cuenta de prueba)' });
  });

  it('imports organic landing pages, AI referrals and channels, and crosses them with Search Console', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/ga4/import`, payload: { days: 28 } });
    expect(r.statusCode).toBe(202);
    expect((await waitForJob(app, r.json().jobId)).status).toBe('COMPLETED');
    const rep = (await app.inject(`/api/v1/sites/${siteId}/ga4/report`)).json();
    expect(rep.totals.organic).toMatchObject({ sessions: 1000, keyEvents: 26, revenue: 15000, engagementRate: 56 });
    expect(rep.totals).toMatchObject({ allSessions: 1300, organicShare: 76.9 });
    expect(rep.channels[0]).toMatchObject({ channel: 'Organic Search', sessions: 1000 });
    expect(rep.daily).toEqual([{ date: '2026-10-01', organic: 600, total: 900 }, { date: '2026-10-02', organic: 400, total: 400 }]);
    expect(rep.organicPages[0]).toMatchObject({ page: '/sillas', url: `${O}/sillas`, sessions: 500, engagementRate: 70, conversionRate: 4 });
    expect(rep.ai.engines.map((e: { engine: string }) => e.engine)).toEqual(['ChatGPT', 'Perplexity', 'Gemini']);
    expect(rep.ai.pages[0]).toMatchObject({ page: '/sillas', sessions: 50, engines: [{ engine: 'ChatGPT', sessions: 40 }, { engine: 'Perplexity', sessions: 10 }] });
    expect(rep.lowEngagement).toEqual([expect.objectContaining({ page: '/blog/guia', engagementRate: 20, clicks: 320 })]);
  });

  it('only operators import; changing the property needs site management', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/ga4/import`, headers: { cookie: viewer.cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/ga4`, headers: { cookie: viewer.cookie }, payload: { property: null } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/ga4/report`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
  });
});
