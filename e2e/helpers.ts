import { expect, Page } from '@playwright/test';

/** Signs in through the login screen with the E2E user created in playwright.config.ts. */
export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill('e2e');
  await page.getByLabel('Contraseña', { exact: true }).fill('E2e-password-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}
