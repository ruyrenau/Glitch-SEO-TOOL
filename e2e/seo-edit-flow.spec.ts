import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startMockWordPress, MockWordPress } from '../packages/testing/src/mock-wordpress';

let wp: MockWordPress;
test.beforeAll(async () => {
  wp = await startMockWordPress();
});
test.afterAll(async () => wp.close());

test('edit a live title from the SEO explorer, approve, apply, verify and revert', async ({ page }) => {
  test.setTimeout(120_000);
  const img = wp.addMedia({ file: 'equipo.png', alt: '' });
  const post = wp.addPublished({ slug: 'servicios-seo', title: 'Servicios', seoTitle: '', metaDescription: 'Vieja', imageIds: [img.id] });
  await login(page);
  page.on('dialog', d => d.accept());
  const host = new URL(wp.url);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Live edit', domain: host.hostname, canonicalUrl: wp.url } })).json();
  await page.request.put(`http://localhost:4000/api/v1/sites/${id}/wordpress`, { data: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Crawl y auditoría' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar crawl' })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar crawl' }).click();
  await expect(page.getByRole('heading', { name: /Páginas rastreadas \(\d+\)/ })).toBeVisible({ timeout: 60_000 });

  // Explorer: open the post and propose a new SEO title.
  await page.getByRole('button', { name: 'Explorador SEO', exact: true }).click();
  await page.getByRole('button', { name: 'Títulos', exact: true }).click();
  await page.getByRole('button', { name: '/servicios-seo/' }).click();
  await page.getByRole('tab', { name: 'Editar en WordPress' }).click();
  await expect(page.getByText('Yoast SEO')).toBeVisible();
  await page.getByLabel('Nuevo valor: Título SEO (etiqueta <title>)').fill('Servicios de SEO técnico en Puebla | Glitch');
  await page.getByLabel('Nota: Título SEO (etiqueta <title>)').fill('Título muy corto');
  await page.getByRole('button', { name: 'Proponer cambio' }).nth(2).click();
  await expect(page.getByText(/Cambio propuesto/)).toBeVisible();
  expect(wp.posts.get(post.id)!.meta!._yoast_wpseo_title).toBe(''); // nothing changes until approved and applied

  // Cambios SEO: approve, apply, verify, revert.
  await page.getByRole('button', { name: 'Cambios SEO', exact: true }).first().click();
  await page.getByRole('button', { name: 'Aprobar' }).click();
  await page.getByRole('button', { name: 'Aplicar en WordPress' }).click();
  await expect(page.getByRole('listitem').getByText('Aplicado', { exact: true })).toBeVisible();
  expect(wp.posts.get(post.id)!.meta!._yoast_wpseo_title).toBe('Servicios de SEO técnico en Puebla | Glitch');
  expect(wp.posts.get(post.id)!.status).toBe('publish');
  await page.getByRole('button', { name: 'Verificar en la página' }).click();
  await expect(page.getByText('Verificado en la página')).toBeVisible();
  await page.getByRole('button', { name: 'Revertir' }).click();
  await expect(page.getByRole('listitem').getByText('Revertido', { exact: true })).toBeVisible();
  expect(wp.posts.get(post.id)!.meta!._yoast_wpseo_title).toBe('');
});
