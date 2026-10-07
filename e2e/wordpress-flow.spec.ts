import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startMockWordPress, MockWordPress } from '../packages/testing/src/mock-wordpress';

let wp: MockWordPress;
test.beforeAll(async () => {
  wp = await startMockWordPress();
});
test.afterAll(async () => wp.close());

test('generate, approve and send a page to WordPress as a draft, then resolve a conflict', async ({ page }) => {
  await login(page);
  page.on('dialog', d => d.accept());
  const created = await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'WP Flow', domain: 'wpflow.example.com', canonicalUrl: 'https://wpflow.example.com' } });
  const { id } = await created.json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);

  // 1. Connect WordPress (credentials are stored encrypted and never shown again).
  await page.getByRole('button', { name: 'WordPress' }).click();
  await page.getByLabel('URL del sitio WordPress').fill(wp.url);
  await page.getByLabel('Usuario').fill(wp.username);
  await page.getByLabel(/Contraseña de aplicación/).fill(wp.appPassword);
  await page.getByRole('button', { name: 'Guardar y probar' }).click();
  await expect(page.getByText('✓ Conectado a "Mock WP" como Editor.')).toBeVisible();
  await expect(page.getByText('SEO #7')).toBeVisible();

  // 2. Generate a page from the template.
  await page.getByRole('button', { name: 'genera y aprueba páginas' }).click();
  await page.getByText('Página individual (sin dataset)').click();
  await page.getByRole('button', { name: 'Generar y evaluar calidad' }).click();
  await expect(page.getByText('Auditoría SEO técnica en Puebla', { exact: true })).toBeVisible();

  // 3. Sending is impossible before approval; approve as a named reviewer.
  await expect(page.getByRole('button', { name: 'Enviar como borrador' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(page.getByText('Aprobada', { exact: true })).toBeVisible();

  // 4. Dry run shows what would be created; nothing is sent.
  await page.getByRole('button', { name: 'Dry run' }).click();
  await expect(page.getByText(/se crearía un borrador nuevo/)).toBeVisible();
  expect(wp.posts.size).toBe(0);

  // 5. Send as draft.
  await page.getByRole('button', { name: 'Enviar como borrador' }).click();
  await expect(page.getByText('Borrador en WordPress', { exact: true })).toBeVisible();
  expect([...wp.posts.values()][0]).toMatchObject({ status: 'draft', slug: 'auditoria-seo-puebla' });

  // 6. Someone edits the draft in wp-admin; the next update shows a conflict instead of overwriting.
  const postId = [...wp.posts.keys()][0];
  wp.humanEdit(postId, '<p>Texto editado por el equipo</p>');
  await page.getByRole('button', { name: 'Actualizar borrador' }).click();
  await expect(page.getByText(/se editó en WordPress después del último envío/)).toBeVisible();
  expect(wp.posts.get(postId)!.content).toBe('<p>Texto editado por el equipo</p>');
  await page.getByRole('button', { name: 'Sobrescribir cambios remotos' }).click();
  await expect(page.getByText(/se editó en WordPress después del último envío/)).toHaveCount(0);
  expect(wp.posts.get(postId)!.content).toContain('Auditoría SEO técnica en Puebla');
  expect(wp.posts.get(postId)!.status).toBe('draft');
});
