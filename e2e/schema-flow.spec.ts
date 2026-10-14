import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Schema.org generator: any business type, live validation, prefill from a page, bulk CSV and validator', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Schema.org', exact: true }).click();

  // 1. From scratch: a dentist (local business). Google needs name and address.
  await page.getByLabel('Tipo del schema 1').selectOption('LocalBusiness');
  await page.getByLabel('Variante del schema 1').selectOption('Dentist');
  await expect(page.getByText('Hay que corregir')).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill('Clínica Dental Sonrisa');
  await page.getByLabel('Dirección › Calle y número').fill('Av. Juárez 123');
  await page.getByLabel('Dirección › Ciudad').fill('Puebla');
  await page.getByLabel('Teléfono', { exact: true }).fill('+52 222 123 4567');
  await expect(page.getByText('Listo para Google')).toBeVisible();
  const out = page.getByLabel('JSON-LD generado');
  await expect(out).toContainText('"@type": "Dentist"');
  await expect(out).toContainText('"@type": "PostalAddress"');
  await expect(out).toContainText('<script type="application/ld+json">');

  // A format error is explained in Spanish, by field.
  await page.getByLabel('URL de la página', { exact: true }).fill('/sin-dominio');
  await expect(page.getByText(/"url" debe ser una URL completa/).first()).toBeVisible();
  await page.getByLabel('URL de la página', { exact: true }).fill('');

  // 2. Prefill from a real page of the fixture site.
  await page.getByLabel('Página a leer').fill(`${site.origin}/`);
  await page.getByRole('button', { name: 'Rellenar desde la página' }).click();
  await expect(page.getByText('Listo: revisa y completa los campos.')).toBeVisible();
  await expect(page.getByText(/Es la página de inicio/).first()).toBeVisible();
  await expect(page.getByText(/Esta página ya tiene schema: Organization/)).toBeVisible();

  // 3. Bulk: a product template with {{columns}} and a CSV.
  await page.getByLabel('Tipo del schema 1').selectOption('Product');
  await page.getByRole('region', { name: 'Schema 1' }).getByLabel('Nombre', { exact: true }).fill('{{nombre}}');
  await page.getByRole('tab', { name: 'Masivo (CSV)' }).click();
  await page.getByLabel('Contenido CSV').fill('nombre,precio\nSilla,1499\nMesa,899\n');
  await expect(page.getByText(/Columnas que usa la plantilla:/)).toContainText('nombre');
  await expect(page.getByText(/de 2 válidos/)).toBeVisible();

  // 4. Validator with a broken block.
  await page.getByRole('tab', { name: 'Validador' }).click();
  await page.getByLabel('JSON-LD a validar').fill('{"@context":"https://schema.org","@type":"Event","name":"Feria"}');
  await expect(page.getByText(/Google exige "Inicio"/)).toBeVisible();
});
