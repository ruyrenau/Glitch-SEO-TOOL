import zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp } from './helpers';

let app: FastifyInstance;
let siteId: string;
const O = 'https://tienda.example.com';

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Tienda', domain: 'tienda.example.com', canonicalUrl: O } })).json().id;
  const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, config: {} } });
  const html = (body: string, title: string) => zlib.gzipSync(`<html><head><title>${title}</title></head><body>${body}</body></html>`);
  const long = '<p>' + 'Las sillas ergonómicas de oficina cuestan desde $2,500 y duran 5 años con buen uso diario. '.repeat(25) + '</p>';
  await prisma.crawledPage.createMany({
    data: [
      { url: `${O}/sillas`, title: 'Sillas de oficina ergonómicas', h1: 'Sillas de oficina', htmlGz: html(`<main><h1>Sillas</h1>${long}<h2>¿Cuál elegir?</h2><h2>Precios</h2><ul><li>a</li><li>b</li><li>c</li></ul></main>`, 'Sillas') },
      { url: `${O}/blog/mejores-sillas`, title: 'Las mejores sillas de oficina ergonómicas', h1: 'Mejores sillas de oficina', htmlGz: html('<div id="root"></div>', 'Blog') },
      { url: `${O}/escritorios`, title: 'Escritorios de madera', h1: 'Escritorios', htmlGz: html(`<main><h1>Escritorios</h1>${long}</main>`, 'Escritorios') }
    ].map(p => ({ crawlRunId: run.id, finalUrl: p.url, statusCode: 200, responseTimeMs: 50, mimeType: 'text/html', sizeBytes: 1, isIndexable: true, depth: 1, ...p }))
  });
  const imp = await prisma.gscImport.create({ data: { siteId, property: `${O}/`, startDate: '2026-09-01', endDate: '2026-10-15', status: 'completed', completedAt: new Date() } });
  await prisma.gscPageStat.createMany({ data: [`${O}/sillas`, `${O}/blog/mejores-sillas`].map(page => ({ importId: imp.id, page, clicks: 10, impressions: 500, ctr: 0.02, position: 8 })) });
  const q = (query: string, page: string, clicks: number, impressions: number, position: number) => ({ importId: imp.id, query, page, clicks, impressions, ctr: clicks / impressions, position });
  await prisma.gscQueryStat.createMany({
    data: [
      q('sillas de oficina', `${O}/sillas`, 30, 400, 6),
      q('sillas de oficina', `${O}/blog/mejores-sillas`, 10, 300, 9),
      q('silla ergonómica', `${O}/sillas`, 5, 120, 11),
      q('silla ergonomica', `${O}/blog/mejores-sillas`, 3, 100, 12), // same search without the accent
      q('escritorio de madera', `${O}/escritorios`, 20, 300, 4),
      q('escritorio de madera', `${O}/sillas`, 0, 6, 40) // a tiny share: not a conflict
    ]
  });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Listo para IA', () => {
  it('scores every crawled page once, lists what fails most and crosses it with Search Console', async () => {
    const r = await app.inject(`/api/v1/sites/${siteId}/ai-readiness`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.summary.pages).toBe(3);
    const blog = b.pages.find((p: { url: string }) => p.url.endsWith('/mejores-sillas'));
    expect(blog).toMatchObject({ grade: 'bajo', impressions: 500 });
    expect(blog.failing).toEqual(expect.arrayContaining(['direct_answer', 'no_js', 'depth']));
    expect(b.summary.priority[0]).toBe(blog.url); // demand and a low score → first to fix
    expect(b.summary.byCheck[0]).toHaveProperty('label');
    expect(b.signals.robots.bots.length).toBeGreaterThan(5);
    expect(await prisma.aiReadinessPage.count()).toBe(3);
    await app.inject(`/api/v1/sites/${siteId}/ai-readiness`);
    expect(await prisma.aiReadinessPage.count()).toBe(3); // stored, not recomputed
  });
});

describe('Canibalización', () => {
  it('groups the same search, ranks conflicts and recommends what to do with each page', async () => {
    const b = (await app.inject(`/api/v1/sites/${siteId}/gsc/cannibalization`)).json();
    expect(b.conflicts.map((c: { query: string }) => c.query).sort()).toEqual(['silla ergonómica', 'sillas de oficina']);
    const c = b.conflicts.find((x: { query: string }) => x.query === 'sillas de oficina');
    expect(c).toMatchObject({ severity: 'alta', impressions: 700, winner: `${O}/sillas` });
    expect(c.actions[0].action).toMatch(/fusiona|redirige/i); // similar titles: same topic
    expect(b.pairs[0]).toMatchObject({ count: 2 });
    expect(b.totals).toMatchObject({ conflicts: 2, pagesInvolved: 2 });
    // Stricter threshold: nothing qualifies.
    expect((await app.inject(`/api/v1/sites/${siteId}/gsc/cannibalization?minImpressions=1000`)).json().conflicts).toEqual([]);
  });
});
