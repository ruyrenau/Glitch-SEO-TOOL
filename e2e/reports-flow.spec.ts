import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Reportes: create a client report, open the public link without login, download the PDF and revoke it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'Cliente Reporte', domain: 'reporte.example.com', canonicalUrl: 'https://reporte.example.com' } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Reportes', exact: true }).click();

  await page.getByLabel('Título del reporte').fill('Reporte E2E');
  await page.getByRole('button', { name: 'Crear reporte' }).click();
  await expect(page.getByText('Reporte creado.', { exact: false })).toBeVisible();
  await expect(page.getByText('Reporte E2E')).toBeVisible();

  const [report] = await (await page.request.get(`http://localhost:4000/api/v1/sites/${id}/reports`)).json();

  // The client opens it in a fresh browser with no session.
  const ctx = await browser.newContext();
  const client = await ctx.newPage();
  await client.goto(`/r/${report.token}`);
  await expect(client.getByRole('heading', { name: 'Reporte E2E' })).toBeVisible();
  await expect(client.getByText('Este sitio todavía no tiene datos de Search Console conectados.')).toBeVisible();
  await expect(client.locator('[data-report-ready]')).toBeAttached();

  // PDF download.
  const pdf = await page.request.get(`http://localhost:4000/api/v1/reports/${report.id}/pdf`, { timeout: 90_000 });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  // Revoke: the link stops working.
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByText('Retirado', { exact: false })).toBeVisible();
  await client.reload();
  await expect(client.getByText('Este reporte no existe, caducó o fue retirado.')).toBeVisible();
  await ctx.close();
});
