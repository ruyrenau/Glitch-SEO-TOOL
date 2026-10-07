import path from 'path';
import { test, expect } from '@playwright/test';
import { startMockWordPress, MockWordPress } from '../packages/testing/src/mock-wordpress';

let wp: MockWordPress;
test.beforeAll(async () => {
  wp = await startMockWordPress();
});
test.afterAll(async () => wp.close());

const BODY = [
  '<h1>{{servicio}} en {{ciudad}}</h1>',
  '<p>{{descripcion}}</p>',
  '<h2>Contexto local</h2><p>{{dato_local}}</p>',
  '<h2>Cómo trabajamos</h2>',
  '<p>Empezamos con una revisión de logs del servidor y un rastreo controlado del sitio. Después priorizamos los problemas por impacto y esfuerzo, y acordamos con tu equipo qué corregir primero.</p>',
  '<p>Cada recomendación incluye evidencia por URL y un criterio para verificar que quedó resuelta.</p>',
  '<h2>Qué recibes</h2><ul><li>Un reporte priorizado con las URLs afectadas y la causa de cada problema.</li><li>Una sesión de revisión con tu equipo de desarrollo o tu agencia.</li><li>Un segundo rastreo para confirmar que los cambios funcionaron.</li></ul>',
  '<p>Precio de referencia: {{precio}} MXN.</p>'
].join('\n');

test('import a CSV, build a template, generate in batch, approve and send in bulk', async ({ page, request }) => {
  page.on('dialog', d => d.accept());
  const { id } = await (await request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Datasets E2E', domain: 'ds-e2e.example.com', canonicalUrl: 'https://ds-e2e.example.com' } })).json();
  await request.put(`http://localhost:4000/api/v1/sites/${id}/wordpress`, { data: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
  await request.post(`http://localhost:4000/api/v1/sites/${id}/wordpress/test`);

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Contenido programático' }).click();

  await page.locator('input[type=file][accept=".csv,.tsv,.txt"]').setInputFiles(path.resolve(__dirname, '../fixtures/servicios_ciudades.csv'));
  await expect(page.getByText('⚠ Filas duplicadas: 9')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /\{\{precio\}\}/ })).toBeVisible();

  await page.getByText('Nueva plantilla para este dataset').click();
  const tpl = page.locator('details', { hasText: 'Nueva plantilla para este dataset' });
  await tpl.getByLabel('Nombre', { exact: true }).fill('Servicio por ciudad');
  await tpl.getByLabel('Título').fill('{{servicio}} en {{ciudad}}: auditoría y mejora continua');
  await tpl.getByLabel('Meta description').fill('{{servicio}} en {{ciudad}} desde {{precio}} MXN, con evidencia por URL y un plan priorizado.');
  await tpl.getByLabel('Slug').fill('{{servicio}}-{{ciudad}}');
  await tpl.getByLabel('Cuerpo HTML (sin scripts)').fill(BODY);
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();

  await page.getByRole('button', { name: 'Generar páginas' }).click();
  await expect(page.getByText('11 páginas generadas.')).toBeVisible();
  await expect(page.getByText(/Fila 9 omitida: Slug already exists/)).toBeVisible();

  await page.getByLabel('Filtrar por estado').selectOption('READY_FOR_APPROVAL');
  await page.getByPlaceholder('Tu nombre').fill('Ana');
  await page.getByLabel(/Seleccionar \d+ visibles/).check();
  const ready = Number((await page.getByText(/\d+ seleccionadas/).textContent())!.split(' ')[0]);
  expect(ready).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: 'Aprobar seleccionadas' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Aprobadas: ${ready} de ${ready}.` })).toBeVisible();

  await page.getByLabel('Filtrar por estado').selectOption('APPROVED');
  await page.getByLabel(/Seleccionar \d+ visibles/).check();
  await page.getByRole('button', { name: 'Enviar seleccionadas como borrador' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Enviadas como borrador: ${ready} de ${ready}.` })).toBeVisible();
  expect(wp.posts.size).toBe(ready);
  expect([...wp.posts.values()].every(p => p.status === 'draft')).toBe(true);
});
