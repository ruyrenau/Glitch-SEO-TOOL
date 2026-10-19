import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockCrux } from '@glitch/testing';
import { buildAuthedApp } from './helpers';

let app: FastifyInstance;
let mock: Awaited<ReturnType<typeof startMockCrux>>;
let siteId: string;
const saved = { key: process.env.CRUX_API_KEY, url: process.env.CRUX_API_URL };

beforeAll(async () => {
  mock = await startMockCrux();
  process.env.CRUX_API_URL = mock.url;
  process.env.CRUX_API_KEY = 'test-key';
  ({ app } = await buildAuthedApp());
  siteId = (await app.inject({ method: 'POST', url: '/api/v1/sites', payload: { name: 'CrUX', domain: 'crux.example.com', canonicalUrl: 'https://crux.example.com/' } })).json().id;
});
afterAll(async () => {
  process.env.CRUX_API_KEY = saved.key;
  process.env.CRUX_API_URL = saved.url;
  if (saved.key === undefined) delete process.env.CRUX_API_KEY;
  if (saved.url === undefined) delete process.env.CRUX_API_URL;
  await app.close();
  await mock.close();
  await prisma.$disconnect();
});

describe('CrUX field data', () => {
  it('returns weekly history for the origin and a URL, rated against the Core Web Vitals thresholds', async () => {
    const r = (await app.inject(`/api/v1/sites/${siteId}/crux?url=${encodeURIComponent('https://crux.example.com/servicios')}`)).json();
    expect(r.configured).toBe(true);
    expect(r.origin).toMatchObject({ scope: 'origin', key: 'https://crux.example.com', formFactor: 'PHONE' });
    const lcp = r.url.metrics.LCP;
    expect(lcp).toHaveLength(10);
    expect(lcp[0]).toMatchObject({ date: '2026-08-02', p75: 3600, rating: 'needs-improvement' });
    expect(lcp[9]).toMatchObject({ p75: 2250, rating: 'good' });
    expect(r.url.metrics.CLS[0].p75).toBe(0.14); // strings in the API, numbers here
    expect(r.url.metrics.INP[9].p75).toBeNull(); // "NaN" = no data that week
    expect(mock.requests[0]).toMatchObject({ formFactor: 'PHONE' });
  });

  it('caches answers, reports pages without enough traffic and rejects other hosts', async () => {
    const before = mock.requests.length;
    await app.inject(`/api/v1/sites/${siteId}/crux`);
    expect(mock.requests.length).toBe(before); // origin came from the cache
    expect((await app.inject(`/api/v1/sites/${siteId}/crux?url=${encodeURIComponent('https://crux.example.com/nodata')}`)).json().url).toBeNull();
    expect((await app.inject(`/api/v1/sites/${siteId}/crux?url=${encodeURIComponent('https://otro.com/')}`)).json().error.code).toBe('FOREIGN_URL');
  });

  it('explains how to enable the API when Google rejects the key', async () => {
    process.env.CRUX_API_KEY = 'disabled';
    const r = await app.inject(`/api/v1/sites/${siteId}/crux?formFactor=DESKTOP`);
    process.env.CRUX_API_KEY = 'test-key';
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/Chrome UX Report API/);
  });
});
