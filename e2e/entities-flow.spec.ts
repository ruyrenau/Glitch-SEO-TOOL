import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Entidades y E-E-A-T: organization, author, page graph and audit; consolidation tab', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Entidades Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();
  await page.request.post(`${api}/api/v1/sites/${id}/crawls`, { data: {} });
  await expect.poll(async () => (await (await page.request.get(`${api}/api/v1/sites/${id}/crawls`)).json()).some((r: { status: string }) => r.status === 'completed'), { timeout: 60_000 }).toBe(true);

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Entidades y E-E-A-T', exact: true }).click();
  await expect(page.getByText('Puntaje E-E-A-T')).toBeVisible();

  // Organization.
  await page.getByRole('tab', { name: 'Organización' }).click();
  await page.getByLabel('Nombre de la organización').fill('Agencia SEO Puebla');
  await page.getByLabel('Logo').fill(`${site.origin}/a.png`);
  await page.getByLabel('Descripción de la organización').fill('Agencia de SEO técnico en Puebla.');
  await page.getByLabel('Teléfono').fill('+52 222 000 0000');
  await page.getByLabel('Perfiles oficiales').fill('https://www.linkedin.com/company/agencia\n\nhttps://www.facebook.com/agencia');
  await page.getByRole('button', { name: 'Guardar organización' }).click();
  await expect(page.getByText('Organización guardada.')).toBeVisible();

  // Author.
  await page.getByRole('tab', { name: /^Autores/ }).click();
  await page.getByLabel('Nombre del autor').fill('Ana López');
  await page.getByLabel('Biografía').fill('Consultora de SEO técnico con diez años de experiencia en auditorías y migraciones de sitios grandes.');
  await page.getByRole('button', { name: 'Agregar autor' }).click();
  await expect(page.getByText('Falta: foto, página de autor, perfiles')).toBeVisible();

  // A page: assign the author and see the connected graph.
  await page.getByRole('tab', { name: 'Páginas' }).click();
  await page.getByRole('button', { expanded: false }).filter({ hasText: '/about' }).first().click();
  await page.getByLabel('Tipo de página').selectOption('AboutPage');
  await page.getByLabel('Autor de la página').selectOption({ label: 'Ana López' });
  await page.getByRole('button', { name: 'Guardar página' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  await expect(page.getByLabel('JSON-LD de la página')).toContainText('#organization');
  await expect(page.getByLabel('JSON-LD de la página')).toContainText('"@type": "AboutPage"');

  // Audit reflects the profile.
  await page.getByRole('tab', { name: 'Auditoría E-E-A-T' }).click();
  await expect(page.getByRole('region', { name: 'Organización' })).toContainText('Perfil de la organización completo');

  // Consolidation lives in Análisis de contenido.
  await page.getByRole('button', { name: 'Análisis de contenido', exact: true }).click();
  await page.getByRole('tab', { name: 'Consolidación' }).click();
  await expect(page.getByRole('region', { name: 'Candidatas a consolidar' })).toBeVisible();
});
