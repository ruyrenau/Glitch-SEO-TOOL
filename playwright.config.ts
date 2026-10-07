import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the production builds (`pnpm build` first) on the default
 * ports 4000/3000 (stop `pnpm dev` before running), with an isolated SQLite
 * database so dev.db is never touched.
 * Locally it uses the installed Microsoft Edge; in CI set PW_CHANNEL=chromium.
 */
const dbFile = path.resolve(__dirname, '.tmp/e2e.db');
const e2eDb = `file:${dbFile.split(path.sep).join('/')}`;

// Prepared at config load, before any web server starts.
if (!process.env.PW_E2E_DB_READY) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.rmSync(dbFile, { force: true });
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, 'packages/db'), env: { ...process.env, DATABASE_URL: e2eDb }, stdio: 'pipe' });
  // E2E user (password only for this throwaway database).
  execSync('node apps/cli/dist/index.js users:create --username e2e --name "E2E Owner" --role OWNER', {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: e2eDb, GLITCH_USER_PASSWORD: 'E2e-password-123' },
    stdio: 'pipe'
  });
  process.env.PW_E2E_DB_READY = '1'; // config is re-evaluated in workers
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node apps/api/dist/index.js',
      url: 'http://localhost:4000/health/ready',
      env: { DATABASE_URL: e2eDb, DEMO_MODE: 'false', PORT: '4000', CRAWL_ALLOW_PRIVATE_HOSTS: '127.0.0.1' },
      reuseExistingServer: false,
      timeout: 60_000
    },
    { command: 'pnpm --filter @glitch/web exec next start -p 3000', url: 'http://localhost:3000', reuseExistingServer: false, timeout: 120_000 }
  ]
});
