import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import parser from 'cron-parser';
import { Prisma, prisma, recordAuditEvent, currentActorId, WorkflowError } from '@glitch/db';
import { JOB_TYPES, JobType, QueueName, backoff, connection, prefix, heartbeatKey } from './definitions';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const queues = new Map<QueueName, Queue>();
let redis: IORedis | null = null;

/** Producer-side Redis client: fails fast instead of queueing commands while Redis is down. */
function client(): IORedis {
  if (!redis) {
    redis = new IORedis({ ...(connection() as object), maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, retryStrategy: times => Math.min(times * 500, 5000) });
    redis.on('error', () => undefined); // surfaced per request instead
  }
  return redis;
}

/** Waits briefly for the connection to open (the client does not queue commands while offline). */
async function ready(timeoutMs = 2000) {
  const c = client();
  if (c.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      c.off('ready', onReady);
      reject(new Error('Redis is not reachable'));
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(t);
      resolve();
    };
    c.once('ready', onReady);
  });
}

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: client(), prefix: prefix() });
    q.on('error', () => undefined);
    queues.set(name, q);
  }
  return q;
}

export async function closeProducer() {
  await Promise.all([...queues.values()].map(q => q.close().catch(() => undefined)));
  queues.clear();
  redis?.disconnect();
  redis = null;
}

/** Redis reachable + last worker heartbeat (null when no worker reported in the last 30 s). */
export async function queueHealth(): Promise<{ redis: 'ok' | 'error'; worker: { at: string; pid: number; host: string } | null; error?: string }> {
  try {
    await ready(1500);
    const c = client();
    await Promise.race([c.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 1500))]);
    const hb = await c.get(heartbeatKey());
    return { redis: 'ok', worker: hb ? JSON.parse(hb) : null };
  } catch (e) {
    return { redis: 'error', worker: null, error: (e as Error).message };
  }
}

export interface EnqueueOptions {
  siteId?: string | null;
  workspaceId?: string | null;
  trigger?: 'manual' | 'schedule' | 'system';
  /** Same key → same job; a second enqueue returns the existing one. */
  idempotencyKey?: string;
  retryOfId?: string;
}

/**
 * Records the job in the database, then adds it to its BullMQ queue (the BullMQ id is the row id).
 * If Redis is unavailable the row is marked FAILED and a 503 is raised, so nothing is lost silently.
 */
export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
  const def = JOB_TYPES[type];
  if (opts.idempotencyKey) {
    const existing = await prisma.job.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;
  }
  const row = await prisma.job.create({
    data: {
      type,
      queue: def.queue,
      siteId: opts.siteId ?? null,
      workspaceId: opts.workspaceId ?? null,
      createdById: currentActorId(),
      trigger: opts.trigger ?? 'manual',
      idempotencyKey: opts.idempotencyKey,
      retryOfId: opts.retryOfId,
      maxAttempts: def.attempts,
      payload: json(payload)
    }
  });
  try {
    await ready();
    await getQueue(def.queue).add(type, { ...payload, jobDbId: row.id }, { jobId: row.id, attempts: def.attempts, backoff: backoff(), removeOnComplete: { age: 7 * 86400 }, removeOnFail: false });
  } catch (e) {
    await prisma.job.update({ where: { id: row.id }, data: { status: 'FAILED', error: `Queue unavailable: ${(e as Error).message}`, completedAt: new Date() } });
    throw new WorkflowError('QUEUE_UNAVAILABLE', 'La cola de trabajos no está disponible (¿Redis está corriendo?).', 503);
  }
  await recordAuditEvent({ workspaceId: opts.workspaceId ?? null, userId: null, action: 'job.queued', entity: 'Job', entityId: row.id, details: { type, trigger: row.trigger } });
  return row;
}

/** Queued jobs are removed from Redis at once; running jobs get a cancel flag the worker checks. */
export async function cancelJob(id: string) {
  await ready().catch(() => undefined);
  const row = await prisma.job.findUnique({ where: { id } });
  if (!row) throw new WorkflowError('JOB_NOT_FOUND', `Job ${id} not found`, 404);
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status)) throw new WorkflowError('JOB_FINISHED', 'Este trabajo ya terminó.');
  if (row.status === 'QUEUED' || row.status === 'RETRYING') {
    const job = await getQueue(row.queue as QueueName).getJob(id).catch(() => null);
    const removed = job ? await job.remove().then(() => true).catch(() => false) : true;
    if (removed) {
      await prisma.job.update({ where: { id }, data: { status: 'CANCELLED', cancelRequested: true, completedAt: new Date() } });
      await recordAuditEvent({ workspaceId: row.workspaceId, userId: null, action: 'job.cancelled', entity: 'Job', entityId: id });
      return prisma.job.findUniqueOrThrow({ where: { id } });
    }
  }
  const updated = await prisma.job.update({ where: { id }, data: { cancelRequested: true } });
  await recordAuditEvent({ workspaceId: row.workspaceId, userId: null, action: 'job.cancel_requested', entity: 'Job', entityId: id });
  return updated;
}

/** Re-runs a failed or cancelled job as a new job linked to the original. */
export async function retryJob(id: string) {
  const row = await prisma.job.findUnique({ where: { id } });
  if (!row) throw new WorkflowError('JOB_NOT_FOUND', `Job ${id} not found`, 404);
  if (row.status !== 'FAILED' && row.status !== 'CANCELLED') throw new WorkflowError('JOB_NOT_RETRYABLE', 'Solo se pueden reintentar trabajos fallidos o cancelados.');
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (row.type === 'log-import') throw new WorkflowError('JOB_NOT_RETRYABLE', 'Vuelve a subir el archivo: el archivo temporal de una importación fallida se elimina.');
  return enqueue(row.type as JobType, payload, { siteId: row.siteId, workspaceId: row.workspaceId, retryOfId: row.id });
}

export async function listJobs(workspaceId: string, filter: { siteId?: string; status?: string; type?: string; take?: number } = {}) {
  return prisma.job.findMany({
    where: {
      workspaceId,
      ...(filter.siteId ? { siteId: filter.siteId } : {}),
      ...(filter.status ? { status: filter.status as Prisma.EnumJobStatusFilter['equals'] } : {}),
      ...(filter.type ? { type: filter.type } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.take ?? 100, 500)
  });
}

// ---------------------------------------------------------------------------
// Scheduled crawls
// ---------------------------------------------------------------------------

const schedulerId = (siteId: string) => `site-crawl:${siteId}`;

/** Validates a 5-field cron expression and returns the next runs (for display). */
export function describeCron(cron: string, tz: string, count = 3): Date[] {
  if (cron.trim().split(/\s+/).length !== 5) throw new WorkflowError('INVALID_CRON', 'Usa una expresión cron de 5 campos, por ejemplo "0 3 * * 1" (lunes 03:00).', 400);
  try {
    const it = parser.parseExpression(cron, { tz });
    return Array.from({ length: count }, () => it.next().toDate());
  } catch (e) {
    throw new WorkflowError('INVALID_CRON', `Expresión cron no válida: ${(e as Error).message}`, 400);
  }
}

export async function setSiteSchedule(siteId: string, cron: string | null, options: Record<string, unknown> = {}) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new WorkflowError('SITE_NOT_FOUND', `Site ${siteId} not found`, 404);
  await ready();
  const q = getQueue('crawls');
  if (cron) {
    const next = describeCron(cron, site.timezone);
    // Guard against schedules that would hammer the site: at most one run per hour.
    if (next[1].getTime() - next[0].getTime() < 3600_000) throw new WorkflowError('CRON_TOO_FREQUENT', 'Programa como máximo un crawl por hora.', 400);
    await q.upsertJobScheduler(schedulerId(siteId), { pattern: cron, tz: site.timezone }, { name: 'crawl', data: { siteId, options, trigger: 'schedule' }, opts: { attempts: JOB_TYPES.crawl.attempts, backoff: backoff(), removeOnComplete: { age: 7 * 86400 }, removeOnFail: false } });
  } else {
    await q.removeJobScheduler(schedulerId(siteId)).catch(() => undefined);
  }
  await prisma.site.update({ where: { id: siteId }, data: { crawlSchedule: cron, crawlScheduleOptions: cron ? json(options) : Prisma.JsonNull } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: cron ? 'schedule.set' : 'schedule.removed', entity: 'Site', entityId: siteId, details: { cron, timezone: site.timezone } });
  return getSiteSchedule(siteId);
}

/** Weekly (or custom) Core Web Vitals for a site, from "Monitoreo". */
export async function setVitalsSchedule(siteId: string, cron: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  await ready();
  const q = getQueue('performance');
  const id = `site-vitals:${siteId}`;
  if (cron) {
    const next = describeCron(cron, site.timezone);
    if (next[1].getTime() - next[0].getTime() < 86400_000 - 60_000) throw new WorkflowError('CRON_TOO_FREQUENT', 'Mide Core Web Vitals como máximo una vez al día.', 400);
    await q.upsertJobScheduler(id, { pattern: cron, tz: site.timezone }, { name: 'monitor-vitals', data: { siteId, trigger: 'schedule' }, opts: { attempts: 1, removeOnComplete: { age: 7 * 86400 }, removeOnFail: false } });
    return next;
  }
  await q.removeJobScheduler(id).catch(() => undefined);
  return [];
}

export async function getSiteSchedule(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  if (!site.crawlSchedule) return { cron: null, timezone: site.timezone, options: null, nextRuns: [] };
  return { cron: site.crawlSchedule, timezone: site.timezone, options: site.crawlScheduleOptions, nextRuns: describeCron(site.crawlSchedule, site.timezone) };
}
