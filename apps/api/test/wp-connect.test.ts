import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs } from './helpers';
import { redactUrl } from '../src/app';

let app: FastifyInstance;
let wp: MockWordPress;
let siteId: string;

const post = (url: string, payload: unknown, cookie?: string) => app.inject({ method: 'POST', url, payload: payload as object, ...(cookie ? { headers: { cookie } } : {}) });
const stateOf = (authorizeUrl: string) => new URL(new URL(authorizeUrl).searchParams.get('success_url')!).searchParams.get('state')!;
const callback = (params: Record<string, string>) => app.inject({ url: `/api/v1/wordpress/connect/callback?${new URLSearchParams(params)}`, headers: { cookie: '' } });
const landing = (r: { headers: Record<string, unknown> }) => new URL(String(r.headers.location));

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  siteId = (await post('/api/v1/sites', { name: 'Conectar', domain: new URL(wp.url).hostname, canonicalUrl: wp.url })).json().id;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await prisma.$disconnect();
});

describe('Conexión de WordPress con un clic', () => {
  it('sends to WordPress\'s own approval screen with G.SEO as the app', async () => {
    const r = (await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId })).json();
    const u = new URL(r.authorizeUrl);
    expect(`${u.origin}${u.pathname}`).toBe(`${wp.url}/wp-admin/authorize-application.php`);
    expect(u.searchParams.get('app_name')).toBe('G.SEO');
    expect(u.searchParams.get('app_id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.searchParams.get('success_url')).toMatch(/\/api\/v1\/wordpress\/connect\/callback\?state=/);
    expect(u.searchParams.get('reject_url')).toMatch(/nav=wordpress&wp=rejected/);
  });

  it('saves and tests the connection WordPress approved, once', async () => {
    const state = stateOf((await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId })).json().authorizeUrl);
    const r = await callback({ state, site_url: wp.url, user_login: wp.username, password: wp.appPassword });
    expect(landing(r).searchParams.get('wp')).toBe('connected');
    expect(landing(r).searchParams.get('site')).toBe(siteId);
    expect((await app.inject(`/api/v1/sites/${siteId}/wordpress`)).json().connection).toMatchObject({ status: 'ok', username: wp.username });
    // The same approval cannot be replayed.
    const again = await callback({ state, site_url: wp.url, user_login: wp.username, password: wp.appPassword });
    expect(landing(again).searchParams.get('message')).toMatch(/ya se usó/);
  });

  it('rejects forged states, answers from another host and wrong passwords', async () => {
    expect(landing(await callback({ state: 'x.y', site_url: wp.url, user_login: 'a', password: 'b' })).searchParams.get('message')).toMatch(/no es válida/);
    const s1 = stateOf((await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId })).json().authorizeUrl);
    expect(landing(await callback({ state: s1, site_url: 'https://evil.example.com', user_login: 'a', password: 'b' })).searchParams.get('message')).toMatch(/llegó de evil\.example\.com/);
    const s2 = stateOf((await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId })).json().authorizeUrl);
    expect(landing(await callback({ state: s2, site_url: wp.url, user_login: wp.username, password: 'mala' })).searchParams.get('wp')).toBe('error');
    const s3 = stateOf((await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId })).json().authorizeUrl);
    expect(landing(await callback({ state: s3 })).searchParams.get('message')).toMatch(/rechazaste/);
  });

  it('creates the site when the WordPress is new to G.SEO; viewers cannot start', async () => {
    const r = (await post('/api/v1/wordpress/connect/start', { url: 'https://nuevo-cliente.example.com/' })).json();
    expect(r.siteId).toBeTruthy();
    expect((await app.inject('/api/v1/sites')).json().find((x: { id: string }) => x.id === r.siteId)).toMatchObject({ domain: 'nuevo-cliente.example.com', canonicalUrl: 'https://nuevo-cliente.example.com' });
    const viewer = await loginAs(app, 'VIEWER');
    expect((await post('/api/v1/wordpress/connect/start', { url: wp.url, siteId }, viewer.cookie)).statusCode).toBe(403);
  });

  it('never logs the password WordPress sends back', () => {
    expect(redactUrl('/api/v1/wordpress/connect/callback?state=abc&site_url=https://x.com&user_login=ana&password=AbCd%20EfGh')).toBe('/api/v1/wordpress/connect/callback?state=[oculto]&site_url=https://x.com&user_login=ana&password=[oculto]');
  });
});
