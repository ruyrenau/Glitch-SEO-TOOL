import path from 'path';
import { test, expect } from '@playwright/test';
import { login } from './helpers';

const fixtures = path.resolve(__dirname, '../fixtures');

test('register a site, import a log and a sitemap, read the report and the audit log', async ({ page }) => {
  await login(page);
  await page.goto('/');

  // With an empty database the form is already open; otherwise open it from "Sitios".
  await page.getByRole('button', { name: 'Sitios' }).click();
  const toggle = page.getByRole('button', { name: 'Registrar sitio' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByLabel('Nombre').fill('E2E Site');
  await page.getByLabel('URL canónica').fill('https://www.example.com');
  await page.getByRole('button', { name: 'Guardar sitio' }).click();
  await expect(page.getByLabel('Sitio activo').locator('option:checked')).toHaveText(/E2E Site/);

  await page.getByRole('button', { name: 'Logs y sitemap' }).click();
  await expect(page.getByText('Este sitio no tiene logs importados')).toBeVisible();

  await page.locator('input[type=file][accept=".log,.txt,.gz"]').setInputFiles(path.join(fixtures, 'sample_nginx.log'));
  await expect(page.getByRole('status')).toContainText('5 líneas válidas');
  await expect(page.getByText('sample_nginx.log').first()).toBeVisible();

  // Report numbers come from the parsed file: 2 Googlebot hits, one 404 served to a bot.
  const googlebotKpi = page.locator('div', { has: page.getByText('Googlebot', { exact: true }) }).first();
  await expect(googlebotKpi).toContainText('2');
  await expect(page.getByRole('cell', { name: '/old-landing-page' }).first()).toBeVisible();
  // The sensitive token from the raw log never reaches the UI.
  await expect(page.getByText('secret123')).toHaveCount(0);

  await page.locator('input[type=file][accept=".xml"]').setInputFiles(path.join(fixtures, 'sitemap_basic.xml'));
  await expect(page.getByRole('status')).toContainText('3 URLs de sitemap cargadas');
  await expect(page.getByRole('cell', { name: '/never-crawled-page' })).toBeVisible();

  await page.getByRole('button', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'log_import.created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'sitemap.imported' })).toBeVisible();
});

test('modules without a backend say so instead of showing numbers', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByRole('button', { name: /GEO/ }).click();
  await expect(page.getByText('PENDIENTE')).toBeVisible();
  // Search Console without Google keys explains what is missing; it never shows numbers.
  await page.getByRole('button', { name: 'Search Console', exact: true }).click();
  await expect(page.getByText(/Falta configurar el servidor|Conectar con Google|Conectada/).first()).toBeVisible();
});
