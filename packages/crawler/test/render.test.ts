import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { crawlSite, findBrowser } from '../src';

// A client-rendered page: the server sends an empty shell; JavaScript sets the title, the H1,
// the content and a link that does not exist in the raw HTML. It also calls a private address.
const shell = `<!doctype html><html lang="es"><head><title>Cargando…</title></head><body><div id="app"></div>
<script>
  document.title = 'Catálogo de auditorías SEO renderizado con JavaScript';
  document.getElementById('app').innerHTML = '<h1>Catálogo</h1><p>' + 'contenido generado '.repeat(80) + '</p><a href="/solo-js">Solo con JS</a>';
  fetch('http://10.0.0.1/interno').catch(function () {});
  undefinedFunction();
</script></body></html>`;
const plain = (t: string) => `<!doctype html><html lang="es"><head><title>${t}</title></head><body><h1>${t}</h1><p>${'texto '.repeat(60)}</p></body></html>`;

let server: http.Server;
let origin = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const routes: Record<string, string> = { '/': shell, '/solo-js': plain('Página enlazada solo con JavaScript') };
    const body = routes[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'no');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe.skipIf(!findBrowser())('JavaScript rendering', () => {
  it('without rendering, the crawler only sees the empty shell', async () => {
    const r = await crawlSite({ startUrl: `${origin}/`, allowHosts: ['127.0.0.1'], rps: 20, checkResources: false, checkExternalLinks: false });
    expect(r.pages.map(p => new URL(p.url).pathname)).toEqual(['/']);
    expect(r.pages[0].extracted?.title).toBe('Cargando…');
    expect(r.pages[0].js).toBeNull();
  });

  it('with rendering, it analyses the DOM after JavaScript and reports what JavaScript changed', async () => {
    const r = await crawlSite({ startUrl: `${origin}/`, allowHosts: ['127.0.0.1'], rps: 20, renderJs: true, checkResources: false, checkExternalLinks: false });
    const home = r.pages.find(p => new URL(p.url).pathname === '/')!;
    expect(home.extracted?.title).toBe('Catálogo de auditorías SEO renderizado con JavaScript');
    expect(home.extracted?.h1).toEqual(['Catálogo']);
    expect(home.js).toMatchObject({ rendered: true, raw: { title: 'Cargando…', h1: null, internalLinks: 0 }, jsOnlyLinks: [`${origin}/solo-js`] });
    expect(home.js!.raw.wordCount).toBeLessThan(home.extracted!.wordCount);
    expect(home.js!.errors.join(' ')).toMatch(/undefinedFunction/);
    expect(home.js!.blockedRequests).toBeGreaterThan(0); // 10.0.0.1 refused by the SSRF guard
    expect(home.html).toContain('<h1>Catálogo</h1>');
    // The link that only exists after JavaScript was followed.
    expect(r.pages.some(p => p.url === `${origin}/solo-js`)).toBe(true);
  }, 60_000);
});
