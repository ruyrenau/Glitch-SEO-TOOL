import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

// Real Lighthouse in a local browser (no PSI key in E2E): grade, issues filter, page weight, waterfall, filmstrip.
test('performance report: screenshot, grade, filterable issues, weight by type and waterfall', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Perf Report', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Core Web Vitals', exact: true }).click();

  // Only /about: untick the suggested home page.
  const home = page.getByRole('checkbox', { name: `${site.origin}/`, exact: true });
  if (await home.count()) await home.uncheck();
  await page.getByLabel('Otras URLs del sitio (una por línea)').fill(`${site.origin}/about`);
  const mobile = page.getByRole('checkbox', { name: 'Móvil' });
  if (await mobile.isChecked()) await mobile.uncheck();
  await page.getByRole('checkbox', { name: 'Escritorio' }).check();
  await page.getByRole('button', { name: 'Medir' }).click();

  await expect(page.getByRole('heading', { name: 'Reporte de rendimiento' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('img', { name: /Captura de/ })).toBeVisible();
  await expect(page.getByText(/^[A-F]$/).first()).toBeVisible();
  await expect(page.getByText('Rendimiento', { exact: true })).toBeVisible();
  await expect(page.getByText('Estructura', { exact: true })).toBeVisible();
  await expect(page.getByText(/Peso total:/)).toBeVisible();
  await expect(page.getByText(/Peticiones: \d+/)).toBeVisible();

  // The fixture page loads a CSS and two scripts in <head> (render-blocking) and one is missing.
  await page.getByRole('tab', { name: 'CLS' }).click();
  await page.getByRole('tab', { name: 'Todos', exact: true }).click();
  await page.getByRole('tab', { name: 'Cascada' }).click();
  await expect(page.getByRole('cell', { name: /about/ }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'missing.js' }).getByRole('cell', { name: '404' })).toBeVisible();
  await page.getByRole('tab', { name: /^CSS \(\d+\)$/ }).click();
  await expect(page.getByRole('cell', { name: /style\.css/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /app\.js/ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Resumen' }).click();
  await page.getByRole('tab', { name: 'Cascada' }).click();
  await page.getByRole('tab', { name: /^Todas \(\d+\)$/ }).click();
  await page.getByRole('tab', { name: 'Carga visual' }).click();
  await expect(page.getByRole('img', { name: /Página a los/ }).first()).toBeVisible();
});
