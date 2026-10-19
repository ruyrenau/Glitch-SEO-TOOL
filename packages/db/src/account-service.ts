import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { checkPasswordPolicy, hashPassword, publicUser, startSession, ROLE_LABEL } from './auth-service';
import { mailConfigured, sendMail, simpleHtml, webOrigin } from './mailer';

/**
 * Accounts and collaborators: self sign-up (each new account gets its own empty workspace, with limits),
 * several workspaces per person, invitations by email with a role, password reset by email, and the
 * instance administrator's view of every workspace.
 */

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const INVITE_TTL_MS = 7 * 86400_000;
const RESET_TTL_MS = 60 * 60_000;
const intEnv = (k: string, d: number | null) => (process.env[k] ? Number(process.env[k]) || null : d);

export function signupMode(): 'open' | 'closed' {
  return process.env.SIGNUP === 'closed' ? 'closed' : 'open';
}
export function authConfig() {
  return { signup: signupMode() === 'open', email: mailConfigured() };
}

async function uniqueSlug(name: string) {
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'espacio';
  let slug = base;
  for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

/** A new workspace owned by the user, with the default limits for self-service accounts. */
export async function createWorkspaceFor(userId: string, name: string) {
  const owned = await prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } });
  const maxOwned = intEnv('MAX_WORKSPACES_PER_USER', 5);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.isSuperAdmin && maxOwned !== null && owned >= maxOwned) throw new WorkflowError('WORKSPACE_LIMIT', `Puedes ser dueño de hasta ${maxOwned} espacios de trabajo.`, 400);
  const ws = await prisma.workspace.create({
    data: {
      name: name.trim().slice(0, 80) || 'Mi espacio',
      slug: await uniqueSlug(name),
      maxSites: user.isSuperAdmin ? null : intEnv('SIGNUP_MAX_SITES', 5),
      maxCrawlUrls: user.isSuperAdmin ? null : intEnv('SIGNUP_MAX_CRAWL_URLS', 10_000),
      members: { create: { userId, role: 'OWNER' } }
    }
  });
  await recordAuditEvent({ workspaceId: ws.id, userId, action: 'workspace.created', entity: 'Workspace', entityId: ws.id, details: { name: ws.name } });
  return ws;
}

export async function register(input: { username: string; name: string; email: string; password: string; workspaceName?: string }, meta: { ip?: string; userAgent?: string } = {}) {
  if (signupMode() !== 'open') throw new WorkflowError('SIGNUP_CLOSED', 'El registro está cerrado: pide una invitación.', 403);
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new WorkflowError('INVALID_USERNAME', 'El usuario debe tener 3-40 caracteres: letras, números, punto, guion o guion bajo.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkflowError('INVALID_EMAIL', 'Escribe un correo válido.', 400);
  const policy = checkPasswordPolicy(input.password);
  if (policy) throw new WorkflowError('WEAK_PASSWORD', policy, 400);
  if (await prisma.user.findUnique({ where: { username } })) throw new WorkflowError('USERNAME_TAKEN', `El usuario "${username}" ya existe.`, 409);
  if (await prisma.user.findUnique({ where: { email } })) throw new WorkflowError('EMAIL_TAKEN', 'Ya hay una cuenta con ese correo. Inicia sesión o recupera tu contraseña.', 409);
  const user = await prisma.user.create({ data: { username, email, name: input.name.trim().slice(0, 100) || username, passwordHash: await hashPassword(input.password) } });
  const ws = await createWorkspaceFor(user.id, input.workspaceName?.trim() || `Espacio de ${user.name}`);
  await recordAuditEvent({ workspaceId: ws.id, userId: user.id, action: 'user.registered', entity: 'User', entityId: user.id, details: { username } });
  return startSession(user.id, ws.id, meta);
}

// ---------------------------------------------------------------- workspaces of a person

export async function myWorkspaces(userId: string) {
  const ms = await prisma.workspaceMember.findMany({ where: { userId, workspace: { disabled: false } }, include: { workspace: { include: { _count: { select: { sites: true, members: true } } } } }, orderBy: { createdAt: 'asc' } });
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

