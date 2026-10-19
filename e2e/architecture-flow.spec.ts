import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Arquitectura: link score and orphans, 301 map with export, and the JavaScript rendering audit', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Arquitectura Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  const done = (n: number) => expect.poll(async () => (await (await page.request.get(`${api}/api/v1/sites/${id}/crawls`)).json()).filter((r: { status: string }) => r.status === 'completed').length, { timeout: 120_000 }).toBe(n);
  await page.request.post(`${api}/api/v1/sites/${id}/crawls`, { data: {} });
  await done(1);

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Arquitectura', exact: true }).click();

  // Internal linking.
  await expect(page.getByText('Link Score', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Páginas por profundidad' })).toBeVisible();
  await page.getByLabel('Orden de páginas').selectOption('score');
  await expect(page.getByRole('link', { name: '/', exact: true }).first()).toBeVisible();

  // 301 map: /missing is broken; export it for Apache.
  await page.getByRole('tab', { name: 'Redirecciones 301' }).click();
  await expect(page.getByRole('cell', { name: '/missing', exact: true })).toBeVisible();
  await page.getByLabel('Incluir /missing').check();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '.htaccess (Apache)' }).click();
  expect((await dl).suggestedFilename()).toBe('redirecciones.htaccess');

  // Rendering audit: needs a JavaScript crawl.
  await page.getByRole('tab', { name: 'Renderizado JavaScript' }).click();
  await expect(page.getByText(/necesita un crawl con "Ejecutar JavaScript"/)).toBeVisible();
  await page.request.post(`${api}/api/v1/sites/${id}/crawls`, { data: { renderJs: true, maxUrls: 20 } });
  await done(2);
  await page.getByRole('tab', { name: 'Redirecciones 301' }).click();
  await page.getByRole('tab', { name: 'Renderizado JavaScript' }).click();
  await expect(page.getByText('Páginas renderizadas')).toBeVisible();
  await page.getByRole('button', { expanded: false }).filter({ hasText: '% del texto' }).first().click();
  await expect(page.getByRole('region', { name: 'Sin JavaScript' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Con JavaScript' })).toBeVisible();
});
