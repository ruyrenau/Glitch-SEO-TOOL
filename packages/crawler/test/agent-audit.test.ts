import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { auditAgentPages, agentTasks, findBrowser } from '../src';

const good = `<!doctype html><html lang="es"><head><title>Servicios</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"Auditoría SEO","offers":{"@type":"Offer","price":"4999","priceCurrency":"MXN"}}</script></head>
<body><main><h1>Auditoría SEO</h1><p>Desde $4,999 MXN.</p>
<a href="/cotizar">Cotizar ahora</a>
<form><label for="n">Nombre</label><input id="n" name="name" autocomplete="name">
<label for="e">Correo</label><input id="e" type="email" name="email" autocomplete="email">
<button type="submit">Enviar solicitud</button></form>
<a href="mailto:hola@x.mx">hola@x.mx</a></main></body></html>`;

const bad = `<!doctype html><html><head><title>Tienda</title><script src="https://www.google.com/recaptcha/api.js"></script></head>
<body><div style="position:fixed;inset:0;background:#000a;z-index:9"><p>Aceptas las cookies</p><div style="cursor:pointer" onclick="this.parentNode.remove()">OK</div></div>
<div style="cursor:pointer" onclick="go()">Agregar al carrito</div><button><svg width="10" height="10"></svg></button>
<form><input name="email" placeholder="Tu correo"><input type="text" name="tel"><button type="submit"></button></form></body></html>`;

let server: http.Server;
let base = '';
const hasChrome = !!findBrowser();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/bad' ? bad : good);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe.skipIf(!hasChrome)('agent navigation audit (real Chrome)', () => {
  it('scores an agent-friendly page high and explains every problem of a hostile one', async () => {
    const [g, b] = await auditAgentPages([`${base}/good`, `${base}/bad`], { allowHosts: ['127.0.0.1'] });
    expect(g.score).toBeGreaterThanOrEqual(90);
    expect(g.facts.forms[0]).toMatchObject({ submit: 'Enviar solicitud' });
    expect(g.facts.offerSchema).toBe(true);

    const by = Object.fromEntries(b.checks.map(c => [c.id, c]));
    expect(b.score).toBeLessThan(40);
    expect(by.semantic_controls.score).toBe(0.5);
    expect(by.semantic_controls.detail).toMatch(/Agregar al carrito|OK/);
    expect(by.named_controls.score).toBeLessThan(1);
    expect(by.form_labels.score).toBe(0);
    expect(by.no_blocking_overlay.score).toBeLessThan(1);
    expect(by.no_captcha.score).toBe(0.5);
    expect(by.clear_cta.detail).toMatch(/no es un botón ni un enlace real/);

    const tasks = Object.fromEntries(agentTasks([g, b]).map(t => [t.id, t]));
    expect(tasks.find_price).toMatchObject({ status: 'ok', pages: [`${base}/good`] });
    expect(tasks.contact.status).toBe('ok');
    expect(tasks.act.status).toBe('ok');
    expect(agentTasks([b]).map(t => t.status)).toEqual(['fail', 'partial', 'partial']);
  }, 60_000);
});
