import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('wrong password is rejected, the right one signs in, logout returns to the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page.getByLabel('Usuario', { exact: true }).fill('e2e');
  await page.getByLabel('Contraseña', { exact: true }).fill('not-the-password-1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Usuario o contraseña incorrectos')).toBeVisible();

  await login(page);
  await expect(page.getByText('E2E Owner')).toBeVisible();
  const cookie = (await page.context().cookies()).find(c => c.name === 'glitch_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  expect((await page.request.get('http://localhost:4000/api/v1/sites')).status()).toBe(401);
});
