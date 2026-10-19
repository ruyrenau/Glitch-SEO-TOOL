import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Experimentos SEO y Brechas de contenido: record an experiment and explain what is missing to run each', async ({ page }) => {
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Exp Flow', domain: 'expflow.example.com', canonicalUrl: 'https://expflow.example.com' } })).json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);

  // Experiments: without Search Console the form still saves, and says what is needed to analyse.
  await page.getByRole('button', { name: 'Experimentos SEO', exact: true }).click();
  await expect(page.getByText('Para analizar necesitas Search Console')).toBeVisible();
  await page.getByLabel('Nombre del experimento').fill('Precio en títulos');
  await page.getByLabel('Fecha del cambio').fill('2026-09-01');
  await page.getByLabel('Hipótesis').fill('El precio en el título sube el CTR');
  await page.getByLabel('Páginas cambiadas').fill('https://expflow.example.com/servicios\nhttps://expflow.example.com/precios');
  await page.getByRole('button', { name: 'Guardar experimento' }).click();
  await expect(page.getByText('Cambio el 2026-09-01 · 2 página(s) · control: el resto del sitio')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar' }).click();
  await expect(page.getByText(/Search Console/).filter({ hasText: /Conecta/ })).toBeVisible();

  // Gaps: needs the SerpAPI key.
  await page.getByRole('button', { name: 'Brechas de contenido', exact: true }).click();
  await page.getByLabel('Competidores').fill('rival.com');
  await page.getByLabel('Keywords a revisar').fill('auditoria seo\nconsultor seo');
  await expect(page.getByText('(2 keywords)')).toBeVisible();
  await page.getByRole('button', { name: 'Buscar brechas' }).click();
  await expect(page.getByText(/clave de SerpAPI/)).toBeVisible();
});
