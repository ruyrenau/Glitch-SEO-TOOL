import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockPsi } from '@glitch/testing';
import { buildAuthedApp, waitForJob } from './helpers';

let app: FastifyInstance;
let psi: Awaited<ReturnType<typeof startMockPsi>>;
let siteId: string;

beforeAll(async () => {
  psi = await startMockPsi();
  process.env.PSI_API_URL = psi.url;
  process.env.PSI_API_KEY = 'test-key';
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Perf', domain: 'perf.example.com', canonicalUrl: 'https://perf.example.com' } })).json().id;
});
afterAll(async () => {
  delete process.env.PSI_API_URL;
  delete process.env.PSI_API_KEY;
  await app.close();
  await psi.close();
  await prisma.$disconnect();
});

describe('Core Web Vitals (PageSpeed Insights mock)', () => {
  it('suggests the homepage when there is no crawl yet', async () => {
    const c = (await app.inject(`/api/v1/sites/${siteId}/performance/candidates`)).json();
    expect(c).toEqual([expect.objectContaining({ url: 'https://perf.example.com/' })]);
  });

  it('rejects URLs of other hosts', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/performance`, payload: { urls: ['https://evil.example/'] } });
    expect(r.json().error.code).toBe('FOREIGN_URL');
  });

  it('measures URLs × strategies in the worker and keeps field and lab data apart', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/performance`, payload: { urls: ['https://perf.example.com/', 'https://perf.example.com/nofield'], strategies: ['mobile', 'desktop'] } });
    expect(r.statusCode).toBe(202);
    const job = await waitForJob(app, r.json().jobId);
    expect(job).toMatchObject({ status: 'COMPLETED', result: { measured: 4, failed: 0 } });
    expect(psi.requests.every(x => x.endsWith('key=true'))).toBe(true);

    const data = (await app.inject(`/api/v1/sites/${siteId}/performance`)).json();
    expect(data.config).toEqual({ psiConfigured: true, source: 'psi' });
    expect(data.items).toHaveLength(4);
    const home = data.items.find((i: { latest: { url: string; strategy: string } }) => i.latest.url === 'https://perf.example.com/' && i.latest.strategy === 'mobile').latest;
    expect(home).toMatchObject({ source: 'psi', performanceScore: 62, labLcp: 3900, fieldStatus: 'available', fieldScope: 'url', fieldLcp: 2900, fieldInp: 180, fieldCls: 0.12 });
    const nofield = data.items.find((i: { latest: { url: string } }) => i.latest.url.endsWith('/nofield')).latest;
    expect(nofield).toMatchObject({ fieldStatus: 'insufficient-data', fieldLcp: null, labLcp: 3900 });
  });

  it('stops on quota errors instead of hammering the API', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/performance`, payload: { urls: ['https://perf.example.com/quota', 'https://perf.example.com/after'] } });
    const job = await waitForJob(app, r.json().jobId);
    expect(job.status).toBe('FAILED');
    expect(job.error).toMatch(/quota/i);
    expect(psi.requests.some(x => x.includes('/after'))).toBe(false);
    const failed = await prisma.performanceRun.findFirst({ where: { siteId, url: 'https://perf.example.com/quota' } });
    expect(failed).toMatchObject({ status: 'failed' });
  });

  it('allows one measurement at a time per site', async () => {
    const a = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/performance`, payload: {} });
    const b = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/performance`, payload: {} });
    expect(b.json().error.code).toBe('PERFORMANCE_RUNNING');
    await waitForJob(app, a.json().jobId);
  });
});
