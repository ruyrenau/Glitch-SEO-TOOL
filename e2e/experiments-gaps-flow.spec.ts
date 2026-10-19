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

test('Menú por secciones y Overview como tablero de todos los módulos', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation');
  // Inicio guiado, Overview y Monitoreo siempre a la vista; el resto en secciones desplegables.
  await page.getByRole('button', { name: 'Contraer todas las secciones del menú' }).click();
  await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Monitoreo', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Crawl y auditoría', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'SEO técnico' }).click();
  await expect(nav.getByRole('button', { name: 'SEO técnico' })).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('button', { name: 'Crawl y auditoría', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Listo para IA', exact: true })).toHaveCount(0);
  // Remembered after a reload.
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Crawl y auditoría', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expandir todas las secciones del menú' }).click();
  await expect(nav.getByRole('button', { name: 'Listo para IA', exact: true })).toBeVisible();

  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Desk Flow', domain: 'desk.example.com', canonicalUrl: 'https://desk.example.com' } })).json();
  await page.request.post(`${api}/api/v1/sites/${id}/experiments`, { data: { name: 'H1 con ciudad', changeDate: '2026-08-01', testUrls: ['https://desk.example.com/a'] } });
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await nav.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos los módulos' })).toBeVisible();
  const exp = page.getByRole('region', { name: 'Experimentos SEO' });
  await expect(exp).toContainText('H1 con ciudad');
  await expect(exp).toContainText('Sin analizar');
  // A module never used invites to start it, and the link goes there.
  const crawl = page.getByRole('region', { name: 'Crawl y salud técnica' });
  await expect(crawl).toContainText('Haz un crawl');
  await crawl.getByRole('button', { name: 'Empezar →' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar crawl' })).toBeVisible();
});
