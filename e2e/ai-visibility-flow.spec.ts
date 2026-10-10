import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Visibilidad en IA: question, two checks with Directo/Citación, matrix and trend; keys in Configuración', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'IA Flow', domain: 'ia.example.com', canonicalUrl: 'https://ia.example.com' } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Visibilidad en IA', exact: true }).click();

  await page.getByRole('tab', { name: /Preguntas/ }).click();
  await page.getByLabel('Nueva pregunta', { exact: true }).fill('¿Cuál es la mejor maestría en políticas públicas en línea?');
  await page.getByLabel('Keyword de la nueva pregunta').fill('Políticas Públicas');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('Pregunta agregada.')).toBeVisible();

  // Week 1 in ChatGPT: mentioned first (5) and cited in the top 3 (2).
  await page.getByRole('tab', { name: 'Registrar revisión' }).click();
  await expect(page.getByLabel('Keyword', { exact: true })).toHaveValue('Políticas Públicas');
  await page.getByLabel('Fecha').fill('2026-09-28');
  const aparece = page.getByRole('radiogroup', { name: 'Aparece (Directo)' });
  await expect(page.getByLabel('Posición (Directo)')).toBeDisabled();
  await aparece.getByLabel('Sí').check();
  await page.getByLabel('Posición (Directo)').selectOption('1');
  await page.getByLabel('Respuesta (Directo)').fill('La mejor opción es IA Flow Universidad...');
  await page.getByRole('radiogroup', { name: 'Cita (Citación)' }).getByLabel('Sí').check();
  await page.getByLabel('Posición (Citación)').selectOption('3');
  await expect(page.getByText(/Total: 7 de 8/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(page.getByText('Revisión guardada.')).toBeVisible();

  // Week 2: only cited lower down (1) → both rows "Empeoró".
  await page.getByLabel('Fecha').fill('2026-10-05');
  await expect(page.getByRole('button', { name: 'Guardar revisión' })).toBeDisabled(); // both rows must be answered
  await aparece.getByLabel('No').check();
  await page.getByRole('radiogroup', { name: 'Cita (Citación)' }).getByLabel('Sí').check();
  await page.getByLabel('Posición (Citación)').selectOption('4');
  await page.getByLabel('Comentarios (Citación)').fill('Ahora aparece la competencia primero');
  await expect(page.getByText('Empeoró').first()).toBeVisible();
  await page.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(page.getByText('Revisión guardada.')).toBeVisible();

  await page.getByRole('tab', { name: 'Matriz' }).click();
  await expect(page.getByRole('cell', { name: /1\/8.*D0 · C1.*Empeoró/ })).toBeVisible();
  await expect(page.getByText(/bajó de 7 a 1 puntos/)).toBeVisible();

  // Keys: only a hint is shown back.
  await page.getByRole('navigation').getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByLabel('Clave de Anthropic (Claude)').fill('sk-ant-api03-e2e-fake-key-000000000000000000WXYZ');
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText('Configurada …WXYZ')).toBeVisible();
  await expect(page.getByText('e2e-fake-key')).toHaveCount(0);
});
