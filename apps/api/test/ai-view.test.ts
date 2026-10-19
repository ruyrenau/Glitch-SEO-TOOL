import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startFixtureSite, FixtureSite } from '@glitch/testing';
import { buildAuthedApp, waitForJob } from './helpers';

let app: FastifyInstance;
let site: FixtureSite;
let siteId: string;
let runId: string;

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = await startFixtureSite();
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'Sitio IA', domain: '127.0.0.1', canonicalUrl: site.origin } })).json().id;
  const job = await waitForJob(app, (await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/crawls`, payload: { rps: 20, concurrency: 4, maxDepth: 10 } })).json().jobId);
  runId = (job.result as { crawlRunId: string }).crawlRunId;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await site.close();
  await prisma.$disconnect();
});

describe('Vista de bot de IA', () => {
  it('returns clean Markdown and RAG chunks of a crawled page', async () => {
    const about = await prisma.crawledPage.findFirstOrThrow({ where: { crawlRunId: runId, url: `${site.origin}/about` } });
    const r = await app.inject(`/api/v1/crawls/${runId}/explorer/pages/${about.id}/ai-view?size=256`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.source).toBe('stored-raw');
    expect(b.bot.markdown).toContain('# Nosotros');
    expect(b.bot.chunks.length).toBeGreaterThan(0);
    expect(b.bot.chunks[0].headings).toEqual(['Nosotros']);
    expect(b.bot.chunks.every((c: { tokens: number }) => c.tokens <= 320)).toBe(true);
    expect(b.withJs).toBeNull();
    expect(b.flags['split-table'].label).toBe('Tabla partida');
  });
});

describe('llms.txt', () => {
  it('validates the live file against the format and the crawl', async () => {
    const b = (await app.inject(`/api/v1/sites/${siteId}/llms-txt`)).json();
    expect(b).toMatchObject({ found: true, fullFound: false });
    const by = Object.fromEntries(b.result.checks.map((c: { id: string }) => [c.id, c]));
    expect(by.h1.ok).toBe(true);
    expect(by.summary.ok).toBe(true);
    expect(by.format.ok).toBe(false); // "- Contacto sin enlace"
    expect(by.broken.ok).toBe(false);
    const status = Object.fromEntries(b.result.links.map((l: { text: string; status: string }) => [l.text, l.status]));
    expect(status).toEqual({ Nosotros: 'ok', Rota: 'broken', Vieja: 'non-indexable', 'Nunca enlazada': 'not-crawled' });
  });

  it('generates llms.txt and llms-full.txt from the crawl, only with indexable pages', async () => {
    const g = (await app.inject(`/api/v1/sites/${siteId}/llms-txt/generate?summary=${encodeURIComponent('Agencia de SEO técnico.')}`)).json();
    expect(g.text.startsWith('# Sitio IA\n\n> Agencia de SEO técnico.\n')).toBe(true);
    expect(g.text).toMatch(/^## /m);
    expect(g.text).toContain(`(${site.origin}/about)`);
    expect(g.text).not.toContain('/noindex-page');
    expect(g.text).not.toContain('/missing');
    expect(g.links).toBeGreaterThan(0);
    const dl = await app.inject(`/api/v1/sites/${siteId}/llms-txt/generate?download=llms`);
    expect(dl.headers['content-type']).toContain('text/plain');
    expect(dl.headers['content-disposition']).toContain('llms.txt');
    const full = await app.inject(`/api/v1/sites/${siteId}/llms-txt/generate?download=full&fullPages=5`);
    expect(full.headers['content-disposition']).toContain('llms-full.txt');
    expect(full.body).toContain('URL: ');
    expect(full.body).toContain('### Nosotros');
  });
});
