import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';

let app: FastifyInstance;
let site: FixtureSite;
let siteId: string;

const waitForCrawl = async (runId: string) => {
  for (let i = 0; i < 100; i++) {
    const runs = (await app.inject(`/api/v1/sites/${siteId}/crawls`)).json() as Array<{ id: string; status: string }>;
    const run = runs.find(r => r.id === runId);
    if (run && run.status !== 'running') return run;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('crawl did not finish');
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = await startFixtureSite();
  app = await buildApp({ logger: false });
  const res = await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Fixture', domain: '127.0.0.1', canonicalUrl: site.origin } });
  siteId = res.json().id;
  await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/sitemap`, headers: { 'content-type': 'application/xml' }, payload: site.sitemapXml });
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await site.close();
  await prisma.$disconnect();
});

describe('crawl API (integration)', () => {
  let runId: string;

  it('validates options and rejects unknown fields', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { maxUrls: 99999 } });
    expect(r.statusCode).toBe(400);
    const bad = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { exclude: ['('] } });
    expect(bad.json().error.code).toBe('INVALID_PATTERN');
  });

  it('starts a background crawl and refuses a second concurrent one', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, maxDepth: 10 } });
    expect(r.statusCode).toBe(202);
    runId = r.json().id;
    const again = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: {} });
    expect(again.statusCode).toBe(409);
    const run = await waitForCrawl(runId);
    expect(run.status).toBe('completed');
  });

  it('stores pages with filters and pagination', async () => {
    const all = (await app.inject(`/api/v1/crawls/${runId}/pages?pageSize=200`)).json();
    expect(all.total).toBeGreaterThan(20);
    const errors = (await app.inject(`/api/v1/crawls/${runId}/pages?status=error`)).json();
    expect(errors.items.map((p: { url: string }) => p.url.replace(site.origin, ''))).toEqual(expect.arrayContaining(['/missing', '/error', '/loop-a']));
    const orphan = all.items.find((p: { url: string }) => p.url.endsWith('/orphan'));
    expect(orphan).toMatchObject({ inSitemap: true, inlinks: 0, isIndexable: true });
    const page2 = (await app.inject(`/api/v1/crawls/${runId}/pages?pageSize=5&page=2`)).json();
    expect(page2.items).toHaveLength(5);
  });

  it('persists prioritized issues and keeps "ignored" across crawls', async () => {
    const issues = (await app.inject(`/api/v1/sites/${siteId}/issues`)).json() as Array<{ id: string; code: string; status: string; priorityScore: number }>;
    expect(issues.length).toBeGreaterThanOrEqual(25);
    expect((issues[0] as unknown as { severity: string }).severity).toBe('CRITICAL');
    const thin = issues.find(i => i.code === 'CONTENT_THIN')!;
    const ignored = await app.inject({ method: 'POST', url: `/api/v1/issues/${thin.id}/status`, payload: { status: 'ignored' } });
    expect(ignored.json().status).toBe('ignored');

    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, maxDepth: 10 } });
    await waitForCrawl(r.json().id);
    const after = (await app.inject(`/api/v1/sites/${siteId}/issues`)).json() as Array<{ code: string; status: string }>;
    expect(after.find(i => i.code === 'CONTENT_THIN')?.status).toBe('ignored');
    expect(after.filter(i => i.code === 'HTTP_5XX')).toHaveLength(1); // upserted, not duplicated
  });

  it('resolves issues that disappear when the crawl scope changes', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, maxDepth: 0, seedFromSitemap: false } });
    await waitForCrawl(r.json().id);
    const issues = (await app.inject(`/api/v1/sites/${siteId}/issues?status=resolved`)).json() as Array<{ code: string }>;
    expect(issues.map(i => i.code)).toContain('HTTP_5XX');
  });

  it('writes crawl events to the audit log', async () => {
    const actions = (await app.inject('/api/v1/audit-events?limit=500')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['crawl.started', 'crawl.completed', 'issue.status_changed']));
  });
});
