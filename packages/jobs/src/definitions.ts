import type { ConnectionOptions } from 'bullmq';

/** Every background job type, its queue and its retry policy. */
export const JOB_TYPES = {
  'log-import': { queue: 'imports', attempts: 2, label: 'Importación de log' },
  crawl: { queue: 'crawls', attempts: 2, label: 'Crawl' },
  retention: { queue: 'maintenance', attempts: 3, label: 'Limpieza por retención' }
} as const;

export type JobType = keyof typeof JOB_TYPES;
export const QUEUES = ['imports', 'crawls', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

/** Parallel jobs per queue in one worker process. */
export const CONCURRENCY: Record<QueueName, number> = { imports: 1, crawls: 2, maintenance: 1 };

/** Exponential backoff between attempts (10 s, 20 s, …). JOB_BACKOFF_MS overrides the base delay. */
export const backoff = () => ({ type: 'exponential' as const, delay: Number(process.env.JOB_BACKOFF_MS ?? 10_000) });

export function connection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  return {
    // On Windows "localhost" resolves to ::1 first, while Redis usually listens on 127.0.0.1 only.
    host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Workers must wait for Redis forever; producers should fail fast (see producer.ts).
    maxRetriesPerRequest: null
  };
}

/** Key prefix, so several environments (or test runs) can share one Redis. */
export const prefix = () => process.env.QUEUE_PREFIX ?? 'glitch';
export const heartbeatKey = () => `${prefix()}:worker:heartbeat`;
