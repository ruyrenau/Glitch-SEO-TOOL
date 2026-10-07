import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  actorContext,
  login,
  logout,
  getSession,
  changeOwnPassword,
  can,
  Permission,
  SessionContext,
  SESSION_TTL_MS,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  WorkflowError
} from '@glitch/db';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SessionContext;
  }
}

export const SESSION_COOKIE = 'glitch_session';

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Route → permission. Anything that changes data and is not listed requires site:manage.
// ---------------------------------------------------------------------------
const RULES: Array<[RegExp, RegExp, Permission]> = [
  [/^POST$/, /^\/api\/v1\/(schemas\/validate|generated-pages\/preview)$/, 'read'],
  // Every signed-in user can end their own session and change their own password.
  [/^POST$/, /^\/api\/v1\/auth\/(logout|password)$/, 'read'],
  [/^POST$/, /^\/api\/v1\/sites\/:id\/(log-imports|sitemap|crawls)$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/crawls\/:id\/cancel$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/jobs\/:id\/(cancel|retry)$/, 'seo:operate'],
  [/^PUT$/, /^\/api\/v1\/sites\/:id\/schedule$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/sites\/:id\/performance$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/(issues\/:id\/status|alerts\/:id\/acknowledge)$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/sites\/:id\/wordpress\/test$/, 'seo:operate'],
  [/^POST$/, /^\/api\/v1\/sites\/:id\/(generated-pages|datasets)$/, 'content:edit'],
  [/^POST$/, /^\/api\/v1\/(datasets\/:id\/templates|templates\/:id\/generate)$/, 'content:edit'],
  [/^POST$/, /^\/api\/v1\/generated-pages\/(:id\/review|bulk-review|:id\/archive)$/, 'content:edit'],
  [/^POST$/, /^\/api\/v1\/generated-pages\/(:id\/wordpress\/(dry-run|push)|bulk-push)$/, 'wordpress:send'],
  [/^POST$/, /^\/api\/v1\/wordpress\/publications\/:id\/rollback$/, 'wordpress:send'],
  [/^(POST|PATCH)$/, /^\/api\/v1\/users(\/:id(\/reset-password)?)?$/, 'users:manage'],
  [/^GET$/, /^\/api\/v1\/users$/, 'users:manage']
];

export function permissionFor(method: string, route: string): Permission {
  for (const [m, r, p] of RULES) if (m.test(method) && r.test(route)) return p;
  return method === 'GET' || method === 'HEAD' ? 'read' : 'site:manage';
}

// ---------------------------------------------------------------------------
// Workspace ownership of the resource named by :id in the route.
// ---------------------------------------------------------------------------
async function workspaceOfResource(route: string, id: string): Promise<string | null | undefined> {
  const viaSite = (s: { site: { workspaceId: string } | null } | null) => (s ? s.site?.workspaceId ?? null : undefined);
  if (/^\/api\/v1\/sites\/:id/.test(route)) return (await prisma.site.findUnique({ where: { id }, select: { workspaceId: true } }))?.workspaceId;
  if (/^\/api\/v1\/crawls\/:id/.test(route)) return viaSite(await prisma.crawlRun.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/issues\/:id/.test(route)) return viaSite(await prisma.issue.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/alerts\/:id/.test(route)) return viaSite(await prisma.alert.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/log-imports\/:id/.test(route)) return viaSite(await prisma.logImport.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/datasets\/:id/.test(route)) return viaSite(await prisma.dataset.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/templates\/:id/.test(route)) {
    const t = await prisma.contentTemplate.findUnique({ where: { id }, select: { dataset: { select: { site: { select: { workspaceId: true } } } } } });
    return t ? t.dataset.site?.workspaceId ?? null : undefined;
  }
  if (/^\/api\/v1\/generated-pages\/:id/.test(route)) return viaSite(await prisma.generatedPage.findUnique({ where: { id }, select: { site: { select: { workspaceId: true } } } }));
  if (/^\/api\/v1\/wordpress\/publications\/:id/.test(route)) {
    const p = await prisma.wordPressPublication.findUnique({ where: { id }, select: { generatedPage: { select: { site: { select: { workspaceId: true } } } } } });
    return p ? p.generatedPage.site?.workspaceId ?? null : undefined;
  }
  if (/^\/api\/v1\/jobs\/:id/.test(route)) return (await prisma.job.findUnique({ where: { id }, select: { workspaceId: true } }))?.workspaceId;
  if (/^\/api\/v1\/users\/:id/.test(route)) {
    const m = await prisma.workspaceMember.findFirst({ where: { userId: id }, select: { workspaceId: true } });
    return m?.workspaceId;
  }
  return null; // route has no workspace-scoped :id
}

/** Bulk endpoints carry page ids in the body; all of them must belong to the caller's workspace. */
async function assertBulkOwnership(route: string, body: unknown, workspaceId: string) {
  if (!/^\/api\/v1\/generated-pages\/bulk-(review|push)$/.test(route)) return;
  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids)) return; // validation happens in the handler
  const pages = await prisma.generatedPage.findMany({ where: { id: { in: ids.filter((x): x is string => typeof x === 'string') } }, select: { site: { select: { workspaceId: true } } } });
  if (pages.some(p => p.site?.workspaceId !== workspaceId)) throw new HttpError(404, 'NOT_FOUND', 'Some pages were not found');
}

// ---------------------------------------------------------------------------
// Login throttling (in memory): 5 failures per username+IP and 30 per IP in 15 minutes.
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, number[]>();
const recent = (key: string) => (failures.get(key) ?? []).filter(t => Date.now() - t < WINDOW_MS);
function throttled(ip: string, username: string): number | null {
  const a = recent(`u:${ip}|${username}`);
  const b = recent(`ip:${ip}`);
  if (a.length >= 5) return Math.ceil((a[0] + WINDOW_MS - Date.now()) / 1000);
  if (b.length >= 30) return Math.ceil((b[0] + WINDOW_MS - Date.now()) / 1000);
  return null;
}
function recordFailure(ip: string, username: string) {
  for (const k of [`u:${ip}|${username}`, `ip:${ip}`]) failures.set(k, [...recent(k), Date.now()]);
}
function clearFailures(ip: string, username: string) {
  failures.delete(`u:${ip}|${username}`);
}

const PUBLIC = [/^\/health(\/|$)/, /^\/docs(\/|$)/, /^\/api\/v1\/auth\/login$/];
const ALLOWED_WHILE_CHANGING_PASSWORD = /^\/api\/v1\/auth\/(me|password|logout)$/;

export async function registerAuth(app: FastifyInstance) {
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set((process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map(s => s.trim()));
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: SESSION_TTL_MS / 1000 };

  const sendError = (reply: FastifyReply, req: FastifyRequest, e: HttpError) => {
    if (e.status === 429 && e.details.retryAfter) reply.header('retry-after', String(e.details.retryAfter));
    return reply.status(e.status).send({ error: { code: e.code, message: e.message, details: e.details, correlationId: req.id } });
  };

  // Authentication, CSRF, password-change gate, permission and workspace checks.
  // Callback style so the actor context (AsyncLocalStorage) wraps the rest of the request.
  app.addHook('preHandler', (req, reply, done) => {
    const route = req.routeOptions.url ?? req.url.split('?')[0];
    const path = req.url.split('?')[0];
    if (req.method === 'OPTIONS' || PUBLIC.some(r => r.test(path))) return done();

    (async () => {
      // CSRF: browsers always send Origin on cross-site POST/PUT/DELETE; reject foreign ones.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'CSRF_ORIGIN', 'Request origin not allowed');

      const ctx = await getSession(req.cookies[SESSION_COOKIE]);
      if (!ctx) throw new HttpError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar');
      req.auth = ctx;
      if (ctx.user.mustChangePassword && !ALLOWED_WHILE_CHANGING_PASSWORD.test(route)) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña antes de continuar');

      const perm = permissionFor(req.method, route);
      if (!can(ctx.role, perm)) throw new HttpError(403, 'FORBIDDEN', `Tu rol (${ctx.user.roleLabel}) no permite esta acción`, { required: perm });

      const id = (req.params as { id?: string } | undefined)?.id;
      if (id && /^[0-9a-f-]{36}$/i.test(id)) {
        const ws = await workspaceOfResource(route, id);
        // Resources of another workspace look exactly like missing ones.
        if (ws !== null && ws !== undefined && ws !== ctx.workspaceId) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      }
      await assertBulkOwnership(route, req.body, ctx.workspaceId);
      return ctx;
    })()
      .then(ctx => {
        if (!ctx) return done();
        actorContext.run({ userId: ctx.user.id, workspaceId: ctx.workspaceId }, () => done());
      })
      .catch(err => {
        if (err instanceof HttpError) {
          if (err.status === 401) reply.clearCookie(SESSION_COOKIE, { path: '/' });
          sendError(reply, req, err);
        } else done(err);
      });
  });

  // ------------------------------------------------------------------ auth routes
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }).strict().parse(req.body);
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return sendError(reply, req, new HttpError(403, 'CSRF_ORIGIN', 'Request origin not allowed'));
    const username = body.username.trim().toLowerCase();
    const wait = throttled(req.ip, username);
    if (wait) return sendError(reply, req, new HttpError(429, 'TOO_MANY_ATTEMPTS', `Demasiados intentos. Espera ${Math.ceil(wait / 60)} min.`, { retryAfter: wait }));
    const r = await login(username, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r) {
      recordFailure(req.ip, username);
      return sendError(reply, req, new HttpError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos'));
    }
    clearFailures(req.ip, username);
    reply.setCookie(SESSION_COOKIE, r.token, cookieOpts);
    return { user: r.user };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    await logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async req => ({ user: req.auth!.user, workspaceId: req.auth!.workspaceId }));

  app.post('/api/v1/auth/password', async req => {
    const b = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).strict().parse(req.body);
    await changeOwnPassword(req.auth!.user.id, req.auth!.sessionId, b.currentPassword, b.newPassword);
    return { ok: true };
  });

  // ------------------------------------------------------------------ users (admin)
  const roleEnum = z.enum(['OWNER', 'ADMIN', 'SEO_MANAGER', 'EDITOR', 'VIEWER']);
  app.get('/api/v1/users', async req => listUsers(req.auth!.workspaceId));

  app.post('/api/v1/users', async (req, reply) => {
    const b = z
      .object({ username: z.string().min(3).max(40), name: z.string().min(1).max(100), email: z.string().email().max(200).optional(), password: z.string().min(1).max(200), role: roleEnum })
      .strict()
      .parse(req.body);
    if (b.role === 'OWNER' && req.auth!.role !== 'OWNER') return sendError(reply, req, new HttpError(403, 'OWNER_REQUIRED', 'Solo un Owner puede crear otro Owner'));
    // Accounts created by an admin start with a temporary password.
    return reply.status(201).send(await createUser({ ...b, workspaceId: req.auth!.workspaceId, mustChangePassword: true }));
  });

  app.patch('/api/v1/users/:id', async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ role: roleEnum.optional(), disabled: z.boolean().optional() }).strict().parse(req.body);
    return updateUser(req.auth!.workspaceId, id, b, { id: req.auth!.user.id, role: req.auth!.role });
  });

  app.post('/api/v1/users/:id/reset-password', async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ password: z.string().min(1).max(200) }).strict().parse(req.body);
    const target = await prisma.workspaceMember.findFirst({ where: { userId: id, workspaceId: req.auth!.workspaceId } });
    if (target?.role === 'OWNER' && req.auth!.role !== 'OWNER') throw new WorkflowError('OWNER_REQUIRED', 'Solo un Owner puede restablecer la contraseña de un Owner', 403);
    await resetPassword(id, b.password, req.auth!.user.id);
    return { ok: true, mustChangePassword: true };
  });
}
