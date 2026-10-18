import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { getQueue } from '@glitch/jobs';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let siteId: string;
const origin = 'https://monitor.example.com';
const DAY = 86400_000;
const iso = (d: number) => new Date(d).toISOString().slice(0, 10);

/** Two full crawls: the newer one has 12 fewer indexable pages and 2 new 5xx errors. */
async function seedCrawls() {
  const mk = async (startedAt: Date, indexable: number, e5: number) => {
    const run = await prisma.crawlRun.create({ data: { siteId, status: 'completed', mode: 'site', startedAt, completedAt: startedAt, urlsCrawled: indexable + e5, issuesFound: 3, config: {} } });
    await prisma.crawledPage.createMany({
      data: [
        ...Array.from({ length: indexable }, (_, i) => ({ crawlRunId: run.id, url: `${origin}/p/${i}`, finalUrl: `${origin}/p/${i}`, statusCode: 200, responseTimeMs: 200, mimeType: 'text/html', sizeBytes: 1000, isIndexable: true, depth: 1 })),
        ...Array.from({ length: e5 }, (_, i) => ({ crawlRunId: run.id, url: `${origin}/e/${i}`, finalUrl: `${origin}/e/${i}`, statusCode: 500, responseTimeMs: 200, mimeType: 'text/html', sizeBytes: 100, isIndexable: false, depth: 1 }))
      ]
    });
    return run;
  };
  await mk(new Date(Date.now() - 9 * DAY), 100, 0);
  await mk(new Date(Date.now() - 2 * DAY), 88, 2);
}

/** 8 weeks of stable clicks (±3 %) and a last week 40 % lower; impressions stable. */
async function seedGsc() {
  await prisma.site.update({ where: { id: siteId }, data: { gscProperty: `${origin}/` } });
  const imp = await prisma.gscImport.create({ data: { siteId, property: `${origin}/`, startDate: iso(Date.now() - 58 * DAY), endDate: iso(Date.now() - 3 * DAY), status: 'completed', completedAt: new Date() } });
  const rows = Array.from({ length: 56 }, (_, i) => {
    const last = i >= 49;
    const clicks = last ? 60 : 100 + ((i * 7) % 7) - 3;
    return { importId: imp.id, date: iso(Date.now() - (58 - i) * DAY), clicks, impressions: 2000 + (i % 3) * 10, ctr: clicks / 2000, position: 6.2 };
  });
  await prisma.gscDailyStat.createMany({ data: rows });
  await prisma.gscPageStat.createMany({ data: [{ importId: imp.id, page: `${origin}/servicios`, clicks: 900, impressions: 20000, ctr: 0.045, position: 4 }] });
  // Something that happened in the same week as the drop.
  await prisma.alert.create({ data: { siteId, type: 'NOINDEX_ADDED', severity: 'CRITICAL', message: '12 páginas con noindex nuevo', createdAt: new Date(Date.now() - 6 * DAY) } });
}

/** /servicios on mobile: LCP 2.1 s → 3.4 s (field data). */
async function seedVitals() {
  const base = { siteId, url: `${origin}/servicios`, strategy: 'mobile', source: 'psi', status: 'ok', fieldStatus: 'available' };
  await prisma.performanceRun.create({ data: { ...base, performanceScore: 82, labLcp: 2300, fieldLcp: 2100, fieldInp: 150, fieldCls: 0.02, createdAt: new Date(Date.now() - 8 * DAY) } });
  await prisma.performanceRun.create({ data: { ...base, performanceScore: 61, labLcp: 3600, fieldLcp: 3400, fieldInp: 160, fieldCls: 0.03, createdAt: new Date(Date.now() - 1 * DAY), report: { issues: [{ title: 'Mejora la carga de la imagen principal', metrics: ['LCP'] }] } } });
}

beforeAll(async () => {
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Monitor', domain: 'monitor.example.com', canonicalUrl: origin } })).json().id;
});
afterAll(async () => {
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/monitor`, payload: { crawl: { enabled: false }, gsc: { enabled: false }, vitals: { enabled: false } } });
  await app.close();
  await prisma.$disconnect();
});

describe('Monitoreo', () => {
  it('everything is off until turned on', async () => {
    const s = (await app.inject(`/api/v1/sites/${siteId}/monitor`)).json();
    expect(s.crawl.enabled).toBe(false);
    expect(s.gsc.enabled).toBe(false);
    expect(s.vitals.enabled).toBe(false);
    expect(s.vitals.willMeasure).toEqual([origin]); // no data yet: the site's home page
  });

  it('turns on a weekly crawl and weekly Core Web Vitals, and refuses Search Console without a property', async () => {
    const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/monitor`, payload });
    expect((await put({ crawl: { enabled: false }, gsc: { enabled: true }, vitals: { enabled: false } })).json().error.code).toBe('GSC_NO_PROPERTY');
    expect((await put({ crawl: { enabled: false }, gsc: { enabled: false }, vitals: { enabled: true, urlMode: 'manual', urls: ['https://otro.example/x'] } })).json().error.code).toBe('FOREIGN_URL');

    const s = (await put({ crawl: { enabled: true, frequency: 'weekly', maxUrls: 1000 }, gsc: { enabled: false }, vitals: { enabled: true, frequency: 'weekly', count: 3, strategies: ['mobile', 'desktop'] } })).json();
    expect(s.crawl).toMatchObject({ enabled: true, frequency: 'weekly', maxUrls: 1000 });
    expect(s.crawl.nextRuns).toHaveLength(3);
    expect(s.vitals).toMatchObject({ enabled: true, frequency: 'weekly', count: 3, strategies: ['mobile', 'desktop'] });
    const schedulers = (await getQueue('performance').getJobSchedulers()).map(j => j.key);
    expect(schedulers).toContain(`site-vitals:${siteId}`);

    const off = (await put({ crawl: { enabled: false }, gsc: { enabled: false }, vitals: { enabled: false } })).json();
    expect(off.crawl.enabled).toBe(false);
    expect((await getQueue('performance').getJobSchedulers()).map(j => j.key)).not.toContain(`site-vitals:${siteId}`);
  });

  it('only operators can change it; everyone can read the analysis', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/monitor`, headers: { cookie: viewer.cookie }, payload: { crawl: { enabled: true }, gsc: { enabled: false }, vitals: { enabled: false } } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/sites/${siteId}/monitor/overview`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
  });

  it('explains what changed, with what happened at the same time, and ignores normal noise', async () => {
    await seedCrawls();
    await seedGsc();
    await seedVitals();
    const o = (await app.inject(`/api/v1/sites/${siteId}/monitor/overview`)).json();
    const ids = o.insights.map((i: { id: string }) => i.id);

    const clicks = o.insights.find((i: { id: string }) => i.id === 'gsc-clicks');
    expect(clicks).toMatchObject({ tone: 'bad', title: expect.stringMatching(/^Clics bajaron (3[5-9]|4[0-5]) % en la última semana$/) });
    expect(clicks.related.join(' ')).toMatch(/noindex nuevo/);
    expect(ids).not.toContain('gsc-impressions'); // within the usual variation

    expect(o.insights.find((i: { id: string }) => i.id === 'crawl-indexable')).toMatchObject({ tone: 'bad', title: '12 páginas dejaron de ser indexables', link: { nav: 'explorer', explorer: { tab: 'internal', filter: 'non-indexable' } } });
    expect(ids).toContain('crawl-5xx');

    const lcp = o.insights.find((i: { id: string }) => i.id.startsWith('vitals-lcp-'));
    expect(lcp.title).toBe('LCP móvil de /servicios empeoró: 2.1 s → 3.4 s');
    expect(lcp.detail).toMatch(/usuarios reales.*imagen principal/);
    expect(ids).toContain('alerts');
    expect(o.insights[0].tone).toBe('bad'); // worst first

    expect(o.gsc.daily).toHaveLength(56);
    expect(o.crawl.map((c: { indexable: number }) => c.indexable)).toEqual([100, 88]);
    expect(o.vitals[0]).toMatchObject({ strategy: 'mobile', fieldLcp: 2100 });
    expect(o.events.some((e: { kind: string }) => e.kind === 'alert')).toBe(true);
  });

  it('sends the important changes to a webhook once and never repeats them', async () => {
    const received: Array<Record<string, unknown>> = [];
    const hook = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>(r => hook.listen(0, '127.0.0.1', () => r()));
    process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
    const url = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
    try {
      const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/monitor/notifications`, payload });
      expect((await put({ enabled: true, level: 'bad' })).json().error.code).toBe('WEBHOOK_REQUIRED');
      expect((await put({ enabled: true, level: 'bad', webhookUrl: 'http://ejemplo.com/hook' })).json().error.code).toBe('INVALID_WEBHOOK');
      const cfg = (await put({ enabled: true, level: 'bad', webhookUrl: url })).json();
      expect(cfg).toMatchObject({ enabled: true, configured: true, hint: expect.stringMatching(/^webhook …/) });
      expect(JSON.stringify(cfg)).not.toContain('127.0.0.1');

      expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/monitor/notifications/test` })).statusCode).toBe(200);
      expect(received[0]).toMatchObject({ source: 'G.SEO', message: 'Prueba de conexión.' });

      const first = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/monitor/notifications/send` })).json();
      expect(first.sent).toBeGreaterThanOrEqual(3); // clicks drop, indexable drop, 5xx, LCP, alerts…
      const msg = received[1] as { items: Array<{ tone: string; title: string }> };
      expect(msg.items.every(i => i.tone === 'bad')).toBe(true);
      expect(msg.items.map(i => i.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Clics bajaron/), '12 páginas dejaron de ser indexables']));

      const again = (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/monitor/notifications/send` })).json();
      expect(again).toMatchObject({ sent: 0, reason: 'nothing-new' }); // not repeated
      const list = (await app.inject(`/api/v1/sites/${siteId}/monitor/notifications`)).json();
      expect(list.sent.length).toBe(first.sent);
    } finally {
      delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
      await new Promise<void>(r => hook.close(() => r()));
    }
  });

  it('measures the pages with most Search Console clicks', async () => {
    const s = (await app.inject(`/api/v1/sites/${siteId}/monitor`)).json();
    expect(s.vitals.willMeasure).toEqual([`${origin}/servicios`]);
  });
});
