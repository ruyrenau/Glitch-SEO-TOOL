import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { checkPasswordPolicy, hashPassword, publicUser, startSession, ROLE_LABEL } from './auth-service';
import { mailConfigured, sendMail, simpleHtml, webOrigin } from './mailer';

/**
 * Accounts and collaborators: sign-up only with a ticket from the instance administrator (each new account gets
 * its own empty workspace, with the ticket's limits),
 * several workspaces per person, invitations by email with a role, password reset by email, and the
 * instance administrator's view of every workspace.
 */

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const INVITE_TTL_MS = 7 * 86400_000;
const RESET_TTL_MS = 60 * 60_000;
const intEnv = (k: string, d: number | null) => (process.env[k] ? Number(process.env[k]) || null : d);

// ---------------------------------------------------------------- instance settings

const SETTING_DEFAULTS = {
  /** Sign-up with a ticket: on/off (there is no open sign-up). */
  'signup.enabled': 'on',
  /** How many workspaces a regular account can own (the administrator has no limit). */
  'workspaces.perUser': '1'
} as const;
type SettingKey = keyof typeof SETTING_DEFAULTS;
async function getSetting(key: SettingKey) {
  return (await prisma.instanceSetting.findUnique({ where: { key } }))?.value ?? SETTING_DEFAULTS[key];
}
export async function instanceSettings() {
  return { signupEnabled: (await getSetting('signup.enabled')) === 'on', workspacesPerUser: Number(await getSetting('workspaces.perUser')) || 1 };
}
export async function saveInstanceSettings(input: { signupEnabled?: boolean; workspacesPerUser?: number }, actorUserId: string) {
  if (input.signupEnabled !== undefined) await prisma.instanceSetting.upsert({ where: { key: 'signup.enabled' }, create: { key: 'signup.enabled', value: input.signupEnabled ? 'on' : 'off' }, update: { value: input.signupEnabled ? 'on' : 'off' } });
  if (input.workspacesPerUser !== undefined) await prisma.instanceSetting.upsert({ where: { key: 'workspaces.perUser' }, create: { key: 'workspaces.perUser', value: String(input.workspacesPerUser) }, update: { value: String(input.workspacesPerUser) } });
  await recordAuditEvent({ workspaceId: null, userId: actorUserId, action: 'instance.settings_saved', entity: 'Instance', entityId: 'settings', details: input });
  return instanceSettings();
}

export async function authConfig() {
  return { signup: (await instanceSettings()).signupEnabled, email: mailConfigured() };
}

// ---------------------------------------------------------------- sign-up tickets

const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newTicketCode() {
  const b = crypto.randomBytes(12);
  const chars = [...b].map(x => TICKET_ALPHABET[x % TICKET_ALPHABET.length]).join('');
  return `GSEO-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const normCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '');

export async function createSignupTicket(input: { label?: string; maxUses?: number; expiresDays?: number | null; maxSites?: number | null; maxCrawlUrls?: number | null }, actorUserId: string) {
  const code = newTicketCode();
  const t = await prisma.signupTicket.create({
    data: {
      codeHash: sha256(code),
      hint: code.slice(-4),
      label: input.label?.trim().slice(0, 120) || null,
      maxUses: Math.max(1, Math.min(input.maxUses ?? 1, 1000)),
      maxSites: input.maxSites ?? null,
      maxCrawlUrls: input.maxCrawlUrls ?? null,
      expiresAt: input.expiresDays ? new Date(Date.now() + input.expiresDays * 86400_000) : null,
      createdById: actorUserId
    }
  });
  await recordAuditEvent({ workspaceId: null, userId: actorUserId, action: 'ticket.created', entity: 'SignupTicket', entityId: t.id, details: { label: t.label, maxUses: t.maxUses } });
  // The code is shown once; only its hash is stored.
  return { id: t.id, code, url: `${webOrigin()}/signup/${code}`, label: t.label, maxUses: t.maxUses, expiresAt: t.expiresAt };
}

export async function listSignupTickets() {
  const rows = await prisma.signupTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const now = new Date();
  return rows.map(t => ({ id: t.id, hint: t.hint, label: t.label, maxUses: t.maxUses, uses: t.uses, maxSites: t.maxSites, maxCrawlUrls: t.maxCrawlUrls, expiresAt: t.expiresAt, createdAt: t.createdAt, status: t.revokedAt ? 'revoked' : t.expiresAt && t.expiresAt < now ? 'expired' : t.uses >= t.maxUses ? 'used' : 'active' }));
}

export async function revokeSignupTicket(id: string, actorUserId: string) {
  const r = await prisma.signupTicket.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new WorkflowError('TICKET_NOT_FOUND', 'Ese ticket no existe o ya estaba retirado.', 404);
  await recordAuditEvent({ workspaceId: null, userId: actorUserId, action: 'ticket.revoked', entity: 'SignupTicket', entityId: id });
  return { revoked: true };
}

/** Whether a code can be used (for the sign-up page), without spending it. */
export async function checkSignupTicket(code: string) {
  if (!(await instanceSettings()).signupEnabled) return { valid: false, reason: 'El registro está desactivado.' };
  const t = await prisma.signupTicket.findUnique({ where: { codeHash: sha256(normCode(code)) } });
  if (!t || t.revokedAt) return { valid: false, reason: 'El código no existe o fue retirado.' };
  if (t.expiresAt && t.expiresAt < new Date()) return { valid: false, reason: 'El código venció.' };
  if (t.uses >= t.maxUses) return { valid: false, reason: 'El código ya se usó.' };
  return { valid: true, reason: null };
}

/** Spends one use of a ticket (optimistic: fails if someone else used it at the same moment). */
async function consumeTicket(code: string) {
  if (!(await instanceSettings()).signupEnabled) throw new WorkflowError('SIGNUP_CLOSED', 'El registro está desactivado.', 403);
  const t = await prisma.signupTicket.findUnique({ where: { codeHash: sha256(normCode(code)) } });
  if (!t || t.revokedAt || (t.expiresAt && t.expiresAt < new Date()) || t.uses >= t.maxUses) throw new WorkflowError('INVALID_TICKET', 'El código de registro no es válido, venció o ya se usó. Pide uno nuevo al administrador.', 403);
  const r = await prisma.signupTicket.updateMany({ where: { id: t.id, uses: t.uses }, data: { uses: { increment: 1 } } });
  if (!r.count) throw new WorkflowError('INVALID_TICKET', 'El código acaba de usarse. Pide uno nuevo al administrador.', 409);
  return t;
}

async function uniqueSlug(name: string) {
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'espacio';
  let slug = base;
  for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

/** Whether the person can create another workspace (regular accounts own as many as the administrator allows). */
export async function canCreateWorkspace(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isSuperAdmin) return true;
  return (await prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } })) < (await instanceSettings()).workspacesPerUser;
}

/** A new workspace owned by the user, with the given limits or the defaults for regular accounts. */
export async function createWorkspaceFor(userId: string, name: string, limits?: { maxSites: number | null; maxCrawlUrls: number | null }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await canCreateWorkspace(userId))) throw new WorkflowError('WORKSPACE_LIMIT', 'Tu cuenta no puede crear más espacios de trabajo. Pide al administrador que suba el límite.', 403);
  const ws = await prisma.workspace.create({
    data: {
      name: name.trim().slice(0, 80) || 'Mi espacio',
      slug: await uniqueSlug(name),
      maxSites: user.isSuperAdmin ? null : limits ? limits.maxSites : intEnv('SIGNUP_MAX_SITES', 5),
      maxCrawlUrls: user.isSuperAdmin ? null : limits ? limits.maxCrawlUrls : intEnv('SIGNUP_MAX_CRAWL_URLS', 10_000),
      members: { create: { userId, role: 'OWNER' } }
    }
  });
  await recordAuditEvent({ workspaceId: ws.id, userId, action: 'workspace.created', entity: 'Workspace', entityId: ws.id, details: { name: ws.name } });
  return ws;
}

export async function register(input: { ticket: string; username: string; name: string; email: string; password: string; workspaceName?: string }, meta: { ip?: string; userAgent?: string } = {}) {
  if (!(await instanceSettings()).signupEnabled) throw new WorkflowError('SIGNUP_CLOSED', 'El registro está desactivado.', 403);
  if (!(await checkSignupTicket(input.ticket)).valid) throw new WorkflowError('INVALID_TICKET', 'El código de registro no es válido, venció o ya se usó. Pide uno nuevo al administrador.', 403);
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new WorkflowError('INVALID_USERNAME', 'El usuario debe tener 3-40 caracteres: letras, números, punto, guion o guion bajo.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkflowError('INVALID_EMAIL', 'Escribe un correo válido.', 400);
  const policy = checkPasswordPolicy(input.password);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (await prisma.user.findUnique({ where: { username } })) throw new WorkflowError('USERNAME_TAKEN', `El usuario "${username}" ya existe.`, 409);
  if (await prisma.user.findUnique({ where: { email } })) throw new WorkflowError('EMAIL_TAKEN', 'Ya hay una cuenta con ese correo. Inicia sesión o recupera tu contraseña.', 409);
  // The ticket is spent only once everything else is valid.
  const ticket = await consumeTicket(input.ticket);
  const user = await prisma.user.create({ data: { username, email, name: input.name.trim().slice(0, 100) || username, passwordHash: await hashPassword(input.password) } });
  const ws = await createWorkspaceFor(user.id, input.workspaceName?.trim() || `Espacio de ${user.name}`, ticket.maxSites !== null || ticket.maxCrawlUrls !== null ? { maxSites: ticket.maxSites ?? intEnv('SIGNUP_MAX_SITES', 5), maxCrawlUrls: ticket.maxCrawlUrls ?? intEnv('SIGNUP_MAX_CRAWL_URLS', 10_000) } : undefined);
  await recordAuditEvent({ workspaceId: ws.id, userId: user.id, action: 'user.registered', entity: 'User', entityId: user.id, details: { username, ticket: ticket.hint } });
  return startSession(user.id, ws.id, meta);
}

// ---------------------------------------------------------------- workspaces of a person

export async function myWorkspaces(userId: string) {
  const ms = await prisma.workspaceMember.findMany({ where: { userId, workspace: { disabled: false } }, include: { workspace: { include: { _count: { select: { sites: true, members: true } } } } }, orderBy: { createdAt: 'asc' } });
  // (canCreateWorkspace tells the UI whether to offer "+ Nuevo espacio")
  return ms.map(m => ({ id: m.workspaceId, name: m.workspace.name, role: m.role, roleLabel: ROLE_LABEL[m.role], sites: m.workspace._count.sites, members: m.workspace._count.members, maxSites: m.workspace.maxSites, maxCrawlUrls: m.workspace.maxCrawlUrls }));
}

export async function switchWorkspace(sessionId: string, userId: string, workspaceId: string) {
  const m = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { workspace: true } });
  if (!m || m.workspace.disabled) throw new WorkflowError('NOT_A_MEMBER', 'No perteneces a ese espacio de trabajo.', 404);
  await prisma.session.update({ where: { id: sessionId }, data: { workspaceId } });
  return { workspaceId, role: m.role };
}

export async function renameWorkspace(workspaceId: string, name: string, actorUserId: string) {
  const ws = await prisma.workspace.update({ where: { id: workspaceId }, data: { name: name.trim().slice(0, 80) } });
  await recordAuditEvent({ workspaceId, userId: actorUserId, action: 'workspace.renamed', entity: 'Workspace', entityId: workspaceId, details: { name: ws.name } });
  return { id: ws.id, name: ws.name };
}

/** Removes someone from this workspace only (their account and other workspaces stay). */
export async function removeMember(workspaceId: string, userId: string, actor: { id: string; role: Role }) {
  const m = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!m) throw new WorkflowError('USER_NOT_FOUND', 'Esa persona no está en este espacio.', 404);
  if (m.role === 'OWNER' && actor.role !== 'OWNER') throw new WorkflowError('OWNER_REQUIRED', 'Solo un Owner puede quitar a otro Owner.', 403);
  if (m.role === 'OWNER' && (await prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER', user: { disabled: false } } })) <= 1) throw new WorkflowError('LAST_OWNER', 'El espacio necesita al menos un Owner.', 400);
  await prisma.workspaceMember.delete({ where: { id: m.id } });
  await prisma.session.updateMany({ where: { userId, workspaceId }, data: { workspaceId: null } });
  await recordAuditEvent({ workspaceId, userId: actor.id, action: userId === actor.id ? 'member.left' : 'member.removed', entity: 'User', entityId: userId });
  return { removed: true };
}

// ---------------------------------------------------------------- invitations

export async function createInvitation(workspaceId: string, input: { email: string; role: Role }, actor: { id: string; role: Role; name: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkflowError('INVALID_EMAIL', 'Escribe un correo válido.', 400);
  if (input.role === 'OWNER' && actor.role !== 'OWNER') throw new WorkflowError('OWNER_REQUIRED', 'Solo un Owner puede invitar a otro Owner.', 403);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: existing.id } } }))) throw new WorkflowError('ALREADY_MEMBER', 'Esa persona ya está en este espacio.', 409);
  await prisma.invitation.updateMany({ where: { workspaceId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = crypto.randomBytes(32).toString('base64url');
  const inv = await prisma.invitation.create({ data: { workspaceId, email, role: input.role, tokenHash: sha256(token), invitedById: actor.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const url = `${webOrigin()}/invite/${token}`;
  const mail = await sendMail(
    email,
    `${actor.name} te invitó a ${ws.name} en G.SEO`,
    `${actor.name} te invitó a colaborar en "${ws.name}" en G.SEO como ${ROLE_LABEL[input.role]}.\n\nAcepta la invitación (válida 7 días): ${url}\n`,
    simpleHtml(`Te invitaron a ${ws.name}`, [`${actor.name} te invitó a colaborar en "${ws.name}" en G.SEO como ${ROLE_LABEL[input.role]}.`, 'La invitación vence en 7 días.'], { label: 'Aceptar invitación', url })
  ).catch(e => ({ sent: false, error: (e as Error).message }));
  await recordAuditEvent({ workspaceId, userId: actor.id, action: 'invitation.created', entity: 'Invitation', entityId: inv.id, details: { email, role: input.role, emailed: mail.sent } });
  // Without email the person who invites gets the link to share it by other means.
  return { id: inv.id, email, role: inv.role, expiresAt: inv.expiresAt, emailed: mail.sent, emailError: 'error' in mail ? mail.error : null, acceptUrl: mail.sent ? null : url };
}

export async function listInvitations(workspaceId: string) {
  const rows = await prisma.invitation.findMany({ where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  return rows.map(i => ({ id: i.id, email: i.email, role: i.role, roleLabel: ROLE_LABEL[i.role], expiresAt: i.expiresAt, createdAt: i.createdAt }));
}

export async function revokeInvitation(workspaceId: string, id: string, actorUserId: string) {
  const r = await prisma.invitation.updateMany({ where: { id, workspaceId, acceptedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new WorkflowError('INVITATION_NOT_FOUND', 'Esa invitación no existe.', 404);
  await recordAuditEvent({ workspaceId, userId: actorUserId, action: 'invitation.revoked', entity: 'Invitation', entityId: id });
  return { revoked: true };
}

async function liveInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date() || inv.workspace.disabled) throw new WorkflowError('INVITATION_NOT_AVAILABLE', 'La invitación no existe, ya se usó, se retiró o venció. Pide una nueva.', 404);
  return inv;
}

/** What the invitation page shows before accepting. */
export async function invitationInfo(token: string) {
  const inv = await liveInvitation(token);
  const inviter = inv.invitedById ? await prisma.user.findUnique({ where: { id: inv.invitedById }, select: { name: true } }) : null;
  const account = await prisma.user.findUnique({ where: { email: inv.email }, select: { username: true } });
  return { workspace: inv.workspace.name, email: inv.email, role: inv.role, roleLabel: ROLE_LABEL[inv.role], inviter: inviter?.name ?? null, expiresAt: inv.expiresAt, hasAccount: !!account };
}

/** Accepts with a new account (username + password) and signs in. */
export async function acceptInvitationNew(token: string, input: { username: string; name: string; password: string }, meta: { ip?: string; userAgent?: string } = {}) {
  const inv = await liveInvitation(token);
  if (await prisma.user.findUnique({ where: { email: inv.email } })) throw new WorkflowError('ACCOUNT_EXISTS', 'Ya hay una cuenta con ese correo: inicia sesión para aceptar la invitación.', 409);
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new WorkflowError('INVALID_USERNAME', 'El usuario debe tener 3-40 caracteres: letras, números, punto, guion o guion bajo.', 400);
  const policy = checkPasswordPolicy(input.password);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (await prisma.user.findUnique({ where: { username } })) throw new WorkflowError('USERNAME_TAKEN', `El usuario "${username}" ya existe.`, 409);
  const user = await prisma.user.create({ data: { username, email: inv.email, name: input.name.trim().slice(0, 100) || username, passwordHash: await hashPassword(input.password), memberships: { create: { workspaceId: inv.workspaceId, role: inv.role } } } });
  await prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedBy: user.id } });
  await recordAuditEvent({ workspaceId: inv.workspaceId, userId: user.id, action: 'invitation.accepted', entity: 'Invitation', entityId: inv.id, details: { newAccount: true } });
  return startSession(user.id, inv.workspaceId, meta);
}

/** Accepts with the account already signed in (its email must match the invitation). */
export async function acceptInvitationExisting(token: string, userId: string, sessionId: string) {
  const inv = await liveInvitation(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if ((user.email ?? '').toLowerCase() !== inv.email) throw new WorkflowError('WRONG_ACCOUNT', `Esta invitación es para ${inv.email}. Entra con esa cuenta (o agrega ese correo a tu cuenta en "Mi cuenta").`, 403);
  await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } }, create: { workspaceId: inv.workspaceId, userId, role: inv.role }, update: {} });
  await prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedBy: userId } });
  await prisma.session.update({ where: { id: sessionId }, data: { workspaceId: inv.workspaceId } });
  await recordAuditEvent({ workspaceId: inv.workspaceId, userId, action: 'invitation.accepted', entity: 'Invitation', entityId: inv.id, details: { newAccount: false } });
  return { workspaceId: inv.workspaceId };
}

// ---------------------------------------------------------------- password reset

/** Always answers the same (no hint about which emails exist). */
export async function requestPasswordReset(identifier: string) {
  if (!mailConfigured()) throw new WorkflowError('EMAIL_NOT_CONFIGURED', 'La recuperación por correo no está configurada en este servidor. Pide a un administrador que restablezca tu contraseña.', 400);
  const id = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { OR: [{ email: id }, { username: id }], disabled: false } });
  if (user?.email) {
    await prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } });
    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    const url = `${webOrigin()}/reset/${token}`;
    await sendMail(user.email, 'Restablece tu contraseña de G.SEO', `Para elegir una nueva contraseña entra aquí (válido 1 hora): ${url}\nSi no lo pediste, ignora este correo.`, simpleHtml('Restablece tu contraseña', ['Para elegir una nueva contraseña usa el botón (válido 1 hora).', 'Si no lo pediste, ignora este correo.'], { label: 'Elegir contraseña', url })).catch(() => undefined);
    await recordAuditEvent({ workspaceId: null, userId: user.id, action: 'user.password_reset_requested', entity: 'User', entityId: user.id });
  }
  return { ok: true };
}

export async function resetPasswordWithToken(token: string, password: string) {
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!r || r.usedAt || r.expiresAt < new Date() || r.user.disabled) throw new WorkflowError('RESET_NOT_AVAILABLE', 'El enlace no es válido o ya venció. Pide uno nuevo.', 400);
  const policy = checkPasswordPolicy(password);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (await bcrypt.compare(password, r.user.passwordHash)) throw new WorkflowError('SAME_PASSWORD', 'Elige una contraseña distinta de la anterior.', 400);
  await prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
  await prisma.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId: r.userId } });
  await recordAuditEvent({ workspaceId: null, userId: r.userId, action: 'user.password_reset_by_email', entity: 'User', entityId: r.userId });
  return { ok: true };
}

export async function updateOwnProfile(userId: string, input: { name?: string; email?: string | null }) {
  const data: { name?: string; email?: string | null } = {};
  if (input.name !== undefined) data.name = input.name.trim().slice(0, 100);
  if (input.email !== undefined) {
    const email = input.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkflowError('INVALID_EMAIL', 'Escribe un correo válido.', 400);
    if (email && (await prisma.user.findFirst({ where: { email, NOT: { id: userId } } }))) throw new WorkflowError('EMAIL_TAKEN', 'Ese correo ya lo usa otra cuenta.', 409);
    data.email = email;
  }
  const u = await prisma.user.update({ where: { id: userId }, data });
  return { name: u.name, email: u.email };
}

// ---------------------------------------------------------------- instance administrator

/** Makes sure an active instance administrator exists (the first active Owner), e.g. after an install. */
export async function ensureSuperAdmin() {
  if (await prisma.user.count({ where: { isSuperAdmin: true, disabled: false } })) return;
  const m = await prisma.workspaceMember.findFirst({ where: { role: 'OWNER', user: { disabled: false } }, orderBy: { createdAt: 'asc' } });
  if (m) await prisma.user.update({ where: { id: m.userId }, data: { isSuperAdmin: true } });
}

/** Every account of the instance: where it works and when it last signed in. */
export async function adminUsers() {
  const users = await prisma.user.findMany({ include: { memberships: { include: { workspace: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' } });
  return users.map(u => ({ id: u.id, username: u.username, name: u.name, email: u.email, isSuperAdmin: u.isSuperAdmin, disabled: u.disabled, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, workspaces: u.memberships.map(m => ({ name: m.workspace.name, role: m.role, roleLabel: ROLE_LABEL[m.role] })) }));
}

export async function adminSetUserDisabled(userId: string, disabled: boolean, actorUserId: string) {
  if (userId === actorUserId) throw new WorkflowError('CANNOT_CHANGE_SELF', 'No puedes desactivar tu propia cuenta.', 400);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.isSuperAdmin) throw new WorkflowError('SUPERADMIN_PROTECTED', 'No se puede desactivar a un administrador de la instancia.', 403);
  await prisma.user.update({ where: { id: userId }, data: { disabled } });
  if (disabled) await prisma.session.deleteMany({ where: { userId } });
  await recordAuditEvent({ workspaceId: null, userId: actorUserId, action: disabled ? 'user.disabled_by_admin' : 'user.enabled_by_admin', entity: 'User', entityId: userId });
  return { id: userId, disabled };
}

export async function adminWorkspaces() {
  const ws = await prisma.workspace.findMany({ include: { _count: { select: { sites: true, members: true } }, members: { where: { role: 'OWNER' }, include: { user: { select: { username: true, email: true } } } } }, orderBy: { createdAt: 'asc' } });
  return ws.map(w => ({ id: w.id, name: w.name, createdAt: w.createdAt, disabled: w.disabled, maxSites: w.maxSites, maxCrawlUrls: w.maxCrawlUrls, sites: w._count.sites, members: w._count.members, owners: w.members.map(m => m.user.email ?? m.user.username) }));
}

export async function adminUpdateWorkspace(id: string, change: { maxSites?: number | null; maxCrawlUrls?: number | null; disabled?: boolean }, actorUserId: string) {
  const ws = await prisma.workspace.update({ where: { id }, data: change });
  if (change.disabled) await prisma.session.updateMany({ where: { workspaceId: id }, data: { workspaceId: null } });
  await recordAuditEvent({ workspaceId: id, userId: actorUserId, action: 'workspace.admin_updated', entity: 'Workspace', entityId: id, details: change });
  return { id: ws.id, maxSites: ws.maxSites, maxCrawlUrls: ws.maxCrawlUrls, disabled: ws.disabled };
}

/** Limits of a workspace, checked when adding a site and when starting a crawl. */
export async function workspaceLimits(workspaceId: string) {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, include: { _count: { select: { sites: true } } } });
  return { maxSites: ws.maxSites, maxCrawlUrls: ws.maxCrawlUrls, sites: ws._count.sites };
}

