import http from 'http';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { findBrowser } from '@glitch/crawler';
import { startMockWordPress, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs, waitForJob } from './helpers';

let app: FastifyInstance;
let wp: MockWordPress;
let site: http.Server;
let origin: string;
let siteId: string;
let wpSite: string;

const pages: Record<string, string> = {
  '/': '<h1>Agencia</h1><a href="/servicios">Servicios</a><a href="/contacto">Contacto</a>',
  '/servicios': '<h1>Servicios</h1><p>Auditoría SEO desde $4,999 MXN</p><a href="/contacto">Cotizar</a>',
  '/contacto': '<h1>Contacto</h1><form><input name="email" placeholder="Correo"><div style="cursor:pointer">Enviar</div></form>'
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><head><title>${req.url}</title></head><body>${pages[req.url ?? '/'] ?? 'x'}</body></html>`);
  });
  await new Promise<void>(r => site.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Agencia', domain: '127.0.0.1', canonicalUrl: origin } })).json().id;
  // A crawl with a Service in JSON-LD (catalog suggestions) and the key pages.
  const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, config: {} } });
  const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"Auditoría SEO","description":"Revisión técnica completa","offers":{"@type":"Offer","price":"4999","priceCurrency":"MXN","availability":"https://schema.org/InStock"}}</script>';
  await prisma.crawledPage.createMany({
    data: ['/', '/servicios', '/contacto'].map((p, i) => ({ crawlRunId: run.id, url: `${origin}${p}`, finalUrl: `${origin}${p}`, statusCode: 200, responseTimeMs: 5, mimeType: 'text/html', sizeBytes: 1, isIndexable: true, depth: i ? 1 : 0, htmlGz: zlib.gzipSync(`<html><head>${p === '/servicios' ? ld : ''}</head><body>${pages[p]}</body></html>`) }))
  });
  wpSite = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Blog WP', domain: new URL(wp.url).hostname, canonicalUrl: wp.url } })).json().id;
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${wpSite}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await new Promise<void>(r => site.close(() => r()));
  await prisma.$disconnect();
});

describe('Navegación de agentes', () => {
  it('suggests the key pages and audits them with Chrome in the background', async () => {
    const before = (await app.inject(`/api/v1/sites/${siteId}/agents/audit`)).json();
    expect(before.audit).toBeNull();
    expect(before.suggestedUrls).toEqual(expect.arrayContaining([`${origin}/`, `${origin}/servicios`, `${origin}/contacto`]));
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/agents/audit`, payload: { urls: ['https://otro.example.com/'] } })).json().error.code).toBe('FOREIGN_URL');
    if (!findBrowser()) return;
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/agents/audit`, payload: {} });
    expect(r.statusCode).toBe(202);
    expect((await waitForJob(app, r.json().jobId, 90_000)).status).toBe('COMPLETED');
    const a = (await app.inject(`/api/v1/sites/${siteId}/agents/audit`)).json().audit;
    expect(a.status).toBe('completed');
    const tasks = Object.fromEntries(a.summary.tasks.map((t: { id: string }) => [t.id, t]));
    expect(tasks.find_price).toMatchObject({ status: 'ok', pages: [`${origin}/servicios`] });
    expect(tasks.contact.status).toBe('partial'); // the field has no label and "Enviar" is a div
    const contacto = a.pages.find((p: { url: string }) => p.url.endsWith('/contacto'));
    expect(contacto.checks.find((c: { id: string }) => c.id === 'form_labels').score).toBe(0);
  }, 120_000);
});

describe('Catálogo para agentes', () => {
  it('suggests the catalog from the crawl, saves it and previews agent.json', async () => {
    const c = (await app.inject(`/api/v1/sites/${siteId}/agents/catalog`)).json();
    expect(c.saved).toBe(false);
    expect(c.items).toEqual([expect.objectContaining({ id: 'auditoria-seo', kind: 'service', name: 'Auditoría SEO', price: 4999, currency: 'MXN', availability: 'InStock' })]);
    const saved = await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/agents/catalog`, payload: { business: { name: 'Agencia', url: `${origin}/`, email: 'hola@agencia.mx', quoteUrl: '' }, items: [...c.items, { kind: 'service', name: 'Auditoría SEO', price: 9999 }] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().items.map((i: { id: string }) => i.id)).toEqual(['auditoria-seo', 'auditoria-seo-2']); // ids stay unique
    const again = (await app.inject(`/api/v1/sites/${siteId}/agents/catalog`)).json();
    expect(again.preview.agent).toMatchObject({ schema_version: 'gseo-agent/0.1', name: 'Agencia', endpoints: { mcp: { url: `${origin}/wp-json/gseo/v1/mcp`, transport: 'streamable-http' } }, policies: { read_only: true } });
    expect(again.preview.agent.actions.quote).toBeNull();
  });

  it('publishes to WordPress only when the plugin is installed, then validates agent.json, catalog and MCP live', async () => {
    await app.inject({ method: 'PUT', url: `/api/v1/sites/${wpSite}/agents/catalog`, payload: { business: { name: 'Blog WP', url: `${wp.url}/` }, items: [{ kind: 'product', name: 'Silla', price: 1500, currency: 'MXN' }] } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${wpSite}/agents/catalog/publish` })).json().error.code).toBe('AGENT_PLUGIN_MISSING');
    const before = (await app.inject(`/api/v1/sites/${wpSite}/agents/validate`)).json();
    expect(before.ok).toBe(false);
    wp.enableAgentsPlugin();
    const r = (await app.inject({ method: 'POST', url: `/api/v1/sites/${wpSite}/agents/catalog/publish` })).json();
    expect(wp.agentCatalog()).toMatchObject({ business: { name: 'Blog WP' }, items: [{ id: 'silla', name: 'Silla', price: 1500 }] });
    expect(r.ok).toBe(true);
    expect(Object.fromEntries(r.checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok]))).toEqual({ agent_json: true, catalog: true, mcp: true });
    expect(r.checks.find((c: { id: string }) => c.id === 'mcp').detail).toMatch(/search_catalog/);
  });

  it('editors keep the catalog; viewers cannot change or publish it', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/agents/catalog`, headers: { cookie: viewer.cookie }, payload: { business: { name: 'X', url: `${origin}/` }, items: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/agents/catalog/publish`, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/agents/audit`, headers: { cookie: viewer.cookie }, payload: {} })).statusCode).toBe(403);
  });
});
