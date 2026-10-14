import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let server: http.Server;
let origin = '';

const PAGES: Record<string, string> = {
  '/': `<!doctype html><html lang="es-MX"><head><title>Mueblería Roble | Muebles en Puebla</title>
    <meta name="description" content="Muebles de madera hechos a mano en Puebla.">
    <meta property="og:site_name" content="Mueblería Roble"><link rel="canonical" href="/">
    </head><body><header><img src="/img/logo-roble.png" alt="Logo Roble"></header>
    <h1>Muebles de madera</h1>
    <a href="tel:+522221234567">Llámanos</a> <a href="mailto:hola@roble.mx?subject=x">Correo</a>
    <div itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">Calle 5 #10</span><span itemprop="addressLocality">Puebla</span></div>
    <a href="https://www.facebook.com/roble">Facebook</a> <a href="https://instagram.com/roble">IG</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartir</a>
    </body></html>`,
  '/producto/silla': `<!doctype html><html lang="es"><head><title>Silla Eames – Roble</title>
    <meta property="og:image" content="/img/silla.jpg"><meta property="product:price:amount" content="1499.00"><meta property="product:price:currency" content="MXN">
    </head><body><nav aria-label="breadcrumb"><ol><li><a href="/">Inicio</a></li><li><a href="/sillas/">Sillas</a></li><li>Silla Eames</li></ol></nav>
    <h1>Silla Eames</h1><p>Silla de madera.</p></body></html>`,
  '/blog/guia': `<!doctype html><html lang="es"><head><title>Guía para cuidar muebles</title>
    <meta property="og:type" content="article"><meta property="article:published_time" content="2026-09-01T10:00:00-06:00"><meta name="author" content="Ana López">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Guía"}</script>
    </head><body><h1>Guía para cuidar muebles</h1>
    <h2>¿Cada cuánto se barniza?</h2><p>Cada dos años.</p>
    <h2>¿Se puede mojar?</h2><p>No, usa un trapo húmedo.</p>
    <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>`
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'no');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  ({ app } = await buildAuthedApp());
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await new Promise<void>(r => server.close(() => r()));
  await prisma.$disconnect();
});

const prefill = async (path: string) => (await app.inject({ method: 'POST', url: '/api/v1/schema/prefill', payload: { url: `${origin}${path}` } })).json();

describe('Schema.org generator', () => {
  it('serves the catalog', async () => {
    const c = (await app.inject('/api/v1/schema/catalog')).json();
    expect(c.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(['Organization', 'LocalBusiness', 'Product', 'Article', 'FAQPage', 'Event', 'JobPosting', 'Recipe']));
  });

  it('prefills a home page: organization or local business, website, logo, contact and social profiles', async () => {
    const r = await prefill('/');
    expect(r.hints).toMatchObject({ siteName: 'Mueblería Roble', lang: 'es-MX', telephone: '+522221234567', email: 'hola@roble.mx', logo: `${origin}/img/logo-roble.png`, address: { streetAddress: 'Calle 5 #10', addressLocality: 'Puebla' } });
    expect(r.hints.sameAs).toEqual(['https://www.facebook.com/roble', 'https://instagram.com/roble']); // share links ignored
    const types = r.suggestions.map((s: { typeId: string }) => s.typeId);
    expect(types).toEqual(['LocalBusiness', 'WebSite']); // phone + address → local business
    expect(r.suggestions[0].values).toMatchObject({ name: 'Mueblería Roble', telephone: '+522221234567' });
  });

  it('prefills a product page with price and breadcrumbs', async () => {
    const r = await prefill('/producto/silla');
    const product = r.suggestions.find((s: { typeId: string }) => s.typeId === 'Product');
    expect(product.values).toMatchObject({ name: 'Silla Eames', image: [`${origin}/img/silla.jpg`], offers: [{ price: '1499.00', priceCurrency: 'MXN' }] });
    const bc = r.suggestions.find((s: { typeId: string }) => s.typeId === 'BreadcrumbList');
    expect(bc.values.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Inicio', 'Sillas', 'Silla Eames']);
  });

  it('prefills an article with author, date, FAQ and video, and shows the schema the page already has', async () => {
    const r = await prefill('/blog/guia');
    const types = r.suggestions.map((s: { typeId: string }) => s.typeId);
    expect(types).toEqual(['Article', 'FAQPage', 'VideoObject']);
    expect(r.suggestions[0]).toMatchObject({ type: 'BlogPosting', values: { headline: 'Guía para cuidar muebles', datePublished: '2026-09-01T10:00', author: [{ name: 'Ana López' }] } });
    expect(r.suggestions[1].values.mainEntity).toEqual([{ name: '¿Cada cuánto se barniza?', acceptedAnswer: 'Cada dos años.' }, { name: '¿Se puede mojar?', acceptedAnswer: 'No, usa un trapo húmedo.' }]);
    expect(r.suggestions[2].values.thumbnailUrl).toEqual(['https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg']);
    expect(r.hints.existing).toEqual([{ type: 'BlogPosting', json: expect.objectContaining({ headline: 'Guía' }) }]);
  });

  it('refuses private addresses and pages that fail', async () => {
    delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
    expect((await app.inject({ method: 'POST', url: '/api/v1/schema/prefill', payload: { url: `${origin}/` } })).json().error.code).toBe('FETCH_FAILED');
    process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
    expect((await app.inject({ method: 'POST', url: '/api/v1/schema/prefill', payload: { url: `${origin}/no-existe` } })).json().error.code).toBe('HTTP_ERROR');
  });

  it('validates with the full report', async () => {
    const r = (await app.inject({ method: 'POST', url: '/api/v1/schema/validate', payload: { '@context': 'https://schema.org', '@type': 'Event', name: 'Feria' } })).json();
    expect(r.ok).toBe(false);
    expect(r.nodes[0].errors.join(' ')).toMatch(/Google exige "Inicio"/);
  });

  it('saves templates per workspace; editors can manage them, viewers only read', async () => {
    const forms = [{ typeId: 'Product', type: 'Product', values: { name: '{{nombre}}' } }];
    const t = (await app.inject({ method: 'POST', url: '/api/v1/schema-templates', payload: { name: 'Producto del catálogo', forms } })).json();
    expect(t.id).toBeTruthy();
    const upd = (await app.inject({ method: 'PUT', url: `/api/v1/schema-templates/${t.id}`, payload: { name: 'Producto (v2)', forms } })).json();
    expect(upd.name).toBe('Producto (v2)');
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ url: '/api/v1/schema-templates', headers: { cookie: viewer.cookie } })).json().map((x: { name: string }) => x.name)).toContain('Producto (v2)');
    expect((await app.inject({ method: 'POST', url: '/api/v1/schema-templates', headers: { cookie: viewer.cookie }, payload: { name: 'x', forms } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/schema-templates/${t.id}` })).json()).toEqual({ deleted: true });
  });
});
