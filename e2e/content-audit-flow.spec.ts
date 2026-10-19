import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Análisis de contenido: duplicates and thin pages from a crawl; declining and topics ask for Search Console', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Contenido Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.request.post(`${api}/api/v1/sites/${id}/crawls`, { data: {} });
  await expect.poll(async () => (await (await page.request.get(`${api}/api/v1/sites/${id}/crawls`)).json()).some((r: { status: string }) => r.status === 'completed'), { timeout: 60_000 }).toBe(true);

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Análisis de contenido', exact: true }).click();

  await expect(page.getByText('Páginas comparadas')).toBeVisible();
  await page.getByRole('tab', { name: 'Poco texto', exact: true }).click();
  await expect(page.getByLabel('Palabras mínimas')).toBeVisible();
  await page.getByLabel('Palabras mínimas').fill('5000');
  await expect(page.getByText(/Páginas indexables con poco texto propio/)).toBeVisible(); // every fixture page is short
  await page.getByRole('tab', { name: 'Casi duplicados' }).click();
  await expect(page.getByLabel('Similitud mínima')).toBeVisible();

  await page.getByRole('tab', { name: 'En declive' }).click();
  await expect(page.getByText(/historial mensual de Search Console/)).toBeVisible();
  await page.getByRole('tab', { name: 'Temas de keywords' }).click();
  await expect(page.getByText(/agrupar tus búsquedas por tema/)).toBeVisible();
});
