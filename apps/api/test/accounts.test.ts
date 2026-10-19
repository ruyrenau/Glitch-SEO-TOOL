import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, sentMail } from '@glitch/db';
import { buildAuthedApp } from './helpers';

let app: FastifyInstance;
const anon = { cookie: '' };
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0];
const as = (cookie: string) => ({ cookie });
const PW = 'Clave-segura-2026';
const tokenFrom = (text: string, path: string) => new RegExp(`/${path}/([\\w-]+)`).exec(text)![1];

beforeAll(async () => {
  process.env.SMTP_URL = 'test://';
  process.env.SIGNUP_MAX_SITES = '1';
  process.env.SIGNUP_MAX_CRAWL_URLS = '500';
  ({ app } = await buildAuthedApp());
});
afterAll(async () => {
  for (const k of ['SMTP_URL', 'SIGNUP_MAX_SITES', 'SIGNUP_MAX_CRAWL_URLS', 'SIGNUP']) delete process.env[k];
  await app.close();
  await prisma.$disconnect();
});

describe('Cuentas y colaboradores', () => {
  let ana: string; // Ana's cookie
  let anaWs: string;

  it('signs up a new account with its own empty workspace and limits', async () => {
    expect((await app.inject({ url: '/api/v1/auth/config', headers: anon })).json()).toEqual({ signup: true, email: true });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { username: 'ana', name: 'Ana López', email: 'Ana@Agencia.mx', password: PW, workspaceName: 'Agencia Ana' } });
    expect(r.statusCode).toBe(201);
    ana = cookieOf(r);
    const me = (await app.inject({ url: '/api/v1/auth/me', headers: as(ana) })).json();
    expect(me.user).toMatchObject({ username: 'ana', email: 'ana@agencia.mx', role: 'OWNER', isSuperAdmin: false });
    expect(me.workspaces).toEqual([expect.objectContaining({ name: 'Agencia Ana', role: 'OWNER', sites: 0, maxSites: 1, maxCrawlUrls: 500 })]);
    anaWs = me.workspaceId;
    // Her workspace is empty: she does not see the other workspace's sites.
    expect((await app.inject({ url: '/api/v1/sites', headers: as(ana) })).json()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { username: 'ana2', name: 'X', email: 'ana@agencia.mx', password: PW } })).json().error.code).toBe('EMAIL_TAKEN');
  });

  it('enforces the workspace limits', async () => {
    const s = await app.inject({ method: 'POST', url: '/api/v1/sites', headers: as(ana), payload: { name: 'Uno', domain: 'uno.example.com', canonicalUrl: 'https://uno.example.com' } });
    expect(s.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/v1/sites', headers: as(ana), payload: { name: 'Dos', domain: 'dos.example.com', canonicalUrl: 'https://dos.example.com' } })).json().error.code).toBe('SITE_LIMIT');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${s.json().id}/crawls`, headers: as(ana), payload: { maxUrls: 1000 } })).json().error.code).toBe('CRAWL_LIMIT');
  });

  it('invites a new collaborator by email; the link creates the account in that workspace', async () => {
    const inv = await app.inject({ method: 'POST', url: '/api/v1/invitations', headers: as(ana), payload: { email: 'luis@agencia.mx', role: 'EDITOR' } });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toMatchObject({ emailed: true, acceptUrl: null });
    const mail = sentMail.at(-1)!;
    expect(mail).toMatchObject({ to: 'luis@agencia.mx', subject: 'Ana López te invitó a Agencia Ana en G.SEO' });
    const token = tokenFrom(mail.text, 'invite');
    expect((await app.inject({ url: `/api/v1/public/invitations/${token}`, headers: anon })).json()).toMatchObject({ workspace: 'Agencia Ana', role: 'EDITOR', hasAccount: false, inviter: 'Ana López' });
    expect((await app.inject({ url: '/api/v1/invitations', headers: as(ana) })).json()).toEqual([expect.objectContaining({ email: 'luis@agencia.mx', role: 'EDITOR' })]);

    const acc = await app.inject({ method: 'POST', url: `/api/v1/public/invitations/${token}/accept`, headers: anon, payload: { username: 'luis', name: 'Luis', password: PW } });
    expect(acc.statusCode).toBe(200);
    const luis = cookieOf(acc);
    const me = (await app.inject({ url: '/api/v1/auth/me', headers: as(luis) })).json();
    expect(me).toMatchObject({ workspaceId: anaWs, user: { role: 'EDITOR', email: 'luis@agencia.mx' } });
    expect((await app.inject({ url: '/api/v1/sites', headers: as(luis) })).json()).toHaveLength(1);
    // Used once.
    expect((await app.inject({ url: `/api/v1/public/invitations/${token}`, headers: anon })).statusCode).toBe(404);
    // Editors cannot invite.
    expect((await app.inject({ method: 'POST', url: '/api/v1/invitations', headers: as(luis), payload: { email: 'x@y.mx', role: 'VIEWER' } })).statusCode).toBe(403);
  });

  it('an existing account accepts into a second workspace and switches between them', async () => {
    // The test Owner (default cookie) invites Ana to the original workspace.
    await app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'ana@agencia.mx', role: 'SEO_MANAGER' } });
    const token = tokenFrom(sentMail.at(-1)!.text, 'invite');
    expect((await app.inject({ url: `/api/v1/public/invitations/${token}`, headers: anon })).json().hasAccount).toBe(true);
    const r = await app.inject({ method: 'POST', url: `/api/v1/auth/invitations/${token}/accept`, headers: as(ana) });
    expect(r.statusCode).toBe(200);
    const me = (await app.inject({ url: '/api/v1/auth/me', headers: as(ana) })).json();
    expect(me.workspaces).toHaveLength(2);
    expect(me.workspaceId).not.toBe(anaWs);
    expect(me.user.role).toBe('SEO_MANAGER');
    // Back to her own workspace.
    await app.inject({ method: 'POST', url: '/api/v1/auth/workspace', headers: as(ana), payload: { workspaceId: anaWs } });
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as(ana) })).json()).toMatchObject({ workspaceId: anaWs, user: { role: 'OWNER' } });
    // Cannot switch to a workspace she does not belong to.
    const other = await prisma.workspace.create({ data: { name: 'Ajeno', slug: `ajeno-${Date.now()}` } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/workspace', headers: as(ana), payload: { workspaceId: other.id } })).statusCode).toBe(404);
  });

  it('a workspace admin cannot disable or reset the account of someone who also works elsewhere', async () => {
    // Ana now belongs to her workspace and to the test Owner's: the test Owner cannot take over her account.
    const anaUser = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${anaUser.id}`, payload: { disabled: true } })).json().error.code).toBe('SHARED_ACCOUNT');
    expect((await app.inject({ method: 'POST', url: `/api/v1/users/${anaUser.id}/reset-password`, payload: { password: 'Robada-clave-2026' } })).json().error.code).toBe('SHARED_ACCOUNT');
    // Changing her role in this workspace is fine.
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${anaUser.id}`, payload: { role: 'VIEWER' } })).json().role).toBe('VIEWER');
  });

  it('removes a member from the workspace without deleting the account', async () => {
    const luis = await prisma.user.findUniqueOrThrow({ where: { username: 'luis' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/workspace/members/${luis.id}`, headers: as(ana) })).json()).toEqual({ removed: true });
    expect(await prisma.user.findUnique({ where: { id: luis.id } })).not.toBeNull();
    const anaUser = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/workspace/members/${anaUser.id}`, headers: as(ana) })).json().error.code).toBe('LAST_OWNER');
  });

  it('resets a forgotten password by email, once, and logs in with the email', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: anon, payload: { identifier: 'nadie@x.mx' } })).json()).toEqual({ ok: true });
    await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: anon, payload: { identifier: 'ana@agencia.mx' } });
    const token = tokenFrom(sentMail.at(-1)!.text, 'reset');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/reset', headers: anon, payload: { token, password: 'corta' } })).json().error.code).toBe('WEAK_PASSWORD');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/reset', headers: anon, payload: { token, password: 'Nueva-clave-2026' } })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/reset', headers: anon, payload: { token, password: 'Otra-clave-2026' } })).json().error.code).toBe('RESET_NOT_AVAILABLE');
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as(ana) })).statusCode).toBe(401); // old sessions end
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: anon, payload: { username: 'ana@agencia.mx', password: 'Nueva-clave-2026' } })).statusCode).toBe(200);
  });

  it('the instance administrator sees every workspace and changes limits; others cannot', async () => {
    const me = (await app.inject('/api/v1/auth/me')).json();
    await prisma.user.update({ where: { id: me.user.id }, data: { isSuperAdmin: true } });
    const list = (await app.inject('/api/v1/admin/workspaces')).json();
    const agencia = list.find((w: { name: string }) => w.name === 'Agencia Ana');
    expect(agencia).toMatchObject({ sites: 1, maxSites: 1, owners: ['ana@agencia.mx'] });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/admin/workspaces/${agencia.id}`, payload: { maxSites: 10, disabled: true } })).json()).toMatchObject({ maxSites: 10, disabled: true });
    // Suspended: Ana's own workspace no longer opens; she still has the other one.
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: anon, payload: { username: 'ana', password: 'Nueva-clave-2026' } });
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as(cookieOf(login)) })).json().workspaces.map((w: { name: string }) => w.name)).not.toContain('Agencia Ana');
    expect((await app.inject({ url: '/api/v1/admin/workspaces', headers: as(cookieOf(login)) })).statusCode).toBe(403);
  });

  it('closed sign-up refuses new accounts', async () => {
    process.env.SIGNUP = 'closed';
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { username: 'zeta', name: 'Z', email: 'z@z.mx', password: PW } })).json().error.code).toBe('SIGNUP_CLOSED');
    delete process.env.SIGNUP;
  });
});
