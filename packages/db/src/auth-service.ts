import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';

export const SESSION_TTL_MS = 12 * 3600_000; // sliding: extended on use, max 12 h idle
const BCRYPT_COST = 12;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
// Compared against when the user does not exist, so timing does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export type Permission =
  | 'read' // see everything in the workspace
  | 'content:edit' // datasets, templates, generate, review pages
  | 'wordpress:send' // dry runs, send/restore drafts
  | 'seo:operate' // import logs/sitemaps, run crawls, triage issues and alerts
  | 'site:manage' // sites, WordPress credentials, permanent deletions
  | 'users:manage';

const GRANTS: Record<Role, Permission[]> = {
  VIEWER: ['read'],
  EDITOR: ['read', 'content:edit', 'wordpress:send'],
  SEO_MANAGER: ['read', 'content:edit', 'wordpress:send', 'seo:operate'],
  ADMIN: ['read', 'content:edit', 'wordpress:send', 'seo:operate', 'site:manage', 'users:manage'],
  OWNER: ['read', 'content:edit', 'wordpress:send', 'seo:operate', 'site:manage', 'users:manage']
};
export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', SEO_MANAGER: 'SEO Manager', EDITOR: 'Editor', VIEWER: 'Viewer' };
export const can = (role: Role, p: Permission) => GRANTS[role].includes(p);
export const permissionsOf = (role: Role) => GRANTS[role];

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/** Minimum policy: 10+ characters, not only letters or only digits. */
export function checkPasswordPolicy(pw: string): string | null {
  if (pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  if (/^[a-zA-Z]+$/.test(pw) || /^\d+$/.test(pw)) return 'Usa letras y al menos un número o símbolo.';
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  username: string;
  name: string;
  password: string;
  role: Role;
  email?: string | null;
  mustChangePassword?: boolean;
  workspaceId?: string;
}

async function defaultWorkspaceId() {
  const ws = (await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } })) ?? (await prisma.workspace.create({ data: { name: 'Default Workspace', slug: 'default' } }));
  return ws.id;
}

export async function createUser(input: CreateUserInput, actorUserId?: string | null) {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new WorkflowError('INVALID_USERNAME', 'El usuario debe tener 3-40 caracteres: letras, números, punto, guion o guion bajo.', 400);
  const policy = checkPasswordPolicy(input.password);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (await prisma.user.findUnique({ where: { username } })) throw new WorkflowError('USERNAME_TAKEN', `El usuario "${username}" ya existe.`, 409);
  const workspaceId = input.workspaceId ?? (await defaultWorkspaceId());
  const user = await prisma.user.create({
    data: {
      username,
      name: input.name.trim(),
      email: input.email || null,
      passwordHash: await hashPassword(input.password),
      mustChangePassword: input.mustChangePassword ?? false,
      memberships: { create: { workspaceId, role: input.role } }
    }
  });
  await recordAuditEvent({ workspaceId, userId: actorUserId ?? null, action: 'user.created', entity: 'User', entityId: user.id, details: { username, role: input.role } });
  return publicUser(user, input.role);
}

export function publicUser(u: { id: string; username: string; name: string; email: string | null; mustChangePassword: boolean; disabled?: boolean; lastLoginAt?: Date | null }, role: Role) {
  return { id: u.id, username: u.username, name: u.name, email: u.email, role, roleLabel: ROLE_LABEL[role], mustChangePassword: u.mustChangePassword, disabled: !!u.disabled, lastLoginAt: u.lastLoginAt ?? null, permissions: permissionsOf(role) };
}

export async function listUsers(workspaceId: string) {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  return members.map(m => publicUser(m.user, m.role));
}

async function ownerCount(workspaceId: string) {
  return prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER', user: { disabled: false } } });
}

export async function updateUser(workspaceId: string, userId: string, change: { role?: Role; disabled?: boolean }, actor: { id: string; role: Role }) {
  const m = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { user: true } });
  if (!m) throw new WorkflowError('USER_NOT_FOUND', 'Usuario no encontrado en este workspace.', 404);
  if (userId === actor.id && (change.disabled || (change.role && change.role !== m.role))) throw new WorkflowError('CANNOT_CHANGE_SELF', 'No puedes cambiar tu propio rol ni desactivarte.', 400);
  // Only owners can create or modify owners.
  if ((m.role === 'OWNER' || change.role === 'OWNER') && actor.role !== 'OWNER') throw new WorkflowError('OWNER_REQUIRED', 'Solo un Owner puede modificar a otro Owner.', 403);
  if (m.role === 'OWNER' && (change.disabled || (change.role && change.role !== 'OWNER')) && (await ownerCount(workspaceId)) <= 1) throw new WorkflowError('LAST_OWNER', 'El workspace necesita al menos un Owner activo.', 400);
  if (change.role) await prisma.workspaceMember.update({ where: { id: m.id }, data: { role: change.role } });
  if (change.disabled !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { disabled: change.disabled } });
    if (change.disabled) await prisma.session.deleteMany({ where: { userId } });
  }
  await recordAuditEvent({ workspaceId, userId: actor.id, action: 'user.updated', entity: 'User', entityId: userId, details: { ...change } });
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return publicUser(fresh, change.role ?? m.role);
}

/** Admin reset: sets a temporary password, forces a change at next login and ends the user's sessions. */
export async function resetPassword(userId: string, newPassword: string, actorUserId: string | null, opts: { mustChange?: boolean } = {}) {
  const policy = checkPasswordPolicy(newPassword);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: opts.mustChange ?? true } });
  await prisma.session.deleteMany({ where: { userId } });
  await recordAuditEvent({ workspaceId: null, userId: actorUserId, action: 'user.password_reset', entity: 'User', entityId: user.id });
  return user;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionContext {
  sessionId: string;
  user: ReturnType<typeof publicUser>;
  workspaceId: string;
  role: Role;
}

/** Verifies credentials. Returns null on any failure (unknown user, wrong password, disabled). */
export async function login(usernameRaw: string, password: string, meta: { ip?: string; userAgent?: string } = {}) {
  const username = usernameRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username }, include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const member = user?.memberships[0];
  if (!user || !ok || user.disabled || !member) {
    await recordAuditEvent({ workspaceId: member?.workspaceId ?? null, userId: user?.id ?? null, action: 'auth.login_failed', entity: 'User', entityId: user?.id ?? username, details: { username, reason: !user ? 'unknown_user' : user.disabled ? 'disabled' : !member ? 'no_workspace' : 'bad_password' } });
    return null;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipHash: meta.ip ? sha256(`${process.env.SALT_SECRET ?? 'dev'}:${meta.ip}`).slice(0, 16) : null,
      userAgent: meta.userAgent?.slice(0, 200) ?? null
    }
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAuditEvent({ workspaceId: member.workspaceId, userId: user.id, action: 'auth.login', entity: 'Session', entityId: session.id });
  return { token, user: publicUser(user, member.role), workspaceId: member.workspaceId };
}

/** Resolves a session cookie. Expired or disabled sessions are deleted. Extends the expiry when it is used. */
export async function getSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token || token.length > 100) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } } } });
  if (!s) return null;
  const member = s.user.memberships[0];
  if (s.expiresAt.getTime() < Date.now() || s.user.disabled || !member) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
    return null;
  }
  // Slide the expiry at most once a minute to avoid a write per request.
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  }
  return { sessionId: s.id, user: publicUser(s.user, member.role), workspaceId: member.workspaceId, role: member.role };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s) return;
  await prisma.session.delete({ where: { id: s.id } });
  await recordAuditEvent({ workspaceId: null, userId: s.userId, action: 'auth.logout', entity: 'Session', entityId: s.id });
}

/** Changes the caller's password, keeps the current session and ends all the others. */
export async function changeOwnPassword(userId: string, currentSessionId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw new WorkflowError('WRONG_PASSWORD', 'La contraseña actual no es correcta.', 400);
  const policy = checkPasswordPolicy(next);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (current === next) throw new WorkflowError('SAME_PASSWORD', 'La nueva contraseña debe ser distinta de la actual.', 400);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await prisma.session.deleteMany({ where: { userId, NOT: { id: currentSessionId } } });
  await recordAuditEvent({ workspaceId: null, userId, action: 'user.password_changed', entity: 'User', entityId: userId });
}

export async function purgeExpiredSessions() {
  return (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
}
