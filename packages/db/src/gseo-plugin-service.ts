import { decryptSecret } from '@glitch/core';
import { WordPressError, WordPressSeoClient } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';

/** The G.SEO – SEO WordPress plugin (docs/wordpress/gseo-seo): status, and publishing llms.txt to it. */

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function connection(siteId: string) {
  return prisma.wordPressConnection.findUnique({ where: { siteId } });
}

function clientOf(c: { endpointUrl: string; username: string; appPasswordEnc: string }) {
  return new WordPressSeoClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() });
}

/** What the connected WordPress has: the G.SEO plugin (and its state), the SEO plugin whose fields G.SEO edits, and where redirects go. */
export async function gseoPluginInfo(siteId: string) {
  const c = await connection(siteId);
  if (!c) return { connected: false as const, plugin: null, seoFields: null, redirects: null, error: null };
  const client = clientOf(c);
  try {
    const [plugin, seoFields, redirects] = await Promise.all([client.gseoPluginStatus(), client.activeSeoPlugin(), client.redirectBackend()]);
    return { connected: true as const, plugin, seoFields, redirects, error: null };
  } catch (e) {
    return { connected: true as const, plugin: null, seoFields: null, redirects: null, error: e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message };
  }
}

/** Publishes llms.txt (and optionally llms-full.txt) through the plugin, which serves them at /llms.txt. */
export async function publishLlmsTxt(siteId: string, input: { llms: string; full?: string | null }, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const c = await connection(siteId);
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Conecta WordPress para este sitio primero.', 400);
  const client = clientOf(c);
  if (!(await client.gseoPluginStatus().catch(() => null))) throw new WorkflowError('GSEO_PLUGIN_MISSING', 'Instala el plugin G.SEO – SEO en WordPress (sección WordPress → Descargar plugin) para publicar llms.txt desde aquí.', 400);
  try {
    await client.updateGseoSettings({ llms_txt: input.llms, ...(input.full !== undefined ? { llms_full_txt: input.full ?? '' } : {}) });
  } catch (e) {
    if (e instanceof WordPressError && (e.status === 401 || e.status === 403)) throw new WorkflowError('WP_PERMISSION', 'El usuario de WordPress conectado necesita permiso de administrador para publicar llms.txt.', 403);
    throw new WorkflowError('WORDPRESS_ERROR', (e as Error).message, 502);
  }
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'llms_txt.published', entity: 'Site', entityId: siteId, details: { bytes: input.llms.length, full: !!input.full } });
  return { url: `${new URL(c.endpointUrl).origin}/llms.txt` };
}
