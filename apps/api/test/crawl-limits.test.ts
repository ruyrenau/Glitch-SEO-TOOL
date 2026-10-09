import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';
import { buildAuthedApp, waitForJob } from './helpers';

let app: FastifyInstance;
let site: FixtureSite;
let siteId: string;

const crawl = async (payload: object) => {
  const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, ...payload } });
  expect(r.statusCode).toBe(202);
  const job = await waitForJob(app, r.json().jobId);
  return prisma.crawlRun.findUniqueOrThrow({ where: { id: (job.result as { crawlRunId: string }).crawlRunId } });
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Limits', domain: '127.0.0.1', canonicalUrl: site.origin } })).json().id;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await site.close();
  await prisma.$disconnect();
});

describe('crawl limits and list mode through the API', () => {
  it('validates the new options', async () => {
    const bad = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload });
    expect((await bad({ listUrls: ['https://otro.example/a'] })).json().error.code).toBe('FOREIGN_URL');
    expect((await bad({ maxRedirects: 99 })).statusCode).toBe(400);
    expect((await bad({ maxPageSizeKb: 1 })).statusCode).toBe(400);
  });

  it('records which limits skipped URLs and marks the crawl as partial', async () => {
    const run = await crawl({ maxUrlsPerFolder: 2, maxPageSizeKb: 512 });
    const cfg = run.config as { partial: boolean; skipped: Record<string, number>; maxBodyBytes: number };
    expect(run.mode).toBe('site');
    expect(cfg.skipped.maxUrlsPerFolder).toBeGreaterThan(0); // /deep/1…/deep/6 share a folder
    expect(cfg.partial).toBe(true);
    expect(cfg.maxBodyBytes).toBe(512 * 1024);
  });

  it('a list crawl touches neither the issue list nor the alerts, and is never a diff baseline', async () => {
    const full = await crawl({});
    const issuesBefore = await prisma.issue.findMany({ where: { siteId }, select: { code: true, status: true } });
    expect(issuesBefore.length).toBeGreaterThan(5);

    const list = await crawl({ listUrls: [`${site.origin}/about`, `${site.origin}/missing`] });
    expect(list.mode).toBe('list');
    expect(list.urlsCrawled).toBe(2);
    expect(await prisma.issue.findMany({ where: { siteId }, select: { code: true, status: true } })).toEqual(issuesBefore);
    expect(await prisma.alert.count({ where: { crawlRunId: list.id } })).toBe(0);

    // The next full crawl is compared with the previous full crawl, not with the 2-URL list: no "pages removed".
    const next = await crawl({});
    const d = (await app.inject(`/api/v1/crawls/${next.id}/diff`)).json();
    expect(d.base.id).toBe(full.id);
    expect(d.counts.PAGE_REMOVED ?? 0).toBe(0);
    expect(d.counts.PAGE_ADDED ?? 0).toBe(0);
    expect(await prisma.alert.count({ where: { crawlRunId: next.id } })).toBe(0); // same site, nothing regressed
  });
});
