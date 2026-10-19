import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Autoridad y SERP: upload a backlinks CSV, see live and lost links; SERP tab asks for the SerpAPI key', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  // The fixture home links to https://external.example.org/x, so that is "our" site here.
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Autoridad Flow', domain: 'external.example.org', canonicalUrl: 'https://external.example.org' } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Autoridad y SERP', exact: true }).click();

  await expect(page.getByText('Todavía no subes un archivo de backlinks.')).toBeVisible();
  await page.getByLabel('CSV de backlinks').setInputFiles({ name: 'gsc-enlaces.csv', mimeType: 'text/csv', buffer: Buffer.from(`Linking page,Last crawled\n${site.origin}/,2026-10-01\n${site.origin}/about,2026-10-01\n`) });
  await expect(page.getByText(/2 de 2 revisados/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Vivos', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Perdidos/ }).click();
  await expect(page.getByRole('link', { name: `${site.origin}/about` })).toBeVisible();
  await page.getByRole('tab', { name: 'Todos' }).click();
  await expect(page.getByRole('link', { name: `${site.origin}/`, exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'SERP e IA' }).click();
  await expect(page.getByText(/Falta la clave de SerpAPI/)).toBeVisible();
  await page.getByLabel('Nuevas keywords').fill('sillas ergonómicas, escritorios de pie');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByRole('button', { name: 'Quitar sillas ergonómicas' })).toBeVisible();
  await expect(page.getByText(/2 de 100 keywords/)).toBeVisible();
});
