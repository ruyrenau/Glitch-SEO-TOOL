import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Listo para IA: scores the pages of a crawl, shows AI bot access and explains each fix', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'IA Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.request.post(`${api}/api/v1/sites/${id}/crawls`, { data: {} });
  await expect.poll(async () => (await (await page.request.get(`${api}/api/v1/sites/${id}/crawls`)).json()).some((r: { status: string }) => r.status === 'completed'), { timeout: 60_000 }).toBe(true);

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Listo para IA', exact: true }).click();

  await expect(page.getByText('Acceso de los bots de IA')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'OAI-SearchBot' })).toBeVisible();
  await expect(page.getByText('Puntaje medio')).toBeVisible();
  await expect(page.getByText('Lo que más falta en el sitio')).toBeVisible();

  // Open the first page: every check with its result and, when it fails, how to fix it.
  await page.getByRole('button', { expanded: false }).filter({ hasText: 'por mejorar' }).first().click();
  const checks = page.getByRole('list', { name: /^Revisiones de / });
  await expect(checks).toContainText('Respuesta directa al inicio');
  await expect(checks).toContainText('Contenido visible sin JavaScript');
  await expect(checks.getByText('Cómo mejorarlo:').first()).toBeVisible();

  // Filter by one failing check.
  await page.getByLabel('Falla en').selectOption('schema');
  await expect(page.getByRole('heading', { name: /^Páginas \(\d+\)$/ })).toBeVisible();
});
