import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Monitoreo: off by default, turn on a weekly crawl, run it now and see the evolution', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Monitor Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Monitoreo', exact: true }).click();

  // Everything starts off; Search Console cannot be turned on without a property.
  await expect(page.getByRole('switch', { name: 'Crawl automático' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Core Web Vitals automático' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Importación diaria de Search Console' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ejecutar ahora lo activo' })).toBeDisabled();

  await page.getByRole('switch', { name: 'Crawl automático' }).click();
  await page.getByLabel('Frecuencia del crawl').selectOption('weekly');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  await expect(page.getByText(/^Próximo:/)).toBeVisible();

  // Run it twice so there is something to compare.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Ejecutar ahora lo activo' }).click();
    await expect(page.getByText(/En marcha: crawl/)).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`http://localhost:4000/api/v1/sites/${id}/crawls`)).json()).filter((r: { status: string }) => r.status === 'completed').length, { timeout: 60_000 }).toBe(i + 1);
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Monitoreo', exact: true }).click();

  await expect(page.getByRole('img', { name: 'Páginas indexables por crawl' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Páginas con error por crawl' })).toBeVisible();
  await expect(page.getByText(/Crawl: \d+ URLs/).first()).toBeVisible();
  await page.getByText('Ver los datos en tabla').click();
  await expect(page.getByRole('cell', { name: /\d+/ }).first()).toBeVisible();

  // Turn it off again (the schedule is removed).
  await page.getByRole('switch', { name: 'Crawl automático' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/^Próximo:/)).toHaveCount(0);
});
