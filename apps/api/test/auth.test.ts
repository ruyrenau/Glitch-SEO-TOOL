import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma, createUser } from '@glitch/db';
import { loginAs, TEST_PASSWORD } from './helpers';

let app: FastifyInstance;
let owner: Awaited<ReturnType<typeof loginAs>>;
let siteId: string;

const as = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }),
  post: (url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie, ...headers } }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object, headers: { cookie } }),
  patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, payload: payload as object, headers: { cookie } })
});

beforeAll(async () => {
  app = await buildApp({ logger: false });
  owner = await loginAs(app, 'OWNER');
  siteId = (await as(owner.cookie).post('/api/v1/sites', { name: 'Auth site', domain: 'auth.example.com', canonicalUrl: 'https://auth.example.com' })).json().id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('authentication', () => {
  it('protects the API but not health checks', async () => {
    expect((await app.inject('/api/v1/sites')).json().error.code).toBe('AUTH_REQUIRED');
    expect((await app.inject('/api/v1/sites')).statusCode).toBe(401);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/sites', headers: { cookie: 'glitch_session=forged' } })).statusCode).toBe(401);
  });

  it('sets an httpOnly SameSite=Lax cookie and never returns the password hash', async () => {
    await createUser({ username: 'cookie-check', name: 'Cookie', password: TEST_PASSWORD, role: 'VIEWER' });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'Cookie-Check', password: TEST_PASSWORD } });
    expect(r.statusCode).toBe(200);
    const setCookie = String(r.headers['set-cookie']);
    expect(setCookie).toMatch(/glitch_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.json())).not.toMatch(/passwordHash|\$2[aby]\$/);
    const stored = await prisma.session.findFirst({ where: { user: { username: 'cookie-check' } } });
    expect(setCookie).not.toContain(stored!.tokenHash); // only the hash is stored
  });

  it('gives the same answer for unknown users and wrong passwords, then throttles', async () => {
    await createUser({ username: 'throttle-me', name: 'T', password: TEST_PASSWORD, role: 'VIEWER' });
    const tryLogin = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    const unknown = await tryLogin('nobody-here', 'whatever-123');
    const wrong = await tryLogin('throttle-me', 'wrong-password-1');
    expect(unknown.json().error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: wrong.json().error.message });
    for (let i = 0; i < 4; i++) await tryLogin('throttle-me', 'wrong-password-1');
    const blocked = await tryLogin('throttle-me', TEST_PASSWORD); // even the right password
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const audit = await prisma.auditEvent.count({ where: { action: 'auth.login_failed' } });
    expect(audit).toBeGreaterThanOrEqual(5);
  });

  it('rejects state-changing requests from foreign origins (CSRF)', async () => {
    const evil = await as(owner.cookie).post('/api/v1/sites', { name: 'x', domain: 'x.com', canonicalUrl: 'https://x.com' }, { origin: 'https://evil.example' });
    expect(evil.json().error.code).toBe('CSRF_ORIGIN');
    const ok = await as(owner.cookie).post('/api/v1/sites', { name: 'Same origin', domain: 'ok.example.com', canonicalUrl: 'https://ok.example.com' }, { origin: 'http://localhost:3000' });
    expect(ok.statusCode).toBe(201);
  });

  it('logout ends the session', async () => {
    const s = await loginAs(app, 'VIEWER');
    expect((await as(s.cookie).get('/api/v1/auth/me')).statusCode).toBe(200);
    expect((await as(s.cookie).post('/api/v1/auth/logout')).statusCode).toBe(204);
    expect((await as(s.cookie).get('/api/v1/auth/me')).statusCode).toBe(401);
  });
});

describe('roles', () => {
  it('Viewer can read but not change anything', async () => {
    const v = await loginAs(app, 'VIEWER');
    expect((await as(v.cookie).get('/api/v1/sites')).statusCode).toBe(200);
    expect((await as(v.cookie).get(`/api/v1/sites/${siteId}/issues`)).statusCode).toBe(200);
    const r = await as(v.cookie).post(`/api/v1/sites/${siteId}/crawls`, {});
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatchObject({ code: 'FORBIDDEN', details: { required: 'seo:operate' } });
    expect((await as(v.cookie).post('/api/v1/schemas/validate', { '@type': 'Thing' })).statusCode).toBe(200); // stateless tool
  });

  it('Editor works on content but cannot crawl or manage WordPress credentials', async () => {
    const e = await loginAs(app, 'EDITOR');
    expect((await as(e.cookie).post(`/api/v1/sites/${siteId}/crawls`, {})).statusCode).toBe(403);
    expect((await as(e.cookie).put(`/api/v1/sites/${siteId}/wordpress`, { endpointUrl: 'https://wp.example.com', username: 'x', appPassword: 'xxxx-xxxx-xx' })).statusCode).toBe(403);
    const page = await as(e.cookie).post(`/api/v1/sites/${siteId}/generated-pages`, { titleTemplate: 'Título de prueba para el editor', bodyTemplate: '<h1>x</h1>', data: { a: '1' } });
    expect(page.statusCode).toBe(201);
  });

  it('SEO Manager operates crawls and issues but cannot manage sites or users', async () => {
    const m = await loginAs(app, 'SEO_MANAGER');
    expect((await as(m.cookie).post('/api/v1/issues/00000000-0000-0000-0000-000000000000/status', { status: 'ignored' })).json().error.code).toBe('ISSUE_NOT_FOUND'); // passed authorization
    expect((await as(m.cookie).post('/api/v1/sites', { name: 'n', domain: 'n.com', canonicalUrl: 'https://n.com' })).statusCode).toBe(403);
    expect((await as(m.cookie).get('/api/v1/users')).statusCode).toBe(403);
  });

  it('the reviewer recorded on approvals is the signed-in user, not a name in the body', async () => {
    const e = await loginAs(app, 'EDITOR');
    const page = (await as(e.cookie).post(`/api/v1/sites/${siteId}/generated-pages`, { titleTemplate: 'Página revisada por el editor', bodyTemplate: `<h1>R</h1><p>${'texto '.repeat(30)}{{x}}</p>`, slugTemplate: 'revisada', data: { x: 'y' } })).json();
    await as(e.cookie).post(`/api/v1/generated-pages/${page.id}/review`, { decision: 'rejected', reviewer: 'Someone Else' });
    const approval = await prisma.approval.findFirst({ where: { generatedPageId: page.id } });
    expect(approval).toMatchObject({ reviewer: 'Test EDITOR', userId: e.user.id });
  });

  it('audit events carry the acting user', async () => {
    const events = (await as(owner.cookie).get('/api/v1/audit-events?limit=500')).json() as Array<{ action: string; user: { name: string } | null }>;
    const created = events.find(ev => ev.action === 'site.created');
    expect(created?.user?.name).toBe('Test OWNER');
  });
});

describe('workspaces', () => {
  it('hides other workspaces exactly like missing resources', async () => {
    const ws = await prisma.workspace.create({ data: { name: 'Other', slug: `other-${Date.now()}` } });
    const other = await createUser({ username: `other-${Date.now()}`, name: 'Other owner', password: TEST_PASSWORD, role: 'OWNER', workspaceId: ws.id });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: other.username, password: TEST_PASSWORD } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const theirs = (await as(cookie).post('/api/v1/sites', { name: 'Theirs', domain: 'theirs.example.com', canonicalUrl: 'https://theirs.example.com' })).json();

    const mine = (await as(owner.cookie).get('/api/v1/sites')).json() as Array<{ id: string }>;
    expect(mine.map(s => s.id)).not.toContain(theirs.id);
    const peek = await as(owner.cookie).get(`/api/v1/sites/${theirs.id}/overview`);
    expect(peek.statusCode).toBe(404);
    expect((await as(cookie).get(`/api/v1/sites/${siteId}/issues`)).statusCode).toBe(404);
  });
});

describe('user management', () => {
  it('admin-created users must change the temporary password before doing anything', async () => {
    const created = await as(owner.cookie).post('/api/v1/users', { username: 'new-editor', name: 'Nueva', password: 'Temporal-12345', role: 'EDITOR' });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'new-editor', password: 'Temporal-12345' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect(login.json().user.mustChangePassword).toBe(true);
    expect((await as(cookie).get('/api/v1/sites')).json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await as(cookie).post('/api/v1/auth/password', { currentPassword: 'Temporal-12345', newPassword: 'corta' })).json().error.code).toBe('WEAK_PASSWORD');
    expect((await as(cookie).post('/api/v1/auth/password', { currentPassword: 'Temporal-12345', newPassword: 'Mi-clave-nueva-2026' })).statusCode).toBe(200);
    expect((await as(cookie).get('/api/v1/sites')).statusCode).toBe(200);
  });

  it('only owners touch owners, nobody demotes themselves, and the last owner stays', async () => {
    const admin = await loginAs(app, 'ADMIN');
    expect((await as(admin.cookie).post('/api/v1/users', { username: 'wannabe-owner', name: 'W', password: 'Temporal-12345', role: 'OWNER' })).json().error.code).toBe('OWNER_REQUIRED');
    expect((await as(admin.cookie).patch(`/api/v1/users/${owner.user.id}`, { disabled: true })).json().error.code).toBe('OWNER_REQUIRED');
    expect((await as(owner.cookie).patch(`/api/v1/users/${owner.user.id}`, { role: 'VIEWER' })).json().error.code).toBe('CANNOT_CHANGE_SELF');
  });

  it('disabling a user ends their sessions', async () => {
    const v = await loginAs(app, 'VIEWER');
    expect((await as(owner.cookie).patch(`/api/v1/users/${v.user.id}`, { disabled: true })).json().disabled).toBe(true);
    expect((await as(v.cookie).get('/api/v1/auth/me')).statusCode).toBe(401);
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: v.username, password: TEST_PASSWORD } });
    expect(again.statusCode).toBe(401);
  });
});
