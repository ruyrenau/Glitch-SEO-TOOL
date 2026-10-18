import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let siteId: string;

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Cliente Demo', domain: 'cliente.example.com', canonicalUrl: 'https://cliente.example.com' } })).json().id;
  // Some data for the sections: a crawl, an AI visibility check with a pasted answer, a Core Web Vitals run.
  const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, issuesFound: 1, config: {} } });
  await prisma.crawledPage.createMany({ data: [200, 200, 404].map((s, i) => ({ crawlRunId: run.id, url: `https://cliente.example.com/p${i}`, finalUrl: `https://cliente.example.com/p${i}`, statusCode: s, responseTimeMs: 100, mimeType: 'text/html', sizeBytes: 1, isIndexable: s === 200, depth: 1 })) });
  await prisma.issue.create({ data: { siteId, crawlRunId: run.id, code: 'HTTP_4XX', category: 'CRAWL', title: 'Páginas rotas', description: 'x', recommendation: 'y', severity: 'HIGH', affectedUrlsCount: 1 } });
  const p = await prisma.aiPrompt.create({ data: { siteId, text: '¿Mejor agencia de SEO en Puebla?', keyword: 'Agencia' } });
  await prisma.aiObservation.create({ data: { siteId, promptId: p.id, engine: 'chatgpt', date: '2026-10-12', mentioned: true, mentionPos: 1, mentionText: 'TEXTO INTERNO PEGADO', cited: false } });
  await prisma.performanceRun.create({ data: { siteId, url: 'https://cliente.example.com/', strategy: 'mobile', source: 'psi', status: 'ok', performanceScore: 88, labLcp: 2100, fieldStatus: 'not-requested', report: { grade: { letter: 'B' } } } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('client reports', () => {
  let report: { id: string; token: string };

  it('creates a frozen snapshot of the chosen sections', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/reports`, payload: { sections: [] } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/reports`, payload: { title: 'Reporte de octubre', sections: ['summary', 'crawl', 'vitals', 'ai', 'gsc'], expiresDays: 30 } });
    expect(r.statusCode).toBe(201);
    report = r.json();
    expect(report.token.length).toBeGreaterThanOrEqual(30);
    const snap = r.json().snapshot;
    expect(snap.site).toEqual({ name: 'Cliente Demo', url: 'https://cliente.example.com' });
    expect(snap.crawl).toMatchObject({ urls: 3, indexable: 2, errors4xx: 1, openIssues: 1, issues: [{ title: 'Páginas rotas', severity: 'HIGH' }] });
    expect(snap.vitals).toEqual([expect.objectContaining({ url: 'https://cliente.example.com/', score: 88, grade: 'B' })]);
    expect(snap.ai.rows[0]).toMatchObject({ text: '¿Mejor agencia de SEO en Puebla?', cells: { chatgpt: { total: 5 } } });
    expect(snap.gsc).toBeNull(); // no Search Console data: the section says so instead of inventing numbers
    expect(snap.monitor).toBeUndefined(); // not chosen
    expect(JSON.stringify(snap)).not.toContain('TEXTO INTERNO PEGADO'); // pasted answers never leave the tool
    // The list does not carry the heavy snapshot.
    const list = (await app.inject(`/api/v1/sites/${siteId}/reports`)).json();
    expect(list[0]).toMatchObject({ title: 'Reporte de octubre' });
    expect(list[0].snapshot).toBeUndefined();
  });

  it('serves the public link without login, counts views, and stops after revoke or expiry', async () => {
    const pub = await app.inject({ url: `/api/v1/public/reports/${report.token}`, headers: { cookie: '' } });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ title: 'Reporte de octubre', snapshot: { site: { name: 'Cliente Demo' } } });
    expect((await prisma.reportShare.findUniqueOrThrow({ where: { id: report.id } })).views).toBe(1);
    expect((await app.inject({ url: '/api/v1/public/reports/not-a-real-token-123456789', headers: { cookie: '' } })).statusCode).toBe(404);

    await prisma.reportShare.update({ where: { id: report.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await app.inject({ url: `/api/v1/public/reports/${report.token}`, headers: { cookie: '' } })).statusCode).toBe(404);
    await prisma.reportShare.update({ where: { id: report.id }, data: { expiresAt: null } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/reports/${report.id}` })).json()).toEqual({ revoked: true });
    expect((await app.inject({ url: `/api/v1/public/reports/${report.token}`, headers: { cookie: '' } })).statusCode).toBe(404);
  });

  it('only operators create or revoke reports; other private report routes need a session', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/reports`, headers: { cookie: viewer.cookie }, payload: { sections: ['summary'] } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/reports`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/reports`, headers: { cookie: '' } })).statusCode).toBe(401);
    const actions = (await app.inject('/api/v1/audit-events?limit=200')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['report.created', 'report.revoked']));
  });
});
