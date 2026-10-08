import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma, createUser } from '@glitch/db';
import { enqueue, getQueue, startWorkers, uploadDir, WorkerHandle } from '@glitch/jobs';
import { startFixtureSite, FixtureSite } from '@glitch/testing';
import { buildApp } from '../src/app';
import { loginAs, waitForJob, TEST_PASSWORD } from './helpers';

let app: FastifyInstance;
let workers: WorkerHandle | null = null;
let site: FixtureSite;
let cookie: string;
let workspaceId: string;
let siteId: string;

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, c = cookie) => app.inject({ method, url, payload: payload as object, headers: { cookie: c } });
const inject = { inject: (o: string | { url: string }) => app.inject({ ...(typeof o === 'string' ? { url: o } : o), headers: { cookie } }) } as unknown as Parameters<typeof waitForJob>[0];

beforeAll(async () => {
  process.env.QUEUE_PREFIX = `glitch-test-${crypto.randomBytes(4).toString('hex')}`;
  process.env.JOB_BACKOFF_MS = '200';
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  site = await startFixtureSite();
  app = await buildApp({ logger: false });
  const owner = await loginAs(app, 'OWNER');
  cookie = owner.cookie;
  const s = (await req('POST', '/api/v1/sites', { name: 'Jobs', domain: '127.0.0.1', canonicalUrl: site.origin })).json();
  siteId = s.id;
  workspaceId = (await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).workspaceId;
});
afterAll(async () => {
  await workers?.close();
  await app.close();
  await site.close();
  delete process.env.JOB_BACKOFF_MS;
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await prisma.$disconnect();
});

describe('job queue', () => {
  it('a queued job waits for a worker and can be cancelled before it starts', async () => {
    const r = await req('POST', `/api/v1/sites/${siteId}/crawls`, { rps: 20 });
    expect(r.statusCode).toBe(202);
    const jobId = r.json().jobId;
    expect((await req('GET', `/api/v1/jobs/${jobId}`)).json().status).toBe('QUEUED'); // no worker running yet
    const c = (await req('POST', `/api/v1/jobs/${jobId}/cancel`)).json();
    expect(c.status).toBe('CANCELLED');
    expect(await getQueue('crawls').getJob(jobId)).toBeUndefined();
  });

  it('health reports Redis and the worker heartbeat', async () => {
    expect((await app.inject('/health/ready')).json()).toMatchObject({ queue: 'ok', worker: 'none' });
    workers = await startWorkers({ scheduleRetention: false });
    expect((await app.inject('/health/ready')).json()).toMatchObject({ queue: 'ok', worker: 'ok' });
  });

  it('runs a crawl in the worker with progress, and a running crawl can be cancelled', async () => {
    const r = await req('POST', `/api/v1/sites/${siteId}/crawls`, { rps: 2, concurrency: 1, maxDepth: 10 });
    const jobId = r.json().jobId;
    let job = (await req('GET', `/api/v1/jobs/${jobId}`)).json();
    for (let i = 0; i < 60 && !(job.status === 'RUNNING' && job.progressDetail?.crawled >= 2); i++) {
      await new Promise(res => setTimeout(res, 250));
      job = (await req('GET', `/api/v1/jobs/${jobId}`)).json();
    }
    expect(job.status).toBe('RUNNING');
    expect(job.progressDetail.crawlRunId).toBeTruthy();
    const runs = (await req('GET', `/api/v1/sites/${siteId}/crawls`)).json();
    expect(runs[0]).toMatchObject({ status: 'running', jobId });

    await req('POST', `/api/v1/jobs/${jobId}/cancel`);
    const done = await waitForJob(inject, jobId);
    expect(done.status).toBe('CANCELLED');
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: job.progressDetail.crawlRunId } });
    expect(run.status).toBe('cancelled');
  });

  it('retries transient failures with backoff and keeps final failures in the dead-letter set', async () => {
    // A crawl for a site id that does not exist fails on every attempt.
    const row = await enqueue('crawl', { siteId: crypto.randomUUID(), options: {} }, { workspaceId });
    const done = await waitForJob(inject, row.id);
    expect(done).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(done.error).toMatch(/not found/);
    // The DB row is final a moment before BullMQ moves the job to its failed set.
    await expect.poll(async () => (await getQueue('crawls').getFailed()).map(j => j.id), { timeout: 5000 }).toContain(row.id);
    const logs = (done as unknown as { logs: Array<{ msg: string }> }).logs.map(l => l.msg).join(' | ');
    expect(logs).toMatch(/Reintento 2 de 2/);

    const retry = await req('POST', `/api/v1/jobs/${row.id}/retry`);
    expect(retry.statusCode).toBe(202);
    expect(retry.json().retryOfId).toBe(row.id);
  });

  it('does not retry errors that cannot change (deleted upload)', async () => {
    const row = await enqueue('log-import', { siteId, filePath: path.join(uploadDir(), 'missing.upload'), fileName: 'missing.log' }, { siteId, workspaceId });
    const done = await waitForJob(inject, row.id);
    expect(done).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('imports an uploaded log through the queue and deletes the temp file', async () => {
    const before = new Set(fs.existsSync(uploadDir()) ? fs.readdirSync(uploadDir()) : []);
    const body = fs.readFileSync(path.resolve(__dirname, '../../../fixtures/sample_nginx.log'));
    const r = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/log-imports?fileName=a.log`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: body });
    const done = await waitForJob(inject, r.json().jobId);
    expect(done.status).toBe('COMPLETED');
    expect(fs.readdirSync(uploadDir()).filter(f => !before.has(f))).toEqual([]);
  });

  it('schedules crawls with cron, rejecting invalid and too-frequent expressions', async () => {
    expect((await req('PUT', `/api/v1/sites/${siteId}/schedule`, { cron: 'every monday' })).json().error.code).toBe('INVALID_CRON');
    expect((await req('PUT', `/api/v1/sites/${siteId}/schedule`, { cron: '*/5 * * * *' })).json().error.code).toBe('CRON_TOO_FREQUENT');
    const ok = (await req('PUT', `/api/v1/sites/${siteId}/schedule`, { cron: '0 3 * * 1', options: { maxUrls: 50 } })).json();
    expect(ok.cron).toBe('0 3 * * 1');
    expect(ok.nextRuns).toHaveLength(3);
    expect(new Date(ok.nextRuns[0]).getUTCDay()).toBe(1);
    const keys = async () => (await getQueue('crawls').getJobSchedulers()).map(j => j.key);
    expect(await keys()).toContain(`site-crawl:${siteId}`);
    const off = (await req('PUT', `/api/v1/sites/${siteId}/schedule`, { cron: null })).json();
    expect(off.cron).toBeNull();
    expect(await keys()).not.toContain(`site-crawl:${siteId}`);
  });

  it('retention deletes data past its period and audits it', async () => {
    const imp = await prisma.logImport.findFirstOrThrow({ where: { siteId } });
    await prisma.logImport.update({ where: { id: imp.id }, data: { createdAt: new Date(Date.now() - 400 * 86400_000) } });
    const r = await req('POST', '/api/v1/maintenance/retention');
    const done = await waitForJob(inject, r.json().jobId);
    expect(done.status).toBe('COMPLETED');
    expect((done.result as { logImportsDeleted: number }).logImportsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.logImport.findUnique({ where: { id: imp.id } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: 'log_import.deleted', entityId: imp.id } })).toBe(1);
  });

  it('jobs are only visible inside their workspace and need seo:operate to cancel', async () => {
    const ws = await prisma.workspace.create({ data: { name: 'Other jobs', slug: `oj-${Date.now()}` } });
    const other = await createUser({ username: `oj-${Date.now()}`, name: 'O', password: TEST_PASSWORD, role: 'OWNER', workspaceId: ws.id });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: other.username, password: TEST_PASSWORD } });
    const otherCookie = String(login.headers['set-cookie']).split(';')[0];
    const mine = (await req('GET', '/api/v1/jobs')).json() as Array<{ id: string }>;
    expect(mine.length).toBeGreaterThan(0);
    expect((await req('GET', `/api/v1/jobs/${mine[0].id}`, undefined, otherCookie)).statusCode).toBe(404);
    expect((await req('GET', '/api/v1/jobs', undefined, otherCookie)).json()).toEqual([]);
    const viewer = await loginAs(app, 'VIEWER');
    expect((await req('POST', `/api/v1/jobs/${mine[0].id}/cancel`, undefined, viewer.cookie)).statusCode).toBe(403);
  });
});
