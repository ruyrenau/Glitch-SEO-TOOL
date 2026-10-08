import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('guided setup: add a URL, crawl it, see findings and jump to a section', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.getByRole('button', { name: 'Inicio guiado' }).click();
  await expect(page.getByText('En tres pasos tendrás tu primera auditoría SEO.')).toBeVisible();

  // Step 1: a new site from its URL.
  // With sites already present, step 1 starts on the active site.
  const change = page.getByRole('button', { name: 'Cambiar de sitio' });
  if (await change.isVisible()) await change.click();
  const newSite = page.getByLabel('Un sitio nuevo');
  if (await newSite.count()) await newSite.check();
  await page.getByLabel('URL a analizar').fill('no es una url');
  await expect(page.getByText('Esa dirección no parece válida.')).toBeVisible();
  await page.getByLabel('URL a analizar').fill(site.origin);
  await page.getByLabel('Nombre del sitio').fill('Sitio del asistente');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.getByText('Sitio elegido:')).toBeVisible();
  await expect(page.getByLabel('Sitio activo')).toHaveValue(/.+/);

  // Step 2: crawl with the default size.
  await expect(page.getByLabel('Cuántas páginas')).toHaveValue('500');
  await page.getByRole('button', { name: 'Empezar el crawl' }).click();

  // Step 3: plain-language findings.
  await expect(page.getByText('Lo primero que revisaría')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('páginas que no existen (4xx)')).toBeVisible();
  await expect(page.getByText('páginas con error del servidor (5xx)')).toBeVisible();
  await expect(page.getByText('títulos duplicados')).toBeVisible();

  // Section cards take you there.
  await page.getByRole('button', { name: 'Ir a Issues técnicos' }).click();
  await expect(page.getByRole('heading', { name: 'Issues técnicos', level: 1 })).toBeVisible();
});
