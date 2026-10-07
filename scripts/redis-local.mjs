/**
 * Ensures a local Redis is listening (default 127.0.0.1:6379) for development and tests.
 * - Already running: does nothing.
 * - Windows: downloads a portable Redis build (github.com/redis-windows) into .tools/ once and starts it.
 * - Elsewhere: starts `redis-server` from PATH (install it, or use `docker compose up redis`).
 *
 *   node scripts/redis-local.mjs          start and keep running (Ctrl+C to stop)
 *   import { ensureRedis } from ...        start detached for tests
 */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '8.10.2';
const ZIP_URL = `https://github.com/redis-windows/redis-windows/releases/download/${VERSION}/Redis-${VERSION}-Windows-x64-msys2.zip`;
const DIR = path.join(ROOT, '.tools', 'redis');

export function ping(port = 6379, host = '127.0.0.1', timeout = 800) {
  return new Promise(resolve => {
    const s = net.connect({ port, host });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.on('error', () => done(false));
    s.on('connect', () => s.write('PING\r\n'));
    s.on('data', d => done(String(d).startsWith('+PONG')));
  });
}

function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === 'redis-server.exe') return full;
    if (e.isDirectory()) {
      const f = findExe(full);
      if (f) return f;
    }
  }
  return null;
}

async function windowsBinary() {
  let exe = findExe(DIR);
  if (exe) return exe;
  console.log(`Downloading portable Redis ${VERSION} for Windows into .tools/redis (one time)…`);
  fs.mkdirSync(DIR, { recursive: true });
  const zip = path.join(DIR, 'redis.zip');
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zip}' -DestinationPath '${DIR}'`], { stdio: 'ignore' });
  fs.rmSync(zip, { force: true });
  exe = findExe(DIR);
  if (!exe) throw new Error('redis-server.exe not found after extracting');
  return exe;
}

/** Starts Redis if nothing answers on the port. Returns the child process, or null if it was already running. */
export async function ensureRedis({ port = 6379, detached = false } = {}) {
  if (await ping(port)) return null;
  const bin = process.platform === 'win32' ? await windowsBinary() : 'redis-server';
  const child = spawn(bin, ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], {
    cwd: process.platform === 'win32' ? path.dirname(bin) : ROOT,
    stdio: detached ? 'ignore' : 'inherit',
    detached
  });
  child.on('error', err => {
    console.error(process.platform === 'win32' ? err.message : 'redis-server not found. Install Redis or run `docker compose up -d redis`.');
  });
  for (let i = 0; i < 50; i++) {
    if (await ping(port)) {
      if (detached) child.unref();
      return child;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Redis did not start on port ${port}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.REDIS_PORT ?? 6379);
  ensureRedis({ port }).then(child => {
    if (!child) {
      console.log(`Redis is already running on 127.0.0.1:${port}.`);
      return;
    }
    console.log(`Redis running on 127.0.0.1:${port} (Ctrl+C to stop).`);
    process.on('SIGINT', () => child.kill());
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
