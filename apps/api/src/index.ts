import { config } from '@glitch/config';
import { startWorkers } from '@glitch/jobs';
import { buildApp } from './app';

async function main() {
  const app = await buildApp();
  // Small deployments and E2E can run the job worker inside the API process.
  if (process.env.EMBEDDED_WORKER === 'true') {
    const workers = await startWorkers();
    app.addHook('onClose', async () => workers.close());
    app.log.info('Embedded job worker started');
  }
  await app.listen({ port: config.PORT, host: process.env.HOST ?? '127.0.0.1' });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
