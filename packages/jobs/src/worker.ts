import os from 'os';
import { Worker, Job as BullJob, UnrecoverableError, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma, prisma, recordAuditEvent } from '@glitch/db';
import { CONCURRENCY, QUEUES, QueueName, JOB_TYPES, JobType, connection, prefix, heartbeatKey, backoff } from './definitions';
import { HANDLERS, JobContext } from './handlers';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const MAX_LOG_LINES = 50;

/** Jobs created by a BullMQ scheduler have no database row yet. */
async function ensureRow(job: BullJob) {
  const id = (job.data?.jobDbId as string | undefined) ?? job.id!;
  const existing = await prisma.job.findUnique({ where: { id } });
  if (existing) return existing;
  const site = job.data?.siteId ? await prisma.site.findUnique({ where: { id: job.data.siteId as string } }) : null;
  const def = JOB_TYPES[job.name as JobType];
  return prisma.job.create({
    data: {
      id,
      type: job.name,
      queue: def?.queue ?? job.queueName,
      siteId: site?.id ?? null,
      workspaceId: site?.workspaceId ?? null,
      trigger: (job.data?.trigger as string) ?? 'schedule',
      maxAttempts: job.opts.attempts ?? 1,
      payload: json(job.data)
    }
  });
}

async function processJob(job: BullJob) {
  const row = await ensureRow(job);
  if (row.cancelRequested || row.status === 'CANCELLED') return { cancelled: true };

  const attempt = job.attemptsMade + 1;
  await prisma.job.update({ where: { id: row.id }, data: { status: 'RUNNING', attempts: attempt, startedAt: row.startedAt ?? new Date(), error: null } });

  const ac = new AbortController();
  const logs: Array<{ at: string; level: string; msg: string }> = Array.isArray(row.logs) ? (row.logs as Array<{ at: string; level: string; msg: string }>) : [];
  let pending: { pct: number | null; detail?: Record<string, unknown> } | null = null;
  let dirty = false;

  // Flush progress/logs at most once a second and pick up cancel requests.
  const tick = setInterval(async () => {
    try {
      const fresh = await prisma.job.findUnique({ where: { id: row.id }, select: { cancelRequested: true } });
      if (fresh?.cancelRequested && !ac.signal.aborted) ac.abort();
      if (pending || dirty) {
        const p = pending;
        pending = null;
        dirty = false;
        await prisma.job.update({ where: { id: row.id }, data: { ...(p ? { progress: p.pct ?? undefined, progressDetail: p.detail ? json(p.detail) : undefined } : {}), logs: json(logs.slice(-MAX_LOG_LINES)) } });
      }
    } catch {
      /* next tick */
    }
  }, 1000);

  const ctx: JobContext = {
    signal: ac.signal,
    progress: (pct, detail) => {
      pending = { pct, detail };
      void job.updateProgress(pct ?? 0).catch(() => undefined);
    },
    log: (msg, level = 'info') => {
      logs.push({ at: new Date().toISOString(), level, msg: msg.slice(0, 500) });
      dirty = true;
    }
  };
  if (attempt > 1) ctx.log(`Reintento ${attempt} de ${job.opts.attempts ?? 1}`, 'warn');

  try {
    const handler = HANDLERS[job.name as JobType] as (p: never, c: JobContext) => Promise<unknown>;
    if (!handler) throw new UnrecoverableError(`Unknown job type ${job.name}`);
    const result = await handler(job.data as never, ctx);
    const cancelled = ac.signal.aborted;
    await prisma.job.update({
      where: { id: row.id },
      data: { status: cancelled ? 'CANCELLED' : 'COMPLETED', progress: cancelled ? undefined : 100, result: json(result), logs: json(logs.slice(-MAX_LOG_LINES)), completedAt: new Date() }
    });
    await recordAuditEvent({ workspaceId: row.workspaceId, userId: row.createdById, action: cancelled ? 'job.cancelled' : 'job.completed', entity: 'Job', entityId: row.id, details: { type: row.type } });
    return result;
  } catch (e) {
    const err = e as Error & { unrecoverable?: boolean };
    const cancelled = ac.signal.aborted;
    const final = cancelled || err.unrecoverable || err instanceof UnrecoverableError || attempt >= (job.opts.attempts ?? 1);
    ctx.log(`${cancelled ? 'Cancelado' : 'Error'}: ${err.message}`, 'warn');
    await prisma.job.update({
      where: { id: row.id },
      data: { status: cancelled ? 'CANCELLED' : final ? 'FAILED' : 'RETRYING', error: err.message.slice(0, 2000), logs: json(logs.slice(-MAX_LOG_LINES)), ...(final ? { completedAt: new Date() } : {}) }
    });
    if (final) await recordAuditEvent({ workspaceId: row.workspaceId, userId: row.createdById, action: cancelled ? 'job.cancelled' : 'job.failed', entity: 'Job', entityId: row.id, details: { type: row.type, error: err.message.slice(0, 300) } });
    // Final failures stay in BullMQ's failed set (dead letter) and are not retried.
    if (final && !(err instanceof UnrecoverableError)) throw new UnrecoverableError(err.message);
    throw err;
  } finally {
    clearInterval(tick);
  }
}

export interface WorkerHandle {
  close: () => Promise<void>;
  workers: Worker[];
}

/** Starts one BullMQ worker per queue, the heartbeat and the daily retention schedule. */
export async function startWorkers(opts: { concurrency?: Partial<Record<QueueName, number>>; scheduleRetention?: boolean } = {}): Promise<WorkerHandle> {
  const workers = QUEUES.map(
    q =>
      new Worker(q, processJob, {
        connection: connection(),
        prefix: prefix(),
        concurrency: opts.concurrency?.[q] ?? CONCURRENCY[q],
        // Long crawls: renew the lock often; a crashed worker's job is retried after it expires.
        lockDuration: 60_000
      })
  );
  for (const w of workers) w.on('error', err => console.error(`[worker:${w.name}]`, err.message));

  const redis = new IORedis(connection() as object);
  redis.on('error', () => undefined);
  const beat = () =>
    redis.set(heartbeatKey(), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, host: os.hostname(), queues: QUEUES }), 'EX', 30).catch(() => undefined);
  await beat();
  const hb = setInterval(beat, 10_000);

  if (opts.scheduleRetention !== false) {
    const maintenance = new Queue('maintenance', { connection: connection(), prefix: prefix() });
    await maintenance.upsertJobScheduler('retention-daily', { pattern: process.env.RETENTION_CRON ?? '30 3 * * *' }, { name: 'retention', data: { trigger: 'schedule' }, opts: { attempts: JOB_TYPES.retention.attempts, backoff: backoff(), removeOnFail: false } });
    await maintenance.close();
  }

  return {
    workers,
    close: async () => {
      clearInterval(hb);
      await Promise.all(workers.map(w => w.close()));
      await redis.del(heartbeatKey()).catch(() => undefined);
      redis.disconnect();
    }
  };
}
