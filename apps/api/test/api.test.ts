import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp } from './helpers';
import { prisma } from '@glitch/db';

const fixture = fs.readFileSync(path.resolve(__dirname, '../../../fixtures/sample_nginx.log'));
let app: FastifyInstance;
let siteId: string;

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('API v1 (integration, real SQLite)', () => {
  it('reports readiness from a real DB query', async () => {
    const r = await app.inject('/health/ready');
    expect(r.statusCode).toBe(200);
    expect(r.json().db).toBe('ok');
  });

  it('creates a site and rejects unknown fields', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'x', domain: 'x.com', canonicalUrl: 'https://x.com', status: 'hacked' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    expect(bad.json().error.correlationId).toBeTruthy();

    const ok = await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Test', domain: 'test.example.com', canonicalUrl: 'https://test.example.com/' } });
    expect(ok.statusCode).toBe(201);
    siteId = ok.json().id;
    expect(ok.json().sitemapUrl).toBe('https://test.example.com/sitemap.xml');
  });

  it('returns 404 NO_LOG_DATA before any import', async () => {
    const r = await app.inject(`/api/v1/sites/${siteId}/log-report`);
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NO_LOG_DATA');
  });

  it('imports a gzipped log, rejects the duplicate and builds a report', async () => {
    const gz = zlib.gzipSync(fixture);
    const up = (fileName: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/sites/${siteId}/log-imports?fileName=${encodeURIComponent(fileName)}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: gz
      });

    const first = await up('access.log.gz');
    expect(first.statusCode).toBe(201);
    expect(first.json().analysis.validLines).toBe(5);

    const dup = await up('access-copy.log.gz');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_IMPORT');

    const report = (await app.inject(`/api/v1/sites/${siteId}/log-report`)).json();
    expect(report.totals.googlebotRequests).toBe(2);
    expect(report.bot4xx).toEqual([{ path: '/old-landing-page', hits: 1 }]);
    expect(JSON.stringify(report)).not.toContain('secret123');
    expect(JSON.stringify(report)).not.toContain('20.171.207.0');
  });

  it('rejects disallowed file names', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/log-imports?fileName=..%2F..%2Fpayload.exe`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: fixture
    });
    expect(r.statusCode).toBe(415);
  });

  it('cross-references an uploaded sitemap with bot hits', async () => {
    const xml = `<urlset><url><loc>https://test.example.com/blog/seo-best-practices</loc></url><url><loc>https://test.example.com/never-visited</loc></url></urlset>`;
    const s = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/sitemap`, headers: { 'content-type': 'application/xml' }, payload: xml });
    expect(s.json().urls).toBe(2);
    const cov = (await app.inject(`/api/v1/sites/${siteId}/log-report`)).json().sitemapCoverage;
    expect(cov.neverCrawledByGooglebot).toEqual(['/never-visited']);
    expect(cov.crawledNotInSitemap.map((u: { path: string }) => u.path)).toContain('/features/pricing');
  });

  it('blocks SSRF when fetching a sitemap by URL', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/sitemap`, payload: { url: 'http://169.254.169.254/latest/meta-data' } });
    expect(r.statusCode).toBe(422);
    expect(JSON.stringify(r.json())).toContain('Blocked private');
  });

  it('exports CSV', async () => {
    const r = await app.inject(`/api/v1/sites/${siteId}/log-report.csv`);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body.split('\n')[0]).toBe('date,bot,category,status,path,hits,avgResponseMs');
  });

  it('requires explicit confirmation to delete and audits it', async () => {
    const imports = (await app.inject(`/api/v1/sites/${siteId}/log-imports`)).json();
    const id = imports[0].id;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/log-imports/${id}` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/log-imports/${id}?confirm=true` })).statusCode).toBe(204);
    const actions = (await app.inject('/api/v1/audit-events')).json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['site.created', 'log_import.created', 'sitemap.imported', 'log_import.deleted']));
  });

  it('does not serve Search Console demo data outside demo mode', async () => {
    expect((await app.inject('/api/v1/search-console/metrics')).statusCode).toBe(501);
  });
});
