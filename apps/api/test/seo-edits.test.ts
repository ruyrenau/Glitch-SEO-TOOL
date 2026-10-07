import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let wp: MockWordPress;
let siteId: string;
let postUrl: string;
let postId: number;
let imgSrc: string;

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  const host = new URL(wp.url);
  siteId = (await post('/api/v1/sites', { name: 'Live WP', domain: host.hostname, canonicalUrl: wp.url })).json().id;
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
  const img = wp.addMedia({ file: 'logo-puebla.png', alt: '' });
  imgSrc = img.source_url;
  const p = wp.addPublished({ slug: 'auditoria-seo-puebla', title: 'Auditoría SEO Puebla', seoTitle: '', metaDescription: 'Texto viejo', imageIds: [img.id] });
  postId = p.id;
  postUrl = `${wp.url}/auditoria-seo-puebla/`;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await prisma.$disconnect();
});

describe('editing SEO fields of live WordPress content', () => {
  it('finds the WordPress item and media behind a crawled URL', async () => {
    const r = (await app.inject(`/api/v1/sites/${siteId}/seo-edits/lookup?url=${encodeURIComponent(postUrl)}&images=${encodeURIComponent(imgSrc)}`)).json();
    expect(r.item).toMatchObject({ target: 'post', wpId: postId, status: 'publish', postTitle: 'Auditoría SEO Puebla', slug: 'auditoria-seo-puebla', metaProvider: 'yoast', metaDescription: 'Texto viejo' });
    expect(r.images).toEqual([{ src: imgSrc, mediaId: expect.any(Number), alt: '' }]);
    const home = (await app.inject(`/api/v1/sites/${siteId}/seo-edits/lookup?url=${encodeURIComponent(`${wp.url}/`)}`)).json();
    expect(home.item).toBeNull();
    expect(home.error).toMatch(/portada/);
  });

  it('proposes, approves, applies and verifies a meta description on the live page', async () => {
    const p = await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'metaDescription', newValue: 'Auditoría SEO técnica en Puebla: logs, rastreo e indexación con plan priorizado.' });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({ status: 'proposed', oldValue: 'Texto viejo', metaKey: '_yoast_wpseo_metadesc' });
    const id = p.json().id;

    expect((await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true })).json().error.code).toBe('NOT_APPROVED');
    expect((await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'metaDescription', newValue: 'Otra' })).json().error.code).toBe('PENDING_EXISTS');

    expect((await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' })).json().status).toBe('approved');
    expect((await post(`/api/v1/seo-edits/${id}/apply`, {})).statusCode).toBe(400); // confirmation required
    const applied = (await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true })).json();
    expect(applied.status).toBe('applied');
    expect(wp.posts.get(postId)!.meta!._yoast_wpseo_metadesc).toMatch(/^Auditoría SEO técnica en Puebla/);
    expect(wp.posts.get(postId)!.status).toBe('publish'); // status untouched
    expect(wp.posts.get(postId)!.content).toBe('Contenido publicado.'); // content untouched

    const v = (await post(`/api/v1/seo-edits/${id}/verify`, {})).json();
    expect(v.verifyStatus).toBe('verified');
  });

  it('refuses to apply when WordPress changed since the proposal (conflict)', async () => {
    const id = (await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'postTitle', newValue: 'Auditoría SEO técnica en Puebla' })).json().id;
    await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' });
    wp.posts.get(postId)!.title = 'Editado a mano en wp-admin';
    const r = await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('REMOTE_CHANGED');
    expect(wp.posts.get(postId)!.title).toBe('Editado a mano en wp-admin');
    expect((await prisma.seoChangeProposal.findUniqueOrThrow({ where: { id } })).status).toBe('conflict');
  });

  it('edits image alt text in the media library and verifies it on the page', async () => {
    const id = (await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'imageAlt', imageSrc: imgSrc, newValue: 'Logo de Glitch Puebla' })).json().id;
    await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' });
    await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true });
    expect([...wp.media.values()][0].alt_text).toBe('Logo de Glitch Puebla');
    expect((await post(`/api/v1/seo-edits/${id}/verify`, {})).json().verifyStatus).toBe('verified');
  });

  it('reports a page cache as a mismatch instead of claiming success, and can revert', async () => {
    wp.freezeHtml(true);
    const id = (await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'seoTitle', newValue: 'Auditoría SEO en Puebla | Glitch' })).json().id;
    await fetch(postUrl); // cache the old HTML
    await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' });
    await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true });
    const v = (await post(`/api/v1/seo-edits/${id}/verify`, {})).json();
    expect(v.verifyStatus).toBe('mismatch');
    expect(v.verifyDetail).toMatch(/caché/);
    wp.freezeHtml(false);

    const r = (await post(`/api/v1/seo-edits/${id}/revert`, { confirm: true })).json();
    expect(r.status).toBe('reverted');
    expect(wp.posts.get(postId)!.meta!._yoast_wpseo_title).toBe('');
  });

  it('validates input and permissions, and audits every step', async () => {
    expect((await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'slug', newValue: 'Con Espacios' })).json().error.code).toBe('INVALID_SLUG');
    expect((await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'postTitle', newValue: 'Editado a mano en wp-admin' })).json().error.code).toBe('NO_CHANGE');

    const editor = await loginAs(app, 'EDITOR');
    const proposed = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/seo-edits`, headers: { cookie: editor.cookie }, payload: { url: postUrl, field: 'postTitle', newValue: 'Título propuesto por el editor' } });
    expect(proposed.statusCode).toBe(201); // editors can propose…
    const approve = await app.inject({ method: 'POST', url: `/api/v1/seo-edits/${proposed.json().id}/review`, headers: { cookie: editor.cookie }, payload: { decision: 'approved' } });
    expect(approve.statusCode).toBe(403); // …but not approve or apply

    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['seo_change.proposed', 'seo_change.approved', 'seo_change.applied', 'seo_change.conflict', 'seo_change.reverted']));
  });
});
