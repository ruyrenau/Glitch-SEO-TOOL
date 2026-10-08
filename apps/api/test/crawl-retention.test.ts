import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, purgeOldCrawlDetail } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';
import { buildAuthedApp, waitForJob } from './helpers';

let app: FastifyInstance;
let site: FixtureSite;
let siteId: string;
const runs: string[] = [];

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  process.env.CRAWL_DETAIL_KEEP = '2';
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Retention', domain: '127.0.0.1', canonicalUrl: site.origin } })).json().id;
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4 } });
    runs.push(((await waitForJob(app, r.json().jobId)).result as { crawlRunId: string }).crawlRunId);
  }
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  delete process.env.CRAWL_DETAIL_KEEP;
  await app.close();
  await site.close();
  await prisma.$disconnect();
});

const detail = async (id: string) => ({
  html: await prisma.crawledPage.count({ where: { crawlRunId: id, htmlGz: { not: null } } }),
  links: await prisma.crawledLink.count({ where: { crawlRunId: id } }),
  resources: await prisma.crawledResource.count({ where: { crawlRunId: id } }),
  pages: await prisma.crawledPage.count({ where: { crawlRunId: id } }),
  run: await prisma.crawlRun.findUniqueOrThrow({ where: { id } })
});

describe('crawl detail retention', () => {
  it('keeps full detail for the newest crawls and drops it from older ones after each crawl', async () => {
    const [oldest, middle, newest] = await Promise.all(runs.map(detail));
    expect(oldest.run.detailPurgedAt).not.toBeNull();
    expect(oldest).toMatchObject({ html: 0, links: 0, resources: 0 });
    expect(oldest.pages).toBeGreaterThan(10); // page summaries stay
    for (const d of [middle, newest]) {
      expect(d.run.detailPurgedAt).toBeNull();
      expect(d.html).toBeGreaterThan(0);
      expect(d.links).toBeGreaterThan(0);
      expect(d.resources).toBeGreaterThan(0);
    }
  });

  it('keeps the explorer working on a purged crawl and says what is missing', async () => {
    const s = await app.inject(`/api/v1/crawls/${runs[0]}/explorer/summary`);
    expect(s.statusCode).toBe(200);
    const titles = s.json().tabs.find((t: { id: string }) => t.id === 'titles');
    expect(titles.filters.find((f: { id: string }) => f.id === 'duplicate').count).toBe(2);
    const runRow = (await app.inject(`/api/v1/sites/${siteId}/crawls`)).json().find((r: { id: string }) => r.id === runs[0]);
    expect(runRow.detailPurgedAt).toBeTruthy();
    const custom = (await app.inject({ method: 'POST', url: `/api/v1/crawls/${runs[0]}/explorer/custom`, payload: { search: [{ name: 'x', mode: 'contains', pattern: 'a' }] } })).json();
    expect(custom.scanned).toBe(0);
  });

  it('is idempotent and audited', async () => {
    expect((await purgeOldCrawlDetail({ siteId })).runsPurged).toBe(0);
    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toContain('crawl.detail_purged');
  });
});
