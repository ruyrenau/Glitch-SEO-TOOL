import * as cheerio from 'cheerio';
import { decryptSecret } from '@glitch/core';
import { WordPressSeoClient, WordPressError, SEO_META_KEYS, WpSeoItem } from '@glitch/connectors';
import { assertSafeUrl } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent, currentActorId } from './audit';
import { WorkflowError } from './errors';

/**
 * Editing SEO fields of live WordPress content (ADR 012):
 * propose → approve → apply (only if WordPress still has the proposed-from value) → verify on the live page → revert.
 * Content bodies and statuses are never changed.
 */

export type SeoField = 'postTitle' | 'slug' | 'seoTitle' | 'metaDescription' | 'imageAlt';
export const FIELD_LABEL: Record<SeoField, string> = { postTitle: 'Título de la entrada', slug: 'Slug', seoTitle: 'Título SEO', metaDescription: 'Meta description', imageAlt: 'Texto alternativo' };

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function seoClient(siteId: string) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Conecta WordPress para este sitio primero', 400);
  return new WordPressSeoClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() });
}

const wpError = (e: unknown) => (e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message);

function valueOf(item: WpSeoItem, field: SeoField, metaKey?: string | null): string {
  if (field === 'postTitle') return item.title;
  if (field === 'slug') return item.slug;
  return (metaKey && item.meta[metaKey]) || '';
}

function metaKeyFor(item: WpSeoItem, field: SeoField): string | null {
  if (field !== 'seoTitle' && field !== 'metaDescription') return null;
  if (!item.metaProvider) throw new WorkflowError('META_NOT_EXPOSED', 'No se puede editar: el sitio no tiene Yoast SEO ni Rank Math activos, o sus campos no están expuestos por la API (instala docs/wordpress/glitch-seo-meta.php como mu-plugin).', 400);
  const k = SEO_META_KEYS[item.metaProvider];
  return field === 'seoTitle' ? k.title : k.description;
}

/** What can be edited for a crawled URL: the WordPress item behind it and the media behind its images. */
export async function lookupEditable(siteId: string, url: string, imageSrcs: string[] = []) {
  const client = await seoClient(siteId);
  let item: WpSeoItem | null = null;
  let error: string | null = null;
  try {
    item = await client.findByUrl(url);
  } catch (e) {
    error = wpError(e);
  }
  const images = [];
  for (const src of imageSrcs.slice(0, 30)) {
    try {
      const m = await client.findMediaBySrc(src);
      images.push({ src, mediaId: m?.id ?? null, alt: m?.alt_text ?? null });
    } catch {
      images.push({ src, mediaId: null, alt: null });
    }
  }
  const pending = await prisma.seoChangeProposal.findMany({ where: { siteId, url, status: { in: ['proposed', 'approved'] } }, select: { id: true, field: true, newValue: true, status: true, imageSrc: true } });
  return {
    item: item && {
      target: item.type,
      wpId: item.id,
      status: item.status,
      link: item.link,
      postTitle: item.title,
      slug: item.slug,
      metaProvider: item.metaProvider,
      seoTitle: item.metaProvider ? item.meta[SEO_META_KEYS[item.metaProvider].title] ?? '' : null,
      metaDescription: item.metaProvider ? item.meta[SEO_META_KEYS[item.metaProvider].description] ?? '' : null
    },
    images,
    pending,
    error: item ? null : error ?? 'No se encontró una entrada o página de WordPress con esta URL (la portada y los archivos de categoría no se pueden editar por esta vía).'
  };
}

export interface ProposeInput {
  url: string;
  field: SeoField;
  newValue: string;
  note?: string;
  /** For imageAlt */
  imageSrc?: string;
}

function validate(field: SeoField, v: string) {
  if (field === 'slug' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) throw new WorkflowError('INVALID_SLUG', 'El slug solo admite minúsculas, números y guiones.', 400);
  if ((field === 'postTitle' || field === 'slug') && !v.trim()) throw new WorkflowError('EMPTY_VALUE', 'Este campo no puede quedar vacío.', 400);
  if (v.length > 1000) throw new WorkflowError('TOO_LONG', 'Valor demasiado largo.', 400);
}

export async function proposeChange(siteId: string, input: ProposeInput) {
  validate(input.field, input.newValue);
  const client = await seoClient(siteId);
  let target: string, wpId: number, oldValue: string, metaKey: string | null = null;
  try {
    if (input.field === 'imageAlt') {
      if (!input.imageSrc) throw new WorkflowError('IMAGE_REQUIRED', 'Falta la imagen.', 400);
      const m = await client.findMediaBySrc(input.imageSrc);
      if (!m) throw new WorkflowError('MEDIA_NOT_FOUND', 'La imagen no está en la biblioteca de medios de WordPress.', 404);
      target = 'media';
      wpId = m.id;
      oldValue = m.alt_text;
    } else {
      const item = await client.findByUrl(input.url);
      if (!item) throw new WorkflowError('WP_ITEM_NOT_FOUND', 'No se encontró la entrada o página de WordPress de esta URL.', 404);
      metaKey = metaKeyFor(item, input.field);
      target = item.type;
      wpId = item.id;
      oldValue = valueOf(item, input.field, metaKey);
    }
  } catch (e) {
    if (e instanceof WorkflowError) throw e;
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  }
  if (oldValue === input.newValue) throw new WorkflowError('NO_CHANGE', 'El valor nuevo es igual al actual.', 400);
  const dup = await prisma.seoChangeProposal.findFirst({ where: { siteId, target, wpId, field: input.field, status: { in: ['proposed', 'approved'] } } });
  if (dup) throw new WorkflowError('PENDING_EXISTS', 'Ya hay un cambio pendiente para este campo; apruébalo, recházalo o aplícalo primero.', 409, { proposalId: dup.id });
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const p = await prisma.seoChangeProposal.create({
    data: { siteId, url: input.url, target, wpId, field: input.field, metaKey, imageSrc: input.imageSrc ?? null, oldValue, newValue: input.newValue, note: input.note, createdById: currentActorId() }
  });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'seo_change.proposed', entity: 'SeoChangeProposal', entityId: p.id, details: { url: p.url, field: p.field, oldValue, newValue: p.newValue } });
  return p;
}

export async function listProposals(siteId: string, status?: string) {
  return prisma.seoChangeProposal.findMany({ where: { siteId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
}

async function load(id: string) {
  const p = await prisma.seoChangeProposal.findUnique({ where: { id }, include: { site: true } });
  if (!p) throw new WorkflowError('PROPOSAL_NOT_FOUND', `Proposal ${id} not found`, 404);
  return p;
}

export async function reviewProposal(id: string, decision: 'approved' | 'rejected') {
  const p = await load(id);
  if (p.status !== 'proposed') throw new WorkflowError('NOT_PROPOSED', `Este cambio está "${p.status}"; solo se revisan cambios propuestos.`);
  const updated = await prisma.seoChangeProposal.update({ where: { id }, data: { status: decision, reviewedById: currentActorId() } });
  await recordAuditEvent({ workspaceId: p.site.workspaceId, userId: null, action: `seo_change.${decision}`, entity: 'SeoChangeProposal', entityId: id });
  return updated;
}

async function readCurrent(client: WordPressSeoClient, p: { target: string; wpId: number; field: string; metaKey: string | null }) {
  if (p.target === 'media') return (await client.getMedia(p.wpId)).alt_text;
  const item = await client.getSeoItem(p.target as 'post' | 'page', p.wpId);
  return valueOf(item, p.field as SeoField, p.metaKey);
}

async function write(client: WordPressSeoClient, p: { target: string; wpId: number; field: string; metaKey: string | null }, value: string) {
  if (p.target === 'media') return client.updateMediaAlt(p.wpId, value);
  const t = p.target as 'post' | 'page';
  if (p.field === 'postTitle') return client.updateSeoFields(t, p.wpId, { title: value });
  if (p.field === 'slug') return client.updateSeoFields(t, p.wpId, { slug: value });
  return client.updateSeoFields(t, p.wpId, { meta: { [p.metaKey!]: value } });
}

/** Applies an approved change if WordPress still holds the value it was proposed from. */
export async function applyProposal(id: string) {
  const p = await load(id);
  if (p.status !== 'approved') throw new WorkflowError('NOT_APPROVED', 'Solo se aplican cambios aprobados.');
  const client = await seoClient(p.siteId);
  try {
    const current = await readCurrent(client, p);
    if (current !== p.oldValue) {
      await prisma.seoChangeProposal.update({ where: { id }, data: { status: 'conflict', error: `En WordPress ahora dice: "${current.slice(0, 300)}"` } });
      await recordAuditEvent({ workspaceId: p.site.workspaceId, userId: null, action: 'seo_change.conflict', entity: 'SeoChangeProposal', entityId: id, details: { expected: p.oldValue, found: current } });
      throw new WorkflowError('REMOTE_CHANGED', 'El valor cambió en WordPress desde que se propuso; no se aplicó. Crea una propuesta nueva.', 409, { found: current });
    }
    await write(client, p, p.newValue);
  } catch (e) {
    if (e instanceof WorkflowError) throw e;
    await prisma.seoChangeProposal.update({ where: { id }, data: { status: 'failed', error: wpError(e) } });
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  }
  const updated = await prisma.seoChangeProposal.update({ where: { id }, data: { status: 'applied', appliedAt: new Date(), appliedById: currentActorId(), error: null, verifyStatus: null, verifyDetail: null } });
  await recordAuditEvent({ workspaceId: p.site.workspaceId, userId: null, action: 'seo_change.applied', entity: 'SeoChangeProposal', entityId: id, details: { url: p.url, field: p.field, from: p.oldValue, to: p.newValue } });
  return updated;
}

/** Restores the old value, only if WordPress still has the value we wrote. */
export async function revertProposal(id: string) {
  const p = await load(id);
  if (p.status !== 'applied') throw new WorkflowError('NOT_APPLIED', 'Solo se revierten cambios aplicados.');
  const client = await seoClient(p.siteId);
  const current = await readCurrent(client, p).catch(e => {
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  });
  if (current !== p.newValue) throw new WorkflowError('REMOTE_CHANGED', 'El valor volvió a cambiar en WordPress; no se revierte para no pisar ese cambio.', 409, { found: current });
  await write(client, p, p.oldValue).catch(e => {
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  });
  const updated = await prisma.seoChangeProposal.update({ where: { id }, data: { status: 'reverted' } });
  await recordAuditEvent({ workspaceId: p.site.workspaceId, userId: null, action: 'seo_change.reverted', entity: 'SeoChangeProposal', entityId: id });
  return updated;
}

/**
 * Checks the live page. Themes and SEO plugins format titles differently, so titles are
 * matched by containment; page caches can delay the change, which is reported as a mismatch.
 */
export async function verifyProposal(id: string) {
  const p = await load(id);
  if (p.status !== 'applied') throw new WorkflowError('NOT_APPLIED', 'Solo se verifican cambios aplicados.');
  let target = p.url;
  if (p.field === 'slug') {
    const u = new URL(p.url);
    const parts = u.pathname.split('/');
    const idx = parts.lastIndexOf(p.oldValue);
    if (idx >= 0) parts[idx] = p.newValue;
    u.pathname = parts.join('/');
    target = u.toString();
  }
  let verifyStatus: 'verified' | 'mismatch' | 'error' = 'error';
  let detail = '';
  try {
    await assertSafeUrl(target, { allowHosts: allowHosts() });
    const res = await fetch(target, { headers: { 'cache-control': 'no-cache', 'user-agent': 'GlitchSeoOps/verify' }, signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    const $ = cheerio.load(html);
    const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const want = norm(p.newValue);
    let found = '';
    if (p.field === 'slug') {
      found = `HTTP ${res.status}`;
      verifyStatus = res.ok ? 'verified' : 'mismatch';
    } else if (p.field === 'metaDescription') {
      found = norm($('meta[name="description" i]').attr('content'));
      verifyStatus = found === want ? 'verified' : 'mismatch';
    } else if (p.field === 'imageAlt') {
      const img = $('img').filter((_, el) => {
        const s = $(el).attr('src') ?? '';
        return !!p.imageSrc && (s === p.imageSrc || p.imageSrc.endsWith(s) || s.endsWith(new URL(p.imageSrc).pathname));
      });
      found = img.length ? norm(img.first().attr('alt')) : '(imagen no encontrada en la página)';
      if (found !== want && img.length) found += ' — WordPress copia el alt dentro del contenido al insertar la imagen; el cambio en la biblioteca no modifica imágenes ya insertadas (sí usos nuevos e imágenes destacadas)';
      verifyStatus = found === want ? 'verified' : 'mismatch';
    } else {
      found = norm($('head > title').first().text() || $('title').first().text());
      const h1 = norm($('h1').first().text());
      verifyStatus = found.includes(want) || (p.field === 'postTitle' && h1 === want) ? 'verified' : 'mismatch';
    }
    detail = verifyStatus === 'verified' ? `En la página: "${found.slice(0, 200)}"` : `Se esperaba "${want.slice(0, 120)}", la página muestra "${found.slice(0, 200)}". Puede ser caché o que el tema/plugin no use este campo.`;
  } catch (e) {
    detail = (e as Error).message.slice(0, 300);
  }
  return prisma.seoChangeProposal.update({ where: { id }, data: { verifyStatus, verifyDetail: detail, verifiedAt: new Date() } });
}
