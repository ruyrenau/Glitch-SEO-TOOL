import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { encryptSecret, decryptSecret, maskSecret } from '@glitch/core';
import { WordPressClient, WordPressError, htmlToLines, lineDiff, DraftInput, WpPost } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';

export { WorkflowError };

const json = (v: unknown) => v as Prisma.InputJsonValue;
const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export function publicConnection(c: { id: string; siteId: string; endpointUrl: string; username: string; appPasswordEnc: string; status: string; remoteName: string | null; lastTestAt: Date | null; lastError: string | null }) {
  let masked = '••••';
  try {
    masked = maskSecret(decryptSecret(c.appPasswordEnc));
  } catch {
    /* key rotated or invalid */
  }
  return { id: c.id, siteId: c.siteId, endpointUrl: c.endpointUrl, username: c.username, appPassword: masked, status: c.status, remoteName: c.remoteName, lastTestAt: c.lastTestAt, lastError: c.lastError };
}

export async function getConnection(siteId: string) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  return c ? publicConnection(c) : null;
}

export async function saveConnection(siteId: string, input: { endpointUrl: string; username: string; appPassword?: string }, actorUserId?: string | null) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new WorkflowError('SITE_NOT_FOUND', `Site ${siteId} not found`, 404);
  // Validate URL rules (HTTPS unless allowlisted) before storing anything.
  new WordPressClient({ baseUrl: input.endpointUrl, username: input.username, appPassword: input.appPassword ?? 'x', allowHosts: allowHosts() });
  const existing = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!existing && !input.appPassword) throw new WorkflowError('APP_PASSWORD_REQUIRED', 'An Application Password is required', 400);
  const data = {
    endpointUrl: input.endpointUrl.replace(/\/+$/, ''),
    username: input.username,
    ...(input.appPassword ? { appPasswordEnc: encryptSecret(input.appPassword) } : {}),
    status: 'untested',
    lastError: null
  };
  const c = existing
    ? await prisma.wordPressConnection.update({ where: { siteId }, data })
    : await prisma.wordPressConnection.create({ data: { ...data, siteId, appPasswordEnc: data.appPasswordEnc! } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId ?? null, action: existing ? 'wordpress.connection_updated' : 'wordpress.connection_created', entity: 'WordPressConnection', entityId: c.id, details: { endpointUrl: c.endpointUrl, username: c.username, passwordChanged: !!input.appPassword } });
  return publicConnection(c);
}

export async function deleteConnection(siteId: string, actorUserId?: string | null) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId }, include: { site: true } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'This site has no WordPress connection', 404);
  await prisma.wordPressConnection.delete({ where: { siteId } });
  await recordAuditEvent({ workspaceId: c.site.workspaceId, userId: actorUserId ?? null, action: 'wordpress.connection_deleted', entity: 'WordPressConnection', entityId: c.id });
}

async function clientFor(siteId: string) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Connect WordPress for this site first', 400);
  return { conn: c, client: new WordPressClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() }) };
}

export async function testConnection(siteId: string) {
  const { conn, client } = await clientFor(siteId);
  try {
    const r = await client.testConnection();
    if (!r.canEditPosts) throw new WordPressError(403, 'CANNOT_EDIT_POSTS', `User "${r.user}" cannot edit posts`);
    const updated = await prisma.wordPressConnection.update({ where: { id: conn.id }, data: { status: 'ok', remoteName: r.siteName, lastTestAt: new Date(), lastError: null } });
    return { ok: true as const, ...r, connection: publicConnection(updated) };
  } catch (e) {
    const msg = e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message;
    const updated = await prisma.wordPressConnection.update({ where: { id: conn.id }, data: { status: 'error', lastTestAt: new Date(), lastError: msg.slice(0, 500) } });
    return { ok: false as const, error: msg, connection: publicConnection(updated) };
  }
}

export async function listRemoteCategories(siteId: string) {
  const { client } = await clientFor(siteId);
  return client.listCategories();
}

// ---------------------------------------------------------------------------
// Sending to WordPress (drafts only)
// ---------------------------------------------------------------------------

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function payloadOf(p: { title: string; content: string; slug: string; metaDescription: string }, categories?: number[]): DraftInput {
  return { title: p.title, content: p.content, slug: p.slug, excerpt: p.metaDescription, ...(categories?.length ? { categories } : {}) };
}

function diffAgainst(remote: WpPost | null, payload: DraftInput) {
  const beforeTitle = remote?.title.raw ?? remote?.title.rendered ?? '';
  const beforeContent = remote?.content.raw ?? remote?.content.rendered ?? '';
  const lines = lineDiff(htmlToLines(beforeContent), htmlToLines(payload.content));
  return {
    title: beforeTitle === payload.title ? null : { before: beforeTitle, after: payload.title },
    slug: !remote || remote.slug === payload.slug ? null : { before: remote.slug, after: payload.slug },
    content: lines,
    changed: !remote || beforeTitle !== payload.title || lines.some(l => l.op !== 'same')
  };
}

/** Remote changes made after our last write mean a person edited the draft in WordPress. */
function hasRemoteChanges(page: { wpModifiedGmt: string | null }, remote: WpPost) {
  return !!page.wpModifiedGmt && remote.modified_gmt !== page.wpModifiedGmt;
}

export async function dryRunPage(pageId: string, opts: { categories?: number[] } = {}) {
  const page = await prisma.generatedPage.findUnique({ where: { id: pageId } });
  if (!page || !page.siteId) throw new WorkflowError('PAGE_NOT_FOUND', `Page ${pageId} not found`, 404);
  const payload = payloadOf(page, opts.categories);
  const { conn, client } = await clientFor(page.siteId);
  let remote: WpPost | null = null;
  let remoteError: string | null = null;
  if (page.publishedWpPostId) {
    try {
      remote = await client.getPost(page.publishedWpPostId);
    } catch (e) {
      remoteError = e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message;
    }
  }
  const diff = diffAgainst(remote, payload);
  const action = page.publishedWpPostId ? 'update' : 'create';
  const warnings = [
    ...(page.status !== 'APPROVED' && page.status !== 'SENT_AS_DRAFT' ? ['The page is not approved; sending is blocked until a person approves it.'] : []),
    ...(remote && remote.status !== 'draft' ? [`The remote post is "${remote.status}"; the tool will not modify it.`] : []),
    ...(remote && hasRemoteChanges(page, remote) ? ['The draft was edited in WordPress after the last send; sending would overwrite those edits.'] : []),
    ...(remoteError ? [`Could not read the remote post: ${remoteError}`] : [])
  ];
  await prisma.wordPressPublication.create({ data: { generatedPageId: page.id, connectionId: conn.id, action: 'dry_run', result: 'success', wpPostId: page.publishedWpPostId, contentHash: hash(payload.content), diff: json(diff) } });
  return { action, payload: { ...payload, status: 'draft' }, diff, warnings, remote: remote ? { id: remote.id, status: remote.status, modified_gmt: remote.modified_gmt, link: remote.link } : null };
}

export async function pushPageAsDraft(pageId: string, opts: { categories?: number[]; overwriteRemoteChanges?: boolean } = {}, actorUserId?: string | null) {
  const page = await prisma.generatedPage.findUnique({ where: { id: pageId }, include: { site: true } });
  if (!page || !page.siteId) throw new WorkflowError('PAGE_NOT_FOUND', `Page ${pageId} not found`, 404);
  if (page.status !== 'APPROVED' && page.status !== 'SENT_AS_DRAFT') throw new WorkflowError('NOT_APPROVED', 'Only approved pages can be sent to WordPress');
  const { conn, client } = await clientFor(page.siteId);
  const payload = payloadOf(page, opts.categories);
  const record = (data: Omit<Prisma.WordPressPublicationUncheckedCreateInput, 'generatedPageId' | 'connectionId' | 'contentHash'>) =>
    prisma.wordPressPublication.create({ data: { generatedPageId: page.id, connectionId: conn.id, contentHash: hash(payload.content), ...data } });
  const audit = (action: string, details: Record<string, unknown>) => recordAuditEvent({ workspaceId: page.site?.workspaceId ?? null, userId: actorUserId ?? null, action, entity: 'GeneratedPage', entityId: page.id, details: json(details) });

  try {
    if (!page.publishedWpPostId) {
      const created = await client.createDraft(payload);
      await prisma.generatedPage.update({ where: { id: page.id }, data: { status: 'SENT_AS_DRAFT', publishedWpPostId: created.id, wpModifiedGmt: created.modified_gmt, wpLink: created.link } });
      const pub = await record({ action: 'create', result: 'success', wpPostId: created.id, wpLink: created.link, diff: json(diffAgainst(null, payload)) });
      await audit('wordpress.draft_created', { wpPostId: created.id });
      return { result: 'created' as const, wpPostId: created.id, link: created.link, editLink: `${conn.endpointUrl}/wp-admin/post.php?post=${created.id}&action=edit`, publicationId: pub.id };
    }

    const remote = await client.getPost(page.publishedWpPostId);
    if (remote.status !== 'draft') {
      await record({ action: 'update', result: 'refused', wpPostId: remote.id, error: `Remote post is ${remote.status}` });
      throw new WorkflowError('REMOTE_NOT_DRAFT', `The WordPress post is "${remote.status}"; the tool only edits drafts`);
    }
    if (hasRemoteChanges(page, remote) && !opts.overwriteRemoteChanges) {
      const diff = diffAgainst(remote, payload);
      await record({ action: 'update', result: 'conflict', wpPostId: remote.id, diff: json(diff), error: `Remote modified at ${remote.modified_gmt}, last write ${page.wpModifiedGmt}` });
      throw new WorkflowError('REMOTE_CHANGED', 'The draft was edited in WordPress after the last send. Review the diff and confirm to overwrite.', 409, { remoteModified: remote.modified_gmt, lastWrite: page.wpModifiedGmt, diff });
    }
    const updated = await client.updateDraft(remote.id, payload);
    await prisma.generatedPage.update({ where: { id: page.id }, data: { status: 'SENT_AS_DRAFT', wpModifiedGmt: updated.modified_gmt, wpLink: updated.link } });
    const pub = await record({
      action: 'update',
      result: 'success',
      wpPostId: updated.id,
      wpLink: updated.link,
      diff: json(diffAgainst(remote, payload)),
      previousRemote: json({ title: remote.title.raw ?? remote.title.rendered, content: remote.content.raw ?? remote.content.rendered, excerpt: remote.excerpt.raw ?? remote.excerpt.rendered, slug: remote.slug, modified_gmt: remote.modified_gmt })
    });
    await audit('wordpress.draft_updated', { wpPostId: updated.id, overwroteRemoteChanges: !!opts.overwriteRemoteChanges && hasRemoteChanges(page, remote) });
    return { result: 'updated' as const, wpPostId: updated.id, link: updated.link, editLink: `${conn.endpointUrl}/wp-admin/post.php?post=${updated.id}&action=edit`, publicationId: pub.id };
  } catch (e) {
    if (e instanceof WorkflowError) throw e;
    const msg = e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message;
    await record({ action: page.publishedWpPostId ? 'update' : 'create', result: 'failed', wpPostId: page.publishedWpPostId, error: msg.slice(0, 1000) });
    await audit('wordpress.send_failed', { error: msg });
    throw new WorkflowError('WORDPRESS_ERROR', msg, 502);
  }
}

/**
 * Restores the remote draft to the content saved before a given update.
 * Only possible for "update" publications (a create has nothing to restore) and only while the post is a draft.
 */
export async function rollbackPublication(publicationId: string, actorUserId?: string | null) {
  const pub = await prisma.wordPressPublication.findUnique({ where: { id: publicationId }, include: { generatedPage: { include: { site: true } } } });
  if (!pub) throw new WorkflowError('PUBLICATION_NOT_FOUND', `Publication ${publicationId} not found`, 404);
  if (pub.action !== 'update' || pub.result !== 'success' || !pub.previousRemote || !pub.wpPostId) throw new WorkflowError('NOTHING_TO_RESTORE', 'Only successful updates keep a copy of the previous remote content');
  const page = pub.generatedPage;
  const { client } = await clientFor(page.siteId!);
  const prev = pub.previousRemote as { title: string; content: string; excerpt: string; slug: string };
  const restored = await client.updateDraft(pub.wpPostId, { title: prev.title, content: prev.content, excerpt: prev.excerpt, slug: prev.slug });
  await prisma.generatedPage.update({ where: { id: page.id }, data: { wpModifiedGmt: restored.modified_gmt } });
  await recordAuditEvent({ workspaceId: page.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'wordpress.draft_restored', entity: 'WordPressPublication', entityId: pub.id, details: { wpPostId: pub.wpPostId } });
  return { restored: true, wpPostId: restored.id, modified_gmt: restored.modified_gmt };
}

/** Sends several approved pages, one after another, reporting each result. Conflicts are not overwritten. */
export async function bulkPush(pageIds: string[], opts: { categories?: number[] } = {}, actorUserId?: string | null) {
  const results: Array<{ id: string; ok: boolean; result?: string; wpPostId?: number; error?: string }> = [];
  for (const id of pageIds) {
    try {
      const r = await pushPageAsDraft(id, { categories: opts.categories }, actorUserId);
      results.push({ id, ok: true, result: r.result, wpPostId: r.wpPostId });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof WorkflowError ? e.code : (e as Error).message });
    }
  }
  return results;
}
