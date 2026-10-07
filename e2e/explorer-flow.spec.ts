import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('explore a crawl: resources, folder structure and custom extraction', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Explorer Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Crawl y auditoría' }).click();
  await page.getByLabel('Solicitudes / segundo').fill('20');
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  await expect(page.getByRole('cell', { name: 'completed' })).toBeVisible({ timeout: 60_000 });

  // Resources tab: the missing script is reported as broken.
  await page.getByRole('button', { name: 'Explorador SEO', exact: true }).click();
  await page.getByRole('tab', { name: 'Recursos y archivos' }).click();
  await page.getByLabel('Filtro').selectOption('broken');
  await expect(page.getByRole('button', { name: '/missing.js' })).toBeVisible();

  // Structure: the /deep folder (depth limit 5); open one from the tree.
  await page.getByRole('radio', { name: 'Estructura' }).click();
  await page.getByRole('button', { name: 'Expandir deep' }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await expect(page.getByText('Detalle de la URL')).toBeVisible();
  await expect(page.getByText('Página profunda número 5 del sitio de pruebas').first()).toBeVisible();

  // Custom extraction over the stored HTML.
  await page.getByRole('radio', { name: 'Búsqueda personalizada' }).click();
  await page.getByLabel('Texto a buscar').fill('Pie de página');
  await page.getByLabel('Dónde buscar').selectOption('text');
  await page.getByLabel('Selector o expresión').fill('link[rel=canonical]');
  await page.getByLabel('Atributo a extraer').fill('href');
  await page.getByRole('button', { name: 'Ejecutar' }).click();
  await expect(page.getByText(/de \d+ páginas con resultado/)).toBeVisible();
  await expect(page.getByRole('cell', { name: `${site.origin}/about`, exact: true })).toBeVisible();
});
