import crypto from 'crypto';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { can } from './auth-service';
import { saveConnection, testConnection } from './wordpress-service';

/**
 * One-click WordPress connection through WordPress's own "Authorize Application" screen
 * (wp-admin/authorize-application.php). The person approves G.SEO in WordPress, and WordPress sends the new
 * application password to our callback. A signed, short-lived, single-use state ties the answer to the user
 * and the site that started it, and to the WordPress host it was sent to.
 */

/** Stable id for G.SEO in WordPress's application password list. */
export const GSEO_WP_APP_ID = '6f1d3c2a-8b4e-4f5a-9c7d-2e1b0a9f8c3d';

const key = () => crypto.createHash('sha256').update(`wp-connect:${process.env.CREDENTIALS_KEY ?? process.env.SALT_SECRET ?? 'glitch-dev'}`).digest();
const used = new Map<string, number>(); // nonce → expiry: each approval can be used once

type State = { s: string; u: string; h: string; exp: number; n: string };

function sign(p: Omit<State, 'exp' | 'n'>) {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 15 * 60_000, n: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key()).update(body).digest('base64url')}`;
}

function read(state: string): State {
  const [body, mac] = state.split('.');
  const want = body ? crypto.createHmac('sha256', key()).update(body).digest('base64url') : '';
  if (!body || !mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new WorkflowError('WP_BAD_STATE', 'La respuesta de WordPress no es válida. Vuelve a intentar la conexión.', 400);
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as State;
  if (Date.now() > p.exp) throw new WorkflowError('WP_STATE_EXPIRED', 'La conexión tardó demasiado. Vuelve a intentarlo.', 400);
  const now = Date.now();
  for (const [n, exp] of used) if (exp < now) used.delete(n);
  if (used.has(p.n)) throw new WorkflowError('WP_STATE_USED', 'Esta autorización ya se usó. Vuelve a intentar la conexión.', 400);
  used.set(p.n, p.exp);
  return p;
}

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, '').toLowerCase();

/** Where to send the browser: WordPress's approval screen for the site's WordPress. */
export async function wpConnectAuthorizeUrl(siteId: string, userId: string, wpUrl: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const wp = new URL(wpUrl);
  if (!/^https?:$/.test(wp.protocol)) throw new WorkflowError('BAD_URL', 'La dirección de WordPress debe empezar con https://', 400);
  const api = (process.env.API_PUBLIC_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const web = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
  const state = sign({ s: site.id, u: userId, h: hostOf(wp.origin) });
  const base = `${wp.origin}${wp.pathname.replace(/\/+$/, '')}`;
  const q = new URLSearchParams({
    app_name: 'G.SEO',
    app_id: GSEO_WP_APP_ID,
    success_url: `${api}/api/v1/wordpress/connect/callback?state=${encodeURIComponent(state)}`,
    reject_url: `${web}/?${new URLSearchParams({ nav: 'wordpress', wp: 'rejected' })}`
  });
  return `${base}/wp-admin/authorize-application.php?${q}`;
}

/** WordPress's answer: saves the connection and tests it. Returns the site id for the redirect. */
export async function wpConnectFinish(input: { state: string; siteUrl?: string; userLogin?: string; password?: string }) {
  const st = read(input.state);
  if (!input.siteUrl || !input.userLogin || !input.password) throw new WorkflowError('WP_REJECTED', 'WordPress no envió la autorización (¿la rechazaste?).', 400);
  if (hostOf(input.siteUrl) !== st.h) throw new WorkflowError('WP_HOST_MISMATCH', `La autorización llegó de ${hostOf(input.siteUrl)}, pero se pidió a ${st.h}.`, 400);
  const site = await prisma.site.findUnique({ where: { id: st.s } });
  if (!site) throw new WorkflowError('SITE_NOT_FOUND', 'El sitio ya no existe en G.SEO.', 404);
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: site.workspaceId, userId: st.u } }, include: { user: { select: { disabled: true } } } });
  if (!member || member.user.disabled || !can(member.role, 'site:manage')) throw new WorkflowError('WP_BAD_STATE', 'Tu usuario ya no puede conectar WordPress en este espacio.', 403);
  await saveConnection(site.id, { endpointUrl: input.siteUrl, username: input.userLogin, appPassword: input.password }, st.u);
  const test = await testConnection(site.id);
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: st.u, action: 'wordpress.connected_one_click', entity: 'Site', entityId: site.id, details: { endpointUrl: input.siteUrl, username: input.userLogin, ok: test.ok } });
  if (!test.ok) throw new WorkflowError('WP_TEST_FAILED', `WordPress autorizó a G.SEO, pero la prueba falló: ${test.error}`, 400);
  return { siteId: site.id };
}
