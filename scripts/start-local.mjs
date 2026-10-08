/**
 * One command for local use: Redis + API + worker + dashboard.
 *   pnpm build          (once, and after pulling changes)
 *   pnpm start:local    then open http://localhost:3000   (Ctrl+C stops everything)
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { parseEnv } from 'util';
import { ensureRedis } from './redis-local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings from .env (Google keys, secrets…); variables already set in the shell win.
const fromFile = fs.existsSync(path.join(ROOT, '.env')) ? parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')) : {};
// Only what the app needs from the file: DATABASE_URL and PORT keep their current local defaults.
const KEYS = ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'GSC_REDIRECT_URI', 'API_PUBLIC_URL', 'WEB_ORIGIN', 'CREDENTIALS_KEY', 'PSI_API_KEY', 'ALERT_WEBHOOK_URL', 'CHROME_PATH'];
const env = { ...Object.fromEntries(KEYS.filter(k => fromFile[k] && !process.env[k]).map(k => [k, fromFile[k]])), ...process.env, CRAWL_ALLOW_PRIVATE_HOSTS: process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '127.0.0.1' };
const COLORS = { redis: 31, api: 36, worker: 33, web: 35 };
const children = [];

for (const f of ['apps/api/dist/index.js', 'apps/worker/dist/index.js', 'apps/web/.next/BUILD_ID']) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.error(`Missing ${f}. Run "pnpm build" first.`);
    process.exit(1);
  }
}

function run(name, cmd, args, cwd = ROOT) {
  const useShell = process.platform === 'win32' && cmd === 'npx';
  const child = useShell ? spawn([cmd, ...args].join(' '), { cwd, env, shell: true }) : spawn(cmd, args, { cwd, env });
  const tag = `\x1b[${COLORS[name]}m[${name}]\x1b[0m `;
  const pipe = stream => stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => console.log(tag + l)));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => console.log(`${tag}exited (${code})`));
  children.push(child);
  return child;
}

const redis = await ensureRedis({ detached: false }).catch(err => {
  console.error(`[redis] ${err.message}`);
  process.exit(1);
});
if (redis) children.push(redis);
console.log(`\x1b[31m[redis]\x1b[0m ${redis ? 'started' : 'already running'} on 127.0.0.1:6379`);

run('api', process.execPath, ['apps/api/dist/index.js']);
run('worker', process.execPath, ['apps/worker/dist/index.js']);
run('web', 'npx', ['next', 'start', '-p', '3000'], path.join(ROOT, 'apps/web'));
setTimeout(() => console.log('\nOpen http://localhost:3000  (Ctrl+C to stop everything)\n'), 4000);

const stop = () => {
  for (const c of children.reverse()) c.kill('SIGINT');
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
