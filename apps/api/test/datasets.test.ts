import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp } from './helpers';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';

const csv = fs.readFileSync(path.resolve(__dirname, '../../../fixtures/servicios_ciudades.csv'), 'utf8');
let app: FastifyInstance;
let wp: MockWordPress;
let siteId: string;
let datasetId: string;
let templateId: string;

const TEMPLATE = {
  name: 'Servicio por ciudad',
  titleTemplate: '{{servicio}} en {{ciudad}}: auditoría y mejora continua',
  descTemplate: '{{servicio}} en {{ciudad}} desde {{precio}} MXN. {{descripcion}}',
  slugTemplate: '{{servicio}}-{{ciudad}}',
  bodyTemplate: [
    '<h1>{{servicio}} en {{ciudad}}</h1>',
    '<p>{{descripcion}}</p>',
    '<h2>Contexto local</h2><p>{{dato_local}}</p>',
    '<h2>Cómo trabajamos</h2>',
    '<p>Empezamos con una revisión de logs del servidor y un rastreo controlado del sitio. Después priorizamos los problemas por impacto y esfuerzo, y acordamos con tu equipo qué corregir primero.</p>',
    '<p>Cada recomendación incluye evidencia por URL y un criterio para verificar que quedó resuelta.</p>',
    '<h2>Qué recibes</h2><ul><li>Un reporte priorizado con las URLs afectadas y la causa de cada problema.</li><li>Una sesión de revisión con tu equipo de desarrollo o tu agencia.</li><li>Un segundo rastreo para confirmar que los cambios funcionaron.</li></ul>',
    '<p>Precio de referencia: {{precio}} MXN.</p>'
  ].join('\n')
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Datasets', domain: 'ds.example.com', canonicalUrl: 'https://ds.example.com' } })).json().id;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await prisma.$disconnect();
});

const upload = (body: string, fileName = 'servicios.csv') =>
  app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/datasets?name=Servicios&fileName=${fileName}`, headers: { 'content-type': 'text/csv' }, payload: body });

describe('datasets → templates → batch generation → review → WordPress', () => {
  it('imports and profiles a CSV, rejecting duplicates and malformed files', async () => {
    const r = await upload(csv);
    expect(r.statusCode).toBe(201);
    const ds = r.json();
    datasetId = ds.id;
    expect(ds.rowCount).toBe(12);
    expect(ds.columns.map((c: { variable: string }) => c.variable)).toEqual(['ciudad', 'servicio', 'precio', 'descripcion', 'dato_local']);
    expect(ds.columns.find((c: { variable: string }) => c.variable === 'precio').type).toBe('number');
    expect(ds.issues).toMatchObject({ duplicateRows: [9], emptyCells: 1, keyColumn: null });
    expect((await upload(csv)).json().error.code).toBe('DUPLICATE_DATASET');
    const bad = await upload('a,b\n1,2,3', 'bad.csv');
    expect(bad.json().error).toMatchObject({ code: 'INVALID_CSV', message: expect.stringMatching(/Line 2/) });
    expect((await upload('a,b\n1,2', 'evil.exe')).statusCode).toBe(415);
  });

  it('validates templates against the dataset columns and rejects scripts', async () => {
    const unknown = await app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/templates`, payload: { ...TEMPLATE, titleTemplate: '{{ciudad}} {{estado}}' } });
    expect(unknown.json().error).toMatchObject({ code: 'UNKNOWN_VARIABLES', details: { unknown: ['estado'] } });
    const unsafe = await app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/templates`, payload: { ...TEMPLATE, bodyTemplate: '<img src=x onerror=alert(1)>{{ciudad}}' } });
    expect(unsafe.json().error.code).toBe('UNSAFE_TEMPLATE');
    const ok = await app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/templates`, payload: TEMPLATE });
    expect(ok.statusCode).toBe(201);
    templateId = ok.json().id;
  });

  it('generates pages with quality gates that ignore the shared template text', async () => {
    const r = (await app.inject({ method: 'POST', url: `/api/v1/templates/${templateId}/generate`, payload: {} })).json();
    expect(r.created).toBe(11);
    expect(r.skipped).toEqual([{ rowIndex: 8, slug: 'seo-tecnico-puebla', reason: 'Slug already exists' }]);
    const pages = (await app.inject(`/api/v1/sites/${siteId}/generated-pages`)).json() as Array<{ slug: string; status: string; similarityScore: number; uniqueWords: number; content: string; qualityChecks: { issues: string[] } }>;
    const by = (slug: string) => pages.find(p => p.slug === slug)!;
    expect(by('seo-tecnico-toluca').status).toBe('BLOCKED');
    expect(by('seo-tecnico-toluca').qualityChecks.issues).toContain('Missing data for {{precio}}');
    expect(by('seo-local-oaxaca').status).toBe('NEEDS_REVIEW');
    expect(by('seo-local-oaxaca').qualityChecks.issues.join(' ')).toMatch(/garantizados/);
    expect(by('seo-internacional-cancun').content).toContain('&lt;script&gt;');
    expect(by('seo-internacional-cancun').content).not.toContain('<script>');
    const ready = pages.filter(p => p.status === 'READY_FOR_APPROVAL');
    expect(ready.length).toBeGreaterThanOrEqual(6);
    // Every page held for review says why (here: long meta descriptions built from long CSV text, a risky claim).
    for (const p of pages.filter(x => x.status === 'NEEDS_REVIEW')) expect(p.qualityChecks.issues.length).toBeGreaterThan(0);
    expect(by('logs-de-servidor-monterrey').qualityChecks.issues).toContain('Meta description is 161 characters (over 160).');
    // Pages share ~60 words of template text but are compared on their own content.
    expect(Math.max(...ready.map(p => p.similarityScore))).toBeLessThan(0.3);
    expect(Math.min(...ready.map(p => p.uniqueWords))).toBeGreaterThanOrEqual(25);
  });

  it('flags a near-duplicate row as blocked', async () => {
    const dupCsv = 'ciudad,servicio,precio,descripcion,dato_local\nPuebla Centro,SEO técnico,15000,"Auditoría y corrección técnica para tiendas y despachos del centro histórico, con foco en velocidad móvil y fichas de Google Business.","Muchas pymes poblanas venden por catálogo en WhatsApp y su web apenas recibe rastreo."';
    const ds2 = (await upload(dupCsv, 'dup.csv')).json();
    const t2 = (await app.inject({ method: 'POST', url: `/api/v1/datasets/${ds2.id}/templates`, payload: TEMPLATE })).json();
    const r = (await app.inject({ method: 'POST', url: `/api/v1/templates/${t2.id}/generate`, payload: {} })).json();
    expect(r.byStatus).toEqual({ BLOCKED: 1 });
    const page = (await app.inject(`/api/v1/sites/${siteId}/generated-pages?templateId=${t2.id}`)).json()[0];
    expect(page.qualityChecks.mostSimilar).toBe('seo-tecnico-puebla');
    expect(page.similarityScore).toBeGreaterThan(0.85);
  });

  it('bulk-approves (refusing blocked pages) and bulk-sends approved pages as drafts', async () => {
    const pages = (await app.inject(`/api/v1/sites/${siteId}/generated-pages?templateId=${templateId}`)).json() as Array<{ id: string; status: string }>;
    const review = (await app.inject({ method: 'POST', url: '/api/v1/generated-pages/bulk-review', payload: { ids: pages.map(p => p.id), decision: 'approved', reviewer: 'Ana' } })).json();
    const refused = review.results.filter((r: { ok: boolean }) => !r.ok);
    expect(refused.map((r: { error: string }) => r.error)).toEqual(['PAGE_BLOCKED']);

    await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
    const approved = pages.filter(p => p.status !== 'BLOCKED').map(p => p.id);
    const push = (await app.inject({ method: 'POST', url: '/api/v1/generated-pages/bulk-push', payload: { ids: [...approved, pages.find(p => p.status === 'BLOCKED')!.id] } })).json();
    expect(push.results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(approved.length);
    expect(push.results.at(-1)).toMatchObject({ ok: false, error: 'NOT_APPROVED' });
    expect(wp.posts.size).toBe(approved.length);
    expect([...wp.posts.values()].every(p => p.status === 'draft')).toBe(true);
  });

  it('deleting a dataset keeps the generated pages and their source data', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/datasets/${datasetId}?confirm=true` });
    expect(del.statusCode).toBe(204);
    const pages = (await app.inject(`/api/v1/sites/${siteId}/generated-pages`)).json() as Array<{ sourceData: Record<string, string> | null }>;
    expect(pages.length).toBeGreaterThanOrEqual(11);
    expect(pages.every(p => p.sourceData)).toBe(true);
  });
});
