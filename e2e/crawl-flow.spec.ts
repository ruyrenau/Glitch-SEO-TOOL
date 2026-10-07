import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('crawl a site from the dashboard and triage an issue', async ({ page }) => {
  await login(page);
  // Create the site through the API (UI creation is covered by logs-flow).
  const created = await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Fixture Crawl', domain: '127.0.0.1', canonicalUrl: site.origin } });
  const { id } = await created.json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Crawl y auditoría' }).click();
  await page.getByLabel('Solicitudes / segundo').fill('20');
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();

  await expect(page.getByRole('cell', { name: 'completed' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.getByRole('heading', { name: /Páginas rastreadas \(\d+\)/ })).toBeVisible();
  await page.getByLabel('Estado HTTP').selectOption('error');
  await expect(page.getByRole('cell', { name: '/error' })).toBeVisible();

  await page.getByRole('button', { name: 'Issues técnicos' }).click();
  const fiveXX = page.getByRole('button', { name: /Internal URLs returning 5xx/ });
  await expect(fiveXX).toBeVisible();
  await fiveXX.click();
  await expect(page.getByText(`${site.origin}/error`)).toBeVisible();

  await page.getByLabel('Cambiar estado de Internal URLs returning 5xx').selectOption('ignored');
  await expect(page.getByRole('button', { name: /Internal URLs returning 5xx/ })).toHaveCount(0);
  await page.getByLabel('Estado', { exact: true }).selectOption('ignored');
  await expect(page.getByRole('button', { name: /Internal URLs returning 5xx/ })).toBeVisible();
});

test('a bad deploy between two crawls raises alerts and shows up in the diff', async ({ page }) => {
  await login(page);
  site.setVersion(1);
  const created = await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Fixture Regressions', domain: '127.0.0.1', canonicalUrl: site.origin } });
  const { id } = await created.json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Crawl y auditoría' }).click();
  await page.getByLabel('Solicitudes / segundo').fill('20');
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  await expect(page.getByRole('cell', { name: 'completed' })).toHaveCount(1, { timeout: 30_000 });

  site.setVersion(2);
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  await expect(page.getByRole('cell', { name: 'completed' })).toHaveCount(2, { timeout: 30_000 });
  // The worker has finished when the "in progress" card is gone and a new crawl can start.
  await expect(page.getByRole('button', { name: 'Iniciar crawl' })).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Ver detalle' }).first().click();
  await expect(page.getByText('Cambios respecto al crawl anterior')).toBeVisible();
  await page.getByRole('button', { name: /noindex añadido · 1/ }).click();
  await expect(page.getByRole('cell', { name: '/about' })).toBeVisible();

  await page.getByRole('button', { name: 'Alertas' }).click();
  await expect(page.getByText('noindex añadido')).toBeVisible();
  await expect(page.getByText('1 page(s) that were indexable now have noindex')).toBeVisible();
  const before = await page.getByRole('button', { name: 'Marcar como revisada' }).count();
  await page.getByRole('button', { name: 'Marcar como revisada' }).first().click();
  await expect(page.getByRole('button', { name: 'Marcar como revisada' })).toHaveCount(before - 1);
});
