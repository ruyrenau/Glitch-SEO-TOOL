import http from 'http';
import { AddressInfo } from 'net';
import { test, expect } from '@playwright/test';
import { login } from './helpers';

let server: http.Server;
const received: unknown[] = [];
let hook = '';
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  hook = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
test.afterAll(() => new Promise<void>(r => server.close(() => r())));

test('Monitoreo avisos: save a webhook (hidden afterwards) and send a test message', async ({ page }) => {
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Avisos Flow', domain: 'avisos.example.com', canonicalUrl: 'https://avisos.example.com' } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Monitoreo', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();
  await page.getByRole('switch', { name: 'Avisos activados' }).click();
  await page.getByLabel('URL del webhook').fill(hook);
  await page.getByRole('button', { name: 'Guardar avisos' }).click();
  await expect(page.getByText('Avisos guardados.')).toBeVisible();
  await expect(page.getByText(/Webhook guardado:/)).toBeVisible();
  await expect(page.getByLabel('URL del webhook')).toHaveValue('');

  await page.getByRole('button', { name: 'Enviar prueba' }).click();
  await expect(page.getByText('Mensaje de prueba enviado. Revisa tu canal.')).toBeVisible();
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.stringify(received[0])).toContain('G.SEO');
});
