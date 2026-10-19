import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, sentMail } from '@glitch/db';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
const anon = { cookie: '' };
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0];
const as = (cookie: string) => ({ cookie });
const PW = 'Clave-segura-2026';
const tokenFrom = (text: string, path: string) => new RegExp(`/${path}/([\\w-]+)`).exec(text)![1];

beforeAll(async () => {
  process.env.SMTP_URL = 'test://';
  ({ app } = await buildAuthedApp());
  // The test Owner is the instance administrator (the "master" account).
  const me = (await app.inject('/api/v1/auth/me')).json();
  await prisma.user.update({ where: { id: me.user.id }, data: { isSuperAdmin: true } });
});
afterAll(async () => {
  for (const k of ['SMTP_URL']) delete process.env[k];
  await app.close();
  await prisma.$disconnect();
});

describe('Cuentas y colaboradores', () => {
  let ana: string; // Ana's cookie
  let anaWs: string;

  let ticket: string;
  it('only the administrator creates sign-up tickets', async () => {
    const t = await app.inject({ method: 'POST', url: '/api/v1/admin/tickets', payload: { label: 'Para Ana', maxUses: 1, expiresDays: 7, maxSites: 1, maxCrawlUrls: 500 } });
    expect(t.statusCode).toBe(200);
    ticket = t.json().code;
    expect(ticket).toMatch(/^GSEO-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(t.json().url).toContain(`/signup/${ticket}`);
    expect((await app.inject('/api/v1/admin/tickets')).json()[0]).toMatchObject({ label: 'Para Ana', status: 'active', uses: 0, hint: ticket.slice(-4) });
    expect(JSON.stringify(await prisma.signupTicket.findMany())).not.toContain(ticket); // only the hash is stored
  });

  it('signs up only with a valid ticket, which is then spent; the account gets its own empty workspace', async () => {
    expect((await app.inject({ url: '/api/v1/auth/config', headers: anon })).json()).toEqual({ signup: true, email: true });
    const base = { username: 'ana', name: 'Ana López', email: 'Ana@Agencia.mx', password: PW, workspaceName: 'Agencia Ana' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: base })).statusCode).toBe(400); // no ticket
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { ...base, ticket: 'GSEO-AAAA-BBBB-CCCC' } })).json().error.code).toBe('INVALID_TICKET');
    expect((await app.inject({ url: `/api/v1/auth/tickets/${ticket}`, headers: anon })).json()).toEqual({ valid: true, reason: null });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { ...base, ticket: ticket.toLowerCase() } });
    expect(r.statusCode).toBe(201);
    expect((await app.inject({ url: `/api/v1/auth/tickets/${ticket}`, headers: anon })).json()).toEqual({ valid: false, reason: 'El código ya se usó.' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { ...base, username: 'otra', email: 'otra@x.mx', ticket } })).json().error.code).toBe('INVALID_TICKET');
    ana = cookieOf(r);
    const me = (await app.inject({ url: '/api/v1/auth/me', headers: as(ana) })).json();
    expect(me.user).toMatchObject({ username: 'ana', email: 'ana@agencia.mx', role: 'OWNER', isSuperAdmin: false });
    expect(me.workspaces).toEqual([expect.objectContaining({ name: 'Agencia Ana', role: 'OWNER', sites: 0, maxSites: 1, maxCrawlUrls: 500 })]);
    expect(me.canCreateWorkspace).toBe(false); // regular accounts own one workspace unless the administrator allows more
    expect((await app.inject({ method: 'POST', url: '/api/v1/workspaces', headers: as(ana), payload: { name: 'Otro' } })).json().error.code).toBe('WORKSPACE_LIMIT');
    // She cannot see the administration.
    for (const url of ['/api/v1/admin/tickets', '/api/v1/admin/users', '/api/v1/admin/settings', '/api/v1/admin/workspaces']) expect((await app.inject({ url, headers: as(ana) })).statusCode).toBe(403);
    anaWs = me.workspaceId;
    // Her workspace is empty: she does not see the other workspace's sites.
    expect((await app.inject({ url: '/api/v1/sites', headers: as(ana) })).json()).toEqual([]);

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
    // Ana now belongs to her workspace and to this one: an Admin here (not the instance administrator) cannot take over her account.
    const admin = await loginAs(app, 'ADMIN');
    const anaUser = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${anaUser.id}`, headers: as(admin.cookie), payload: { disabled: true } })).json().error.code).toBe('SHARED_ACCOUNT');
    expect((await app.inject({ method: 'POST', url: `/api/v1/users/${anaUser.id}/reset-password`, headers: as(admin.cookie), payload: { password: 'Robada-clave-2026' } })).json().error.code).toBe('SHARED_ACCOUNT');
    // Changing her role in this workspace is fine.
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${anaUser.id}`, headers: as(admin.cookie), payload: { role: 'VIEWER' } })).json().role).toBe('VIEWER');
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

  it('the instance administrator sees every account and can disable one', async () => {
    const users = (await app.inject('/api/v1/admin/users')).json();
    const luis = users.find((u: { username: string }) => u.username === 'luis');
    expect(luis).toMatchObject({ disabled: false, isSuperAdmin: false });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${luis.id}`, payload: { disabled: true } })).json()).toEqual({ id: luis.id, disabled: true });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: anon, payload: { username: 'luis', password: PW } })).statusCode).toBe(401);
    const me = (await app.inject('/api/v1/auth/me')).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${me.user.id}`, payload: { disabled: true } })).json().error.code).toBe('CANNOT_CHANGE_SELF');
  });

  it('the instance administrator sees every workspace and changes limits; others cannot', async () => {
    const list = (await app.inject('/api/v1/admin/workspaces')).json();
    const agencia = list.find((w: { name: string }) => w.name === 'Agencia Ana');
    expect(agencia).toMatchObject({ sites: 1, maxSites: 1, owners: ['ana@agencia.mx'] });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/admin/workspaces/${agencia.id}`, payload: { maxSites: 10, disabled: true } })).json()).toMatchObject({ maxSites: 10, disabled: true });
    // Suspended: Ana's own workspace no longer opens; she still has the other one.
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: anon, payload: { username: 'ana', password: 'Nueva-clave-2026' } });
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as(cookieOf(login)) })).json().workspaces.map((w: { name: string }) => w.name)).not.toContain('Agencia Ana');
    expect((await app.inject({ url: '/api/v1/admin/workspaces', headers: as(cookieOf(login)) })).statusCode).toBe(403);
  });

  it('the administrator can turn sign-up off: even valid tickets stop working', async () => {
    const code = (await app.inject({ method: 'POST', url: '/api/v1/admin/tickets', payload: {} })).json().code;
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', payload: { signupEnabled: false } })).json()).toMatchObject({ signupEnabled: false });
    expect((await app.inject({ url: '/api/v1/auth/config', headers: anon })).json().signup).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { ticket: code, username: 'zeta', name: 'Z', email: 'z@z.mx', password: PW } })).json().error.code).toBe('SIGNUP_CLOSED');
    await app.inject({ method: 'PUT', url: '/api/v1/admin/settings', payload: { signupEnabled: true } });
    const list = (await app.inject('/api/v1/admin/tickets')).json();
    await app.inject({ method: 'DELETE', url: `/api/v1/admin/tickets/${list[0].id}` });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: anon, payload: { ticket: code, username: 'zeta', name: 'Z', email: 'z@z.mx', password: PW } })).json().error.code).toBe('INVALID_TICKET');
  });
});
