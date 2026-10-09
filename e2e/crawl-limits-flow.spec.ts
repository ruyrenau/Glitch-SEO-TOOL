import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('list mode and Screaming Frog-style limits from the crawl form', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Limits Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Crawl y auditoría' }).click();

  // 1. List mode: exactly two URLs.
  await page.getByRole('radio', { name: 'Lista de URLs' }).click();
  await page.getByLabel('URLs a revisar').fill(`${site.origin}/about\n${site.origin}/missing\n${site.origin}/about`);
  await expect(page.getByText('2 URLs.')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  const listRow = page.getByRole('row').filter({ hasText: 'lista' });
  await expect(listRow.getByRole('cell', { name: /completed/ })).toBeVisible({ timeout: 60_000 });
  await expect(listRow.getByRole('cell', { name: '2', exact: true }).first()).toBeVisible();

  // 2. Site mode with a per-folder limit: the history says how many URLs it skipped and why.
  await page.getByRole('radio', { name: 'Rastrear el sitio' }).click();
  await page.getByLabel('Solicitudes / segundo').fill('20');
  await page.getByText('Límites avanzados (como Screaming Frog)').click();
  await page.getByLabel('URLs por carpeta').fill('2');
  await expect(page.getByText(/Con límites activos el crawl es parcial/)).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  await expect(page.getByText(/Omitidas: .*por carpeta \d+/)).toBeVisible({ timeout: 60_000 });
});
