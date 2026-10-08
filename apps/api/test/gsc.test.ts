import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startFixtureSite, startMockGoogle, FixtureSite, MockGoogle } from '@glitch/testing';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let google: MockGoogle;
let site: FixtureSite;
let siteId: string;
let property: string;

const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload: payload as object });

/** Runs the OAuth dance: our start URL → (mock) Google consent → our callback. Returns where the browser lands. */
async function connect() {
  const start = await app.inject('/api/v1/gsc/oauth/start');
  expect(start.statusCode).toBe(302);
  const consent = await fetch(start.headers.location as string, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  const r = await app.inject(callback.pathname + callback.search);
  expect(r.statusCode).toBe(302);
  return new URL(r.headers.location as string);
}

beforeAll(async () => {
  google = await startMockGoogle();
  Object.assign(process.env, google.env, { GSC_CLIENT_ID: 'test-client.apps.googleusercontent.com', GSC_CLIENT_SECRET: 'GOCSPX-test', CRAWL_ALLOW_PRIVATE_HOSTS: '127.0.0.1' });
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  property = `${site.origin}/`;
  siteId = (await post('/api/v1/sites', { name: 'GSC', domain: '127.0.0.1', canonicalUrl: site.origin })).json().id;
  const crawl = await post(`/api/v1/sites/${siteId}/crawls`, { rps: 20, concurrency: 4, maxDepth: 10 });
  await waitForJob(app, crawl.json().jobId);

  google.properties.push({ siteUrl: property, permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:otro.example', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://no-verificado.example/', permissionLevel: 'siteUnverifiedUser' });
  const u = (p: string) => `${site.origin}${p}`;
  google.data.set(property, {
    pages: [
      { page: u('/'), clicks: 600, impressions: 3000, position: 2.1 }, // 20 % CTR at position 2: healthy
      { page: u('/about/'), clicks: 3, impressions: 2500, position: 3.0 }, // trailing slash vs crawled /about; low CTR at position 3
      { page: u('/noindex-page'), clicks: 4, impressions: 400, position: 9.2 }, // shown by Google but noindex in the crawl
      { page: u('/pagina-que-no-enlazamos'), clicks: 1, impressions: 90, position: 12 } // not found by the crawl
    ],
    queries: [
      { query: 'auditoria seo puebla', page: u('/'), clicks: 100, impressions: 1500, position: 1.8 },
      { query: 'auditoria seo puebla', page: u('/about/'), clicks: 1, impressions: 300, position: 8 }, // two pages → cannibalisation
      { query: 'seo tecnico precio', page: u('/about/'), clicks: 2, impressions: 900, position: 7.4 }, // opportunity
      { query: 'consultor seo', page: u('/noindex-page'), clicks: 4, impressions: 400, position: 9.2 }
    ]
  });
});
afterAll(async () => {
  for (const k of [...Object.keys(google.env), 'GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'CRAWL_ALLOW_PRIVATE_HOSTS']) delete process.env[k];
  await app.close();
  await google.close();
  await site.close();
  await prisma.$disconnect();
});

describe('Google Search Console', () => {
  it('reports whether the server is configured and an account is connected', async () => {
    expect((await app.inject('/api/v1/gsc/status')).json()).toMatchObject({ configured: true, connected: false });
    delete process.env.GSC_CLIENT_ID;
    expect((await app.inject('/api/v1/gsc/status')).json().configured).toBe(false);
    expect((await app.inject('/api/v1/gsc/oauth/start')).json().error.code).toBe('GSC_NOT_CONFIGURED');
    process.env.GSC_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  });

  it('refuses a consent without the Search Console scope and a forged state', async () => {
    google.grantScopes('openid email');
    const landed = await connect();
    expect(landed.searchParams.get('gsc')).toBe('error');
    expect(landed.searchParams.get('message')).toMatch(/Search Console/);
    google.grantScopes(null);

    const forged = await app.inject('/api/v1/gsc/oauth/callback?code=x&state=abc.def');
    expect(new URL(forged.headers.location as string).searchParams.get('message')).toMatch(/no es válida/);
    const denied = await app.inject('/api/v1/gsc/oauth/callback?error=access_denied');
    expect(new URL(denied.headers.location as string).searchParams.get('message')).toMatch(/Cancelaste/);
  });

  it('connects with OAuth, stores the token encrypted and lists verified properties', async () => {
    const landed = await connect();
    expect(landed.origin).toBe('http://localhost:3000');
    expect(landed.searchParams.get('gsc')).toBe('connected');
    expect((await app.inject('/api/v1/gsc/status')).json()).toMatchObject({ connected: true, email: 'seo@example.com' });
    const acc = await prisma.googleAccount.findFirstOrThrow();
    expect(acc.refreshTokenEnc).not.toContain('refresh-');
    const props = (await app.inject('/api/v1/gsc/properties')).json();
    expect(props.map((p: { siteUrl: string }) => p.siteUrl)).toEqual([property, 'sc-domain:otro.example']);
  });

  it('assigns a property to the site and refuses one the account cannot read', async () => {
    const bad = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/gsc`, payload: { property: 'https://ajeno.example/' } });
    expect(bad.json().error.code).toBe('GSC_PROPERTY_NOT_FOUND');
    const ok = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/gsc`, payload: { property } });
    expect(ok.json()).toEqual({ gscProperty: property, matchesSite: true });
  });

  it('imports Search Analytics in the background and crosses it with the crawl', async () => {
    const r = await post(`/api/v1/sites/${siteId}/gsc/import`, { days: 28 });
    expect(r.statusCode).toBe(202);
    const job = await waitForJob(app, r.json().jobId);
    expect(job.status).toBe('COMPLETED');

    const rep = (await app.inject(`/api/v1/sites/${siteId}/gsc/report`)).json();
    expect(rep.totals).toMatchObject({ clicks: 608, impressions: 5990, pages: 4, queries: 3 });
    expect(rep.daily).toHaveLength(28);
    expect(rep.topQueries[0]).toMatchObject({ query: 'auditoria seo puebla', clicks: 101, impressions: 1800, pages: 2 });
    expect(rep.opportunities.map((q: { query: string }) => q.query)).toEqual(['seo tecnico precio', 'consultor seo']);
    expect(rep.cannibalization.map((q: { query: string }) => q.query)).toEqual(['auditoria seo puebla']);
    expect(rep.lowCtr.map((p: { page: string }) => p.page)).toEqual([`${site.origin}/about/`]);
    expect(rep.crawl.nonIndexableWithImpressions).toEqual([expect.objectContaining({ page: `${site.origin}/noindex-page`, impressions: 400, reason: expect.stringMatching(/noindex/i) })]);
    expect(rep.crawl.notInCrawl.map((p: { page: string }) => p.page)).toEqual([`${site.origin}/pagina-que-no-enlazamos`]);
    // /about matched despite the trailing slash, so it is not reported as missing impressions.
    expect(rep.crawl.indexableWithoutImpressions).not.toContain(`${site.origin}/about`);
    expect(rep.crawl.indexableWithoutImpressionsCount).toBeGreaterThan(3);
  });

  it('adds clicks, impressions and position to the explorer', async () => {
    const run = await prisma.crawlRun.findFirstOrThrow({ where: { siteId, status: 'completed' } });
    const s = (await app.inject(`/api/v1/crawls/${run.id}/explorer/summary`)).json();
    const tab = s.tabs.find((t: { id: string }) => t.id === 'gsc');
    const c = (f: string) => tab.filters.find((x: { id: string }) => x.id === f).count;
    expect(c('with-impressions')).toBe(3); // "/", "/about" (trailing slash) and "/noindex-page"
    expect(c('non-indexable-with-impressions')).toBe(1);
    expect(c('striking-distance')).toBe(1); // /noindex-page at 9.2
    expect(c('low-ctr')).toBe(1);
    const rows = (await app.inject(`/api/v1/crawls/${run.id}/explorer?tab=gsc&sort=impressions&dir=desc`)).json().rows;
    expect(rows[0]).toMatchObject({ url: `${site.origin}/`, clicks: 600, impressions: 3000, position: 2.1 });
  });

  it('restricts who can connect or import, and disconnects by revoking the token', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ url: '/api/v1/gsc/oauth/start', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/gsc/import`, headers: { cookie: viewer.cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/gsc/report`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);

    const r = await app.inject({ method: 'DELETE', url: '/api/v1/gsc/connection' });
    expect(r.json()).toEqual({ disconnected: true });
    expect(google.revoked).toHaveLength(1);
    expect((await app.inject('/api/v1/gsc/status')).json().connected).toBe(false);
    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['gsc.connected', 'gsc.property_set', 'gsc.imported', 'gsc.disconnected']));
  });
});
