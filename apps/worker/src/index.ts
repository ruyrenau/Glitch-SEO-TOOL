import { startWorkers } from '@glitch/jobs';
import { prisma } from '@glitch/db';

/**
 * Background worker: processes log imports, crawls and maintenance from Redis (BullMQ).
 * Run several copies to scale out; each job runs once.
 */
async function main() {
  const handle = await startWorkers();
  console.log(`Glitch worker ${process.pid} listening on queues: ${handle.workers.map(w => w.name).join(', ')} (Redis ${process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'})`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: finishing running jobs before exit…`);
    await handle.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
