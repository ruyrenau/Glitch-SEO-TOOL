import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { startFixtureSite, FixtureSite } from '../packages/testing/src/fixture-site';

let site: FixtureSite;
test.beforeAll(async () => {
  site = await startFixtureSite();
});
test.afterAll(async () => site.close());

test('Agentes de IA: audits pages as an agent and builds the catalog for agents', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const api = 'http://localhost:4000';
  const { id } = await (await page.request.post(`${api}/api/v1/sites`, { data: { name: 'Agentes Flow', domain: '127.0.0.1', canonicalUrl: site.origin } })).json();

  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Agentes de IA', exact: true }).click();

  await page.getByLabel('Páginas a revisar').fill(`${site.origin}/`);
  await page.getByRole('button', { name: 'Revisar como agente' }).click();
  await expect(page.getByText('Puntaje para agentes')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Lo que más falla')).toBeVisible();

  await page.getByRole('tab', { name: 'Catálogo para agentes (MCP)' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Agencia Flow');
  await page.getByLabel('Sitio', { exact: true }).fill(`${site.origin}/`);
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByLabel('Nombre 1').fill('Auditoría SEO');
  await page.getByLabel('Precio 1').fill('4999');
  await page.getByRole('button', { name: 'Guardar catálogo' }).click();
  await expect(page.getByRole('status')).toHaveText('Catálogo guardado.');
  await page.getByText('Vista previa de agent.json').click();
  await expect(page.getByLabel('Vista previa de agent.json')).toContainText('"name": "Agencia Flow"');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar glitch-agents.php' }).click();
  expect((await dl).suggestedFilename()).toBe('glitch-agents.php');
});
