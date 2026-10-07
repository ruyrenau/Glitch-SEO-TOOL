/**
 * Crawls a synthetic local site of N pages (default 20,000) through the full pipeline
 * (fetch, parse, store, issues, alerts) into a throwaway SQLite database, then times the explorer.
 * Reports pages/second and peak memory. Usage: pnpm bench:crawl [pages]
 *
 * Each page has ~60 internal links (site-wide nav + category + related), 6 images, a CSS and a JS file,
 * so the link graph and the stored link table are realistic.
 */
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import type { AddressInfo } from 'net';

const N = Number(process.argv[2] ?? 20_000);
const CATS = 50;
const perCat = Math.ceil(N / CATS);

const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `palabra${(i * 7 + seed) % 97}`).join(' ');
const nav = Array.from({ length: CATS }, (_, c) => `<a href="/c/${c}/">Categoría ${c}</a>`).join(' ');
function pageHtml(c: number, i: number) {
  const related = Array.from({ length: 8 }, (_, k) => `<a href="/c/${c}/p/${(i + k + 1) % perCat}">Relacionado ${k}</a>`).join(' ');
  const imgs = Array.from({ length: 6 }, (_, k) => `<img src="/img/${c}-${(i + k) % 40}.jpg" ${k % 3 ? 'alt="Foto"' : ''} width="400" height="300">`).join('');
  const title = i % 37 === 0 ? 'Título duplicado' : `Producto ${i} de la categoría ${c} – Tienda de prueba`;
  return `<!doctype html><html lang="es"><head><title>${title}</title><meta name="description" content="Descripción del producto ${i} en la categoría ${c}.">
<link rel="canonical" href="/c/${c}/p/${i}"><link rel="stylesheet" href="/s.css"><script src="/a.js"></script></head>
<body><nav>${nav}</nav><main><h1>Producto ${i}</h1><p>${words(300, i)}</p>${imgs}${related}<a href="/c/${c}/">Volver</a></main></body></html>`;
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `glitch-bench-crawl-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.CRAWL_MAX_RPS = '100000';
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../packages/db'), env: process.env, stdio: 'pipe' });

  const server = http.createServer((req, res) => {
    const u = req.url ?? '/';
    let m: RegExpExecArray | null;
    let body: string | null = null;
    let type = 'text/html; charset=utf-8';
    if (u === '/') body = `<!doctype html><html lang="es"><head><title>Inicio de la tienda de prueba</title></head><body><nav>${nav}</nav><h1>Inicio</h1><p>${words(200, 1)}</p></body></html>`;
    else if ((m = /^\/c\/(\d+)\/$/.exec(u))) {
      const c = Number(m[1]);
      body = `<!doctype html><html lang="es"><head><title>Categoría ${c} de la tienda de prueba</title></head><body><nav>${nav}</nav><h1>Categoría ${c}</h1>${Array.from({ length: perCat }, (_, i) => `<a href="/c/${c}/p/${i}">Producto ${i}</a>`).join(' ')}</body></html>`;
    } else if ((m = /^\/c\/(\d+)\/p\/(\d+)$/.exec(u))) body = pageHtml(Number(m[1]), Number(m[2]));
    else if (u === '/s.css') (body = 'body{margin:0}'), (type = 'text/css');
    else if (u === '/a.js') (body = 'console.log(1)'), (type = 'application/javascript');
    else if (u.startsWith('/img/')) (body = 'x'.repeat(2048)), (type = 'image/jpeg');
    res.writeHead(body === null ? 404 : 200, { 'content-type': type });
    res.end(body ?? 'not found');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const { prisma, runCrawl, explorerSummary, explorerRows, explorerStructure } = await import('../packages/db/src');
  const ws = await prisma.workspace.create({ data: { name: 'Bench', slug: `bench-${Date.now()}` } });
  const site = await prisma.site.create({ data: { workspaceId: ws.id, name: 'Bench', domain: '127.0.0.1', canonicalUrl: `${origin}/` } });

  global.gc?.();
  let peakRss = process.memoryUsage().rss;
  let peakHeap = process.memoryUsage().heapUsed;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  }, 100);

  let last = 0;
  const t0 = performance.now();
  const run = await runCrawl({
    siteId: site.id,
    maxUrls: N + CATS + 1,
    maxDepth: 5,
    concurrency: 8,
    rps: 100000,
    allowHosts: ['127.0.0.1'],
    seedFromSitemap: false,
    onProgress: p => {
      if (p.crawled - last >= 2000) {
        last = p.crawled;
        global.gc?.();
        console.log(`  ${p.crawled.toLocaleString()} páginas · heap ${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)} MB`);
      }
    }
  });
  const crawlSecs = (performance.now() - t0) / 1000;
  clearInterval(sampler);

  const t1 = performance.now();
  await explorerSummary(run.id);
  const summarySecs = (performance.now() - t1) / 1000;
  const t2 = performance.now();
  await explorerRows(run.id, { tab: 'titles', filter: 'duplicate', sort: 'url', dir: 'asc', page: 1, pageSize: 100 });
  const rowsSecs = (performance.now() - t2) / 1000;
  const t3 = performance.now();
  await explorerStructure(run.id);
  const structureSecs = (performance.now() - t3) / 1000;

  const links = await prisma.crawledLink.count({ where: { crawlRunId: run.id } });
  const mb = (b: number) => `${(b / 1024 ** 2).toFixed(0)} MB`;
  console.table({
    pages: run.urlsCrawled,
    status: run.status,
    storedLinks: links,
    issueTypes: run.issuesFound,
    crawlSeconds: crawlSecs.toFixed(1),
    pagesPerSecond: Math.round(run.urlsCrawled / crawlSecs),
    peakRss: mb(peakRss),
    peakHeap: mb(peakHeap),
    explorerSummarySeconds: summarySecs.toFixed(2),
    explorerFilterSeconds: rowsSecs.toFixed(2),
    explorerStructureSeconds: structureSecs.toFixed(2),
    dbSize: mb(fs.statSync(dbFile).size)
  });
  await prisma.$disconnect();
  server.close();
  fs.rmSync(dbFile, { force: true });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
