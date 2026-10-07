import crypto from 'crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Role } from '@glitch/db';
import { createUser } from '@glitch/db';
import { startWorkers } from '@glitch/jobs';
import { buildApp } from '../src/app';

export const TEST_PASSWORD = 'Test-password-123';

/** Creates a user with the given role and returns the session cookie. */
export async function loginAs(app: FastifyInstance, role: Role = 'OWNER') {
  const username = `t-${role.toLowerCase().replace('_', '')}-${crypto.randomBytes(4).toString('hex')}`;
  const user = await createUser({ username, name: `Test ${role}`, password: TEST_PASSWORD, role });
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: TEST_PASSWORD } });
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  return { user, username, cookie };
}

/**
 * Builds the API and signs in as an Owner. Every app.inject() call carries the
 * session cookie unless the test sets its own cookie header.
 */
export async function buildAuthedApp(role: Role = 'OWNER') {
  // Each test file gets its own queue namespace in the shared Redis.
  process.env.QUEUE_PREFIX = `glitch-test-${crypto.randomBytes(4).toString('hex')}`;
  const app = await buildApp({ logger: false });
  // A real worker in this process, so queued jobs actually run.
  const workers = await startWorkers({ scheduleRetention: false });
  app.addHook('onClose', async () => workers.close());
  const session = await loginAs(app, role);
  const inject = app.inject.bind(app);
  const withCookie = (opts: InjectOptions | string) => {
    const o: InjectOptions = typeof opts === 'string' ? { url: opts } : opts;
    const headers = { ...(o.headers ?? {}) } as Record<string, string>;
    if (!('cookie' in headers)) headers.cookie = session.cookie;
    return inject({ ...o, headers });
  };
  (app as unknown as { inject: typeof withCookie }).inject = withCookie;
  return { app, ...session };
}

type Injectable = { inject: (o: InjectOptions | string) => Promise<{ json: () => unknown }> };

/** Polls a job until it leaves QUEUED/RUNNING/RETRYING. */
export async function waitForJob(app: Injectable, jobId: string, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const job = (await app.inject(`/api/v1/jobs/${jobId}`)).json() as { status: string; result: Record<string, unknown> | null; error: string | null };
    if (!['QUEUED', 'RUNNING', 'RETRYING'].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Job ${jobId} did not finish in ${timeoutMs} ms`);
}
