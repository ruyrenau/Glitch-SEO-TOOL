import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * One-click WordPress connection against a REAL WordPress with the G.SEO – SEO plugin
 * (WordPress Playground on :9400, started by hand: see docs/wordpress/testing/README.md).
 * Skipped when that WordPress is not running.
 */
const WP = 'http://127.0.0.1:9400';

test('Conexión de un clic: desde el plugin, aprobar en WordPress y volver conectado', async ({ page, request }) => {
  test.setTimeout(120_000);
  const up = await request.get(`${WP}/wp-json/`).then(r => r.ok(), () => false);
  test.skip(!up, 'WordPress Playground no está corriendo en :9400');

  // Logged in to WordPress first (as the person clicking the plugin button would be).
  await page.goto(`${WP}/wp-login.php`);
  await page.getByLabel('Username or Email Address').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL(/wp-admin/);

  // The plugin's "Conectar con G.SEO" button (status tab), pointed at this G.SEO.
  await page.goto(`${WP}/wp-admin/options-general.php?page=gseo-seo&tab=status`);
  await page.getByLabel('Dirección de G.SEO').fill('http://localhost:3000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  const href = await page.getByRole('link', { name: /onectar con G\.SEO/ }).getAttribute('href');
  expect(href).toBe(`http://localhost:3000/?nav=wordpress&wpconnect=${encodeURIComponent(`${WP}/`)}`);

  await login(page);
  await page.goto(href!);
  await expect(page.getByText(/quiere conectarse/)).toBeVisible();
  await expect(page.getByLabel('Sitio de G.SEO para esta conexión')).toHaveValue('new');
  await page.getByRole('button', { name: 'Continuar a WordPress' }).click();

  // WordPress's own approval screen.
  await page.waitForURL(/authorize-application\.php/);
  await expect(page.getByText(/G\.SEO/).first()).toBeVisible();
  await page.getByRole('button', { name: /Yes, I approve of this connection/i }).click();

  // Back in G.SEO, connected and tested, on the new site.
  await page.waitForURL(/localhost:3000/);
  await expect(page.getByText('✅ WordPress quedó conectado y probado.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Estado en el WordPress conectado' }).or(page.getByLabel('Estado en el WordPress conectado'))).toContainText('G.SEO – SEO');
  await expect(page.getByLabel('Sitio activo')).toContainText('127.0.0.1');

  // The plugin now shows the connection.
  await page.goto(`${WP}/wp-admin/options-general.php?page=gseo-seo&tab=status`);
  await expect(page.getByText('Conectado').first()).toBeVisible();
});
