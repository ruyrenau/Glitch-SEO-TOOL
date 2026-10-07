import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp } from './helpers';
import { prisma } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';

let app: FastifyInstance;
let site: FixtureSite;
let siteId: string;
let hook: http.Server;
const received: unknown[] = [];

const crawl = async () => {
  const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, maxDepth: 10 } });
  const id = r.json().id as string;
  for (let i = 0; i < 100; i++) {
    const runs = (await app.inject(`/api/v1/sites/${siteId}/crawls`)).json() as Array<{ id: string; status: string }>;
    if (runs.find(x => x.id === id)?.status !== 'running') return id;
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error('crawl did not finish');
};

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise<void>(r => hook.listen(0, '127.0.0.1', r));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Alerts', domain: '127.0.0.1', canonicalUrl: site.origin } })).json().id;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  delete process.env.ALERT_WEBHOOK_URL;
  await app.close();
  await site.close();
  await new Promise(r => hook.close(r));
  await prisma.$disconnect();
});

describe('crawl diff and alerts (integration)', () => {
  let first: string;
  let second: string;

  it('has no baseline after the first crawl', async () => {
    first = await crawl();
    expect((await app.inject(`/api/v1/crawls/${first}/diff`)).json().error.code).toBe('NO_BASELINE');
    expect((await app.inject(`/api/v1/sites/${siteId}/alerts`)).json()).toEqual([]);
  });

  it('detects a bad deploy between crawls', async () => {
    site.setVersion(2);
    second = await crawl();
    const diff = (await app.inject(`/api/v1/crawls/${second}/diff`)).json();
    expect(diff.base.id).toBe(first);
    const byType = (t: string) => diff.changes.filter((c: { type: string }) => c.type === t).map((c: { url: string }) => c.url.replace(site.origin, ''));
    expect(byType('NOINDEX_ADDED')).toEqual(['/about']);
    expect(byType('CANONICAL_CHANGED')).toEqual(['/dup-a']);
    expect(byType('PAGE_BROKEN')).toEqual(['/products?sort=asc']);
    expect(byType('CONTENT_SHRUNK')).toEqual(['/']);
    expect(byType('SCHEMA_REMOVED').sort()).toEqual(['/', '/about']); // v2 /about also dropped its AboutPage JSON-LD
    expect(byType('ROBOTS_BLOCKED_NEW')).toEqual(expect.arrayContaining(['/deep/1']));
    const onlyCanon = (await app.inject(`/api/v1/crawls/${second}/diff?type=CANONICAL_CHANGED`)).json();
    expect(onlyCanon.totalChanges).toBe(1);
  });

  it('stores alerts, delivers them to the webhook and lets people acknowledge them', async () => {
    const alerts = (await app.inject(`/api/v1/sites/${siteId}/alerts?status=open`)).json() as Array<{ id: string; type: string; severity: string; deliveredTo: Array<{ ok: boolean }> }>;
    const types = alerts.map(a => a.type);
    expect(types).toEqual(expect.arrayContaining(['NOINDEX_ADDED', 'PAGE_BROKEN', 'BECAME_NON_INDEXABLE', 'CANONICAL_CHANGED', 'ROBOTS_BLOCKED_NEW', 'CONTENT_SHRUNK', 'SCHEMA_REMOVED', 'ROBOTS_CHANGED']));
    expect(alerts.find(a => a.type === 'NOINDEX_ADDED')?.severity).toBe('CRITICAL');
    expect(alerts[0].deliveredTo).toEqual([expect.objectContaining({ channel: 'webhook', ok: true })]);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received[0])).toContain('NOINDEX_ADDED');

    const ack = await app.inject({ method: 'POST', url: `/api/v1/alerts/${alerts[0].id}/acknowledge` });
    expect(ack.json().status).toBe('acknowledged');
    const open = (await app.inject(`/api/v1/sites/${siteId}/alerts?status=open`)).json();
    expect(open).toHaveLength(alerts.length - 1);
  });

  it('does not alert again when nothing changed', async () => {
    const before = (await app.inject(`/api/v1/sites/${siteId}/alerts`)).json().length;
    await crawl();
    expect((await app.inject(`/api/v1/sites/${siteId}/alerts`)).json()).toHaveLength(before);
  });
});
