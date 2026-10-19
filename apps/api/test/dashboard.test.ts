import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let siteId: string;
const T = 'https://desk.example.com';

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Desk', domain: 'desk.example.com', canonicalUrl: T } })).json().id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Overview desk', () => {
  it('is empty for a new site, without failing', async () => {
    const d = (await app.inject(`/api/v1/sites/${siteId}/dashboard`)).json();
    expect(d).toMatchObject({ site: { name: 'Desk' }, crawl: null, gsc: null, ga4: null, vitals: null, serp: null, experiments: null, gaps: null, agents: null });
  });

  it('summarises every module from stored data', async () => {
    const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', urlsCrawled: 3, config: {} } });
    await prisma.crawledPage.createMany({
      data: [200, 200, 404].map((statusCode, i) => ({ crawlRunId: run.id, url: `${T}/${i}`, finalUrl: `${T}/${i}`, statusCode, responseTimeMs: 1, isIndexable: statusCode === 200 }))
    });
    await prisma.issue.create({ data: { siteId, crawlRunId: run.id, type: 'BROKEN_LINK', severity: 'HIGH', title: 'Rotos', description: 'x', recommendation: 'y', affectedUrls: [`${T}/2`] } }).catch(() => undefined);
    await prisma.aiReadinessPage.create({ data: { crawlRunId: run.id, url: `${T}/0`, score: 70, grade: 'Bien', checks: [] } });
    const imp = await prisma.gscImport.create({ data: { siteId, property: `${T}/`, startDate: '2026-08-01', endDate: '2026-09-25', status: 'completed' } });
    const days = Array.from({ length: 56 }, (_, i) => new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10));
    await prisma.gscDailyStat.createMany({ data: days.map((date, i) => ({ importId: imp.id, date, clicks: i < 28 ? 10 : 15, impressions: 100, ctr: 0.1, position: 5 })) });
    await prisma.performanceRun.create({ data: { siteId, url: `${T}/`, strategy: 'mobile', source: 'psi', status: 'ok', performanceScore: 40, fieldLcp: 2000, fieldInp: 150, fieldCls: 0.05 } });
    await prisma.seoExperiment.create({ data: { siteId, name: 'Títulos', changeDate: '2026-08-20', testUrls: [`${T}/0`], analysis: { verdict: 'positive', effect: { clicks: 0.3 } } } });

    const d = (await app.inject(`/api/v1/sites/${siteId}/dashboard`)).json();
    expect(d.crawl).toMatchObject({ pages: 3, indexable: 2, errors4xx: 1, aiReadiness: { average: 70, pages: 1 } });
    expect(d.gsc).toMatchObject({ clicks: 420, impressions: 2800, position: 5, until: '2026-09-25' });
    expect(d.gsc.clicksChange).toBeCloseTo(0.5);
    expect(d.vitals).toMatchObject({ urls: 1, avgScore: 40, slow: 1, fieldPages: 1, fieldPassing: 1 });
    expect(d.experiments).toMatchObject({ total: 1, positive: 1, latest: [{ name: 'Títulos', verdict: 'positive', effect: 0.3 }] });
  });

  it('is readable by viewers of the workspace', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/dashboard`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
  });
});
