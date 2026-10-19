import zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, completeMonths } from '@glitch/db';
import { buildAuthedApp } from './helpers';

let app: FastifyInstance;
let siteId: string;
const O = 'https://blog.example.com';

const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${i % 37} palabra${(i * 7) % 53}`).join(' ');
const page = (body: string) => zlib.gzipSync(`<html><body><nav>Inicio Blog Contacto ${words('menu', 40)}</nav><main><h1>T</h1><p>${body}</p></main><footer>${words('pie', 60)}</footer></body></html>`);

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Blog', domain: 'blog.example.com', canonicalUrl: O } })).json().id;
  const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 6, config: {} } });
  const base = words('guia', 400);
  const almost = base.split(' ');
  for (let i = 0; i < 12; i++) almost[i * 60] = 'distinto'; // a few words changed: near duplicate
  await prisma.crawledPage.createMany({
    data: [
      { url: `${O}/guia`, html: base, inlinks: 9 },
      { url: `${O}/guia?utm=1`, html: base, inlinks: 0 }, // exact copy
      { url: `${O}/guia-2024`, html: almost.join(' '), inlinks: 2 },
      { url: `${O}/otro-tema`, html: words('cocina', 400), inlinks: 3 },
      { url: `${O}/contacto`, html: 'Escríbenos a hola@blog.example.com o llámanos.', inlinks: 20 },
      { url: `${O}/vieja`, html: words('cocina', 400), inlinks: 0, canonical: `${O}/otro-tema` }
    ].map(p => ({ crawlRunId: run.id, url: p.url, finalUrl: p.url, statusCode: 200, responseTimeMs: 10, mimeType: 'text/html', sizeBytes: 1, isIndexable: !p.canonical, indexabilityReason: p.canonical ? 'Canonical a otra URL' : null, canonical: p.canonical ?? null, depth: 1, inlinks: p.inlinks, htmlGz: page(p.html) }))
  });

  // Search Console: monthly history and query rows.
  const months = completeMonths(new Date(), 15).reverse();
  const m = (page: string, clicks: number[], position: number[]) => months.map((month, i) => ({ siteId, month, page, clicks: clicks[i], impressions: 1000, ctr: clicks[i] / 1000, position: position[i] }));
  const flat = (v: number) => months.map(() => v);
  await prisma.gscPageMonth.createMany({
    data: [
      ...m(`${O}/guia`, [80, 80, 80, 80, 80, 80, 80, 80, 80, 100, 100, 100, 60, 50, 40], [...flat(4).slice(0, 12), 7, 8, 9]), // lost positions
      ...m(`${O}/otro-tema`, flat(50), flat(3)), // stable
      ...m(`${O}/navidad`, [30, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 60, 30, 10, 10], flat(5)) // seasonal: same as a year ago
    ]
  });
  const imp = await prisma.gscImport.create({ data: { siteId, property: `${O}/`, startDate: '2026-07-01', endDate: '2026-10-15', status: 'completed', completedAt: new Date() } });
  await prisma.gscPageStat.create({ data: { importId: imp.id, page: `${O}/guia`, clicks: 300, impressions: 3000, ctr: 0.1, position: 5 } });
  const q = (query: string, page: string, clicks: number, impressions: number, position: number) => ({ importId: imp.id, query, page, clicks, impressions, ctr: clicks / impressions, position });
  await prisma.gscQueryStat.createMany({
    data: [
      q('recetas de cocina fáciles', `${O}/otro-tema`, 50, 900, 4),
      q('recetas cocina facil', `${O}/otro-tema`, 20, 400, 6),
      q('recetas de cocina rápidas', `${O}/otro-tema`, 10, 300, 8),
      q('guía seo para principiantes', `${O}/guia`, 30, 500, 5),
      q('guia seo principiantes', `${O}/guia-2024`, 25, 450, 6),
      q('seo para principiantes 2024', `${O}/guia-2024`, 20, 300, 7),
      q('curso de jardinería', `${O}/otro-tema`, 0, 150, 45)
    ]
  });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Análisis de contenido', () => {
  it('finds exact and near duplicates of the main text (not the template) and thin pages', async () => {
    const r = await app.inject(`/api/v1/sites/${siteId}/content/duplicates`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.exact).toHaveLength(2);
    const guia = b.exact.find((g: { keeper: { url: string } }) => g.keeper.url === `${O}/guia`);
    expect(guia.pages[0]).toMatchObject({ url: `${O}/guia?utm=1`, status: 'pendiente' }); // the page with clicks and links stays
    const cocina = b.exact.find((g: { keeper: { url: string } }) => g.keeper.url === `${O}/otro-tema`);
    expect(cocina.pages[0]).toMatchObject({ url: `${O}/vieja`, status: 'resuelto' }); // already canonicalized
    expect(b.near).toHaveLength(1);
    expect(b.near[0].keeper.url).toBe(`${O}/guia`);
    expect(b.near[0].pages.map((p: { url: string }) => p.url)).toEqual([`${O}/guia-2024`]);
    expect(b.near[0].similarity).toBeGreaterThanOrEqual(85);
    expect(b.thin.map((p: { url: string }) => p.url)).toEqual([`${O}/contacto`]); // menus and footer do not count
    expect((await app.inject(`/api/v1/sites/${siteId}/content/duplicates?threshold=99`)).json().near).toHaveLength(0);
  });

  it('flags pages losing clicks, explains why and separates seasonal drops', async () => {
    const b = (await app.inject(`/api/v1/sites/${siteId}/content/declining`)).json();
    expect(b.ready).toBe(true);
    const urls = b.pages.map((p: { page: string }) => p.page);
    expect(urls).not.toContain(`${O}/otro-tema`);
    const g = b.pages.find((p: { page: string }) => p.page === `${O}/guia`);
    expect(g).toMatchObject({ before: 300, after: 150, lost: 150, drop: 50, seasonal: false, streak: 3 });
    expect(g.reasons[0]).toMatch(/Perdió posiciones/);
    expect(g.series).toHaveLength(15);
    const n = b.pages.find((p: { page: string }) => p.page === `${O}/navidad`);
    expect(n?.seasonal).toBe(true);
    expect(urls[0]).toBe(`${O}/guia`); // real declines first
  });

  it('groups queries into topics and names the page each topic should rank with', async () => {
    const b = (await app.inject(`/api/v1/sites/${siteId}/content/topics`)).json();
    const cocina = b.topics.find((t: { name: string }) => t.name === 'recetas de cocina fáciles');
    expect(cocina).toMatchObject({ queryCount: 3, target: `${O}/otro-tema`, targetShare: 100, status: 'claro' });
    const seo = b.topics.find((t: { name: string }) => t.name === 'guía seo para principiantes');
    expect(seo.queryCount).toBe(3);
    expect(seo.status).toBe('disperso');
    expect(seo.advice).toMatch(/Canibalización/);
    const weak = b.topics.find((t: { name: string }) => t.name === 'curso de jardinería');
    expect(weak.status).toBe('sin-pagina-fuerte');
  });

  it('computes complete months only', () => {
    expect(completeMonths(new Date('2026-10-16T00:00:00Z'), 3)).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(completeMonths(new Date('2026-09-30T00:00:00Z'), 2)).toEqual(['2026-09', '2026-08']);
  });
});
