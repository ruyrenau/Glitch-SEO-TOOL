import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Creates a fresh SQLite database for integration tests using the real migrations,
 * and makes sure Redis is reachable (starting the local one if needed) for the job queue.
 */
export default async function setup() {
  const dir = path.resolve(__dirname, '../.tmp');
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, 'test.db'), { force: true });
  const url = `file:${path.join(dir, 'test.db').split(path.sep).join('/')}`;
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../packages/db'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  const { ensureRedis } = await import(pathToFileURL(path.resolve(__dirname, 'redis-local.mjs')).href);
  const port = Number(new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').port || 6379);
  const child = await ensureRedis({ port, detached: true });
  return () => {
    child?.kill();
  };
}
