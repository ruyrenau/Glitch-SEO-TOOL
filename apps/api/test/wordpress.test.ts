import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp } from './helpers';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';

/**
 * Runs against a mock WordPress by default. To run the same flow against a real
 * WordPress (e.g. WordPress Playground), set WP_TEST_URL, WP_TEST_USER and WP_TEST_APP_PASSWORD.
 */
const REAL = process.env.WP_TEST_URL
  ? { url: process.env.WP_TEST_URL.replace(/\/+$/, ''), username: process.env.WP_TEST_USER ?? 'admin', appPassword: process.env.WP_TEST_APP_PASSWORD ?? '' }
  : null;

let app: FastifyInstance;
let mock: MockWordPress | null = null;
let wp: { url: string; username: string; appPassword: string };
let siteId: string;

/** Edits the remote post directly through the REST API, as a person in wp-admin would. */
const remoteEdit = async (id: number, body: Record<string, unknown>) => {
  const res = await fetch(`${wp.url}/?rest_route=/wp/v2/posts/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${wp.username}:${wp.appPassword.replace(/\s+/g, '')}`).toString('base64') },
    body: JSON.stringify(body)
  });
  expect(res.ok).toBe(true);
};

const BODY = `<h1>Auditoría SEO técnica en {{city}}</h1><p>{{description}}. ${'Revisamos logs, rastreo, indexación, canonicals y datos estructurados para cada sitio. '.repeat(12)}</p><p>Precio desde {{price}} MXN.</p>`;
const tpl = (city: string, extra: Record<string, string> = {}) => ({
  titleTemplate: 'Auditoría SEO técnica en {{city}}',
  bodyTemplate: BODY,
  metaTemplate: 'Auditoría SEO técnica en {{city}}: revisión de logs, rastreo, indexación y datos estructurados.',
  slugTemplate: 'auditoria-seo-{{city}}',
  data: { city, description: 'Auditoría y corrección técnica para tiendas, despachos y restaurantes del centro, con foco en velocidad móvil, fichas locales y catálogos que hoy casi no reciben visitas de Googlebot', price: '15000', ...extra }
});

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1,localhost';
  if (REAL) wp = REAL;
  else {
    mock = await startMockWordPress();
    wp = { url: mock.url, username: mock.username, appPassword: mock.appPassword };
  }
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'WP site', domain: 'wp.example.com', canonicalUrl: 'https://wp.example.com' } })).json().id;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await mock?.close();
  await prisma.$disconnect();
});

describe(`WordPress drafts (${REAL ? 'real WordPress' : 'mock WordPress'})`, () => {
  let pageId: string;
  let wpPostId: number;
  let firstUpdatePublicationId: string;

  it('refuses plain HTTP for non-local hosts and never returns the password', async () => {
    const http = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: 'http://example.com', username: 'x', appPassword: 'xxxx xxxx xxxx' } });
    expect(http.json().error.code).toBe('HTTPS_REQUIRED');

    const bad = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: 'wrong-password-123' } });
    expect(bad.statusCode).toBe(200);
    const failed = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/wordpress/test` })).json();
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/401|rest_not_logged_in|incorrect_password|invalid/i);

    const ok = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
    expect(JSON.stringify(ok.json())).not.toContain(wp.appPassword);
    const stored = await prisma.wordPressConnection.findUnique({ where: { siteId } });
    expect(stored!.appPasswordEnc).not.toContain(wp.appPassword.slice(0, 6));
    const tested = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/wordpress/test` })).json();
    expect(tested).toMatchObject({ ok: true, canEditPosts: true });
    const cats = (await app.inject(`/api/v1/sites/${siteId}/wordpress/categories`)).json();
    expect(cats.length).toBeGreaterThan(0);
  });

  it('runs quality gates when generating pages', async () => {
    const missing = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages`, payload: { ...tpl('Toluca'), data: { city: 'Toluca' } } })).json();
    expect(missing.status).toBe('BLOCKED');
    expect(missing.qualityChecks.issues).toContain('Missing data for {{description}}');

    const page = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages`, payload: tpl('Puebla') })).json();
    expect(page.status).toBe('READY_FOR_APPROVAL');
    expect(page.slug).toBe('auditoria-seo-puebla');
    pageId = page.id;

    const twin = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages`, payload: tpl('Cholula') })).json();
    expect(twin.similarityScore).toBeGreaterThan(0.65);
    expect(twin.status).not.toBe('READY_FOR_APPROVAL');

    const dupSlug = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages`, payload: tpl('Puebla') });
    expect(dupSlug.json().error.code).toBe('DUPLICATE_SLUG');

    const approveBlocked = await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${missing.id}/review`, payload: { decision: 'approved', reviewer: 'Ana' } });
    expect(approveBlocked.json().error.code).toBe('PAGE_BLOCKED');
  });

  it('requires human approval before sending', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, payload: {} });
    expect(r.json().error.code).toBe('NOT_APPROVED');
    const dry = (await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/dry-run`, payload: {} })).json();
    expect(dry.action).toBe('create');
    expect(dry.payload.status).toBe('draft');
    expect(dry.warnings[0]).toMatch(/not approved/);
    const approved = (await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/review`, payload: { decision: 'approved', reviewer: 'Ana', notes: 'Datos verificados' } })).json();
    expect(approved.status).toBe('APPROVED');
  });

  it('creates a draft once, even if the request is retried with the same Idempotency-Key', async () => {
    const push = () => app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, headers: { 'idempotency-key': 'abc-1' }, payload: {} });
    const first = (await push()).json();
    expect(first.result).toBe('created');
    wpPostId = first.wpPostId;
    const again = await push();
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().wpPostId).toBe(wpPostId);
    const pages = (await app.inject(`/api/v1/sites/${siteId}/generated-pages`)).json();
    expect(pages.find((p: { id: string }) => p.id === pageId).status).toBe('SENT_AS_DRAFT');
    if (mock) expect(mock.posts.size).toBe(1);
  });

  it('updates the draft, keeps a backup and shows a diff in the dry run', async () => {
    await prisma.generatedPage.update({ where: { id: pageId }, data: { content: (await prisma.generatedPage.findUnique({ where: { id: pageId } }))!.content.replace('15000', '18000') } });
    const dry = (await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/dry-run`, payload: {} })).json();
    expect(dry.action).toBe('update');
    expect(dry.diff.content.filter((l: { op: string }) => l.op !== 'same').map((l: { text: string }) => l.text).join(' ')).toMatch(/15000.*18000|18000.*15000/);
    const up = (await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, payload: {} })).json();
    expect(up.result).toBe('updated');
    firstUpdatePublicationId = up.publicationId;
    const pub = await prisma.wordPressPublication.findUnique({ where: { id: up.publicationId } });
    expect(JSON.stringify(pub!.previousRemote)).toContain('15000');
  });

  it('detects edits made in WordPress and does not overwrite them without confirmation', async () => {
    await new Promise(r => setTimeout(r, 1100)); // modified_gmt has second resolution
    await remoteEdit(wpPostId, { content: '<p>Editado a mano por el equipo de contenido.</p>' });
    const conflict = await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, payload: {} });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('REMOTE_CHANGED');
    const forced = (await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, payload: { overwriteRemoteChanges: true } })).json();
    expect(forced.result).toBe('updated');
  });

  it('restores the previous remote content from a backup', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/wordpress/publications/${firstUpdatePublicationId}/rollback`, payload: { confirm: true } });
    expect(r.json().restored).toBe(true);
    const page = await prisma.generatedPage.findUnique({ where: { id: pageId } });
    expect(page!.wpModifiedGmt).toBe(r.json().modified_gmt);
  });

  it('never modifies a post that is no longer a draft', async () => {
    await new Promise(r => setTimeout(r, 1100));
    await remoteEdit(wpPostId, { status: 'publish' });
    const r = await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${pageId}/wordpress/push`, payload: { overwriteRemoteChanges: true } });
    expect(r.json().error.code).toBe('REMOTE_NOT_DRAFT');
    // Put it back so a real test site is left as it was.
    await remoteEdit(wpPostId, { status: 'draft' });
  });

  it.skipIf(!!REAL)('retries transient 503 responses', async () => {
    mock!.failNext(2);
    const t = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/wordpress/test` })).json();
    expect(t.ok).toBe(true);
  });

  it('records every attempt and audits the workflow', async () => {
    const pubs = await prisma.wordPressPublication.findMany({ where: { generatedPageId: pageId } });
    expect(pubs.map(p => p.result)).toEqual(expect.arrayContaining(['success', 'conflict', 'refused']));
    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['wordpress.connection_created', 'page.generated', 'page.approved', 'wordpress.draft_created', 'wordpress.draft_updated', 'wordpress.draft_restored']));
  });

  it('deletes rejected pages (one or all) and never pages that reached WordPress', async () => {
    const gen = async (city: string) => (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages`, payload: tpl(city) })).json().id as string;
    const a = await gen('Oaxaca de Juárez');
    const b = await gen('Mérida Yucatán');
    const keep = await gen('Querétaro');
    for (const id of [a, b]) await app.inject({ method: 'POST', url: `/api/v1/generated-pages/${id}/review`, payload: { decision: 'rejected', reviewer: 'Ana' } });

    const del = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/generated-pages/delete-rejected`, payload });
    expect((await del({})).statusCode).toBe(400); // confirmation required
    const one = (await del({ ids: [a, pageId], confirm: true })).json();
    expect(one.deleted).toBe(1);
    expect(one.skipped).toEqual([{ id: pageId, reason: 'NOT_REJECTED' }]); // sent as draft, last review approved
    const all = (await del({ confirm: true })).json();
    expect(all.deletedIds).toEqual([b]);
    expect(await prisma.generatedPage.count({ where: { id: { in: [a, b] } } })).toBe(0);
    expect(await prisma.generatedPage.count({ where: { id: { in: [keep, pageId] } } })).toBe(2);
    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toContain('page.deleted');
  });
});
