import crypto from 'crypto';
import { test, expect } from '@playwright/test';

test('Cuentas: sign up with an own workspace, invite a collaborator by link, accept it and switch workspaces', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = crypto.randomBytes(3).toString('hex');
  const pw = 'Clave-e2e-2026';

  // Sign up from the login screen.
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Tu nombre').fill('Dueña E2E');
  await page.getByLabel('Tu correo').fill(`duena-${tag}@agencia.mx`);
  await page.getByLabel('Usuario nuevo').fill(`duena-${tag}`);
  await page.getByLabel(/^Contraseña \(10\+/).fill(pw);
  await page.getByLabel('Nombre del espacio').fill(`Agencia ${tag}`);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page.locator('#workspace-select')).toContainText(`Agencia ${tag}`);
  await expect(page.getByLabel('Sitio activo')).toContainText('Sin sitios'); // empty workspace

  // Invite a collaborator (no email server in E2E: the link is shown to copy).
  await page.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await page.getByLabel('Correo del colaborador').fill(`colab-${tag}@agencia.mx`);
  await page.getByLabel('Rol del colaborador').selectOption('EDITOR');
  await page.getByRole('button', { name: 'Invitar' }).click();
  const link = (await page.locator('code').filter({ hasText: '/invite/' }).textContent())!.trim();
  await expect(page.getByText(`colab-${tag}@agencia.mx`).first()).toBeVisible();

  // The collaborator opens the link in another browser and creates an account.
  const ctx = await browser.newContext();
  const colab = await ctx.newPage();
  await colab.goto(new URL(link).pathname);
  await expect(colab.getByText(`Te invitaron a Agencia ${tag}`)).toBeVisible();
  await colab.getByLabel('Tu nombre').fill('Colaborador');
  await colab.getByLabel('Elige un usuario').fill(`colab-${tag}`);
  await colab.getByLabel(/^Contraseña \(10\+/).fill(pw);
  await colab.getByRole('button', { name: 'Crear cuenta y aceptar' }).click();
  await expect(colab.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(colab.locator('#workspace-select')).toContainText(`Agencia ${tag} · Editor`);
  await ctx.close();

  // The owner creates a second workspace and switches back.
  page.once('dialog', d => d.accept(`Cliente ${tag}`));
  await page.locator('#workspace-select').selectOption('__new');
  await expect(page.locator('#workspace-select')).toHaveValue(/.+/);
  await expect(page.locator('#workspace-select option:checked')).toHaveText(`Cliente ${tag} · Owner`);
  await page.locator('#workspace-select').selectOption({ label: `Agencia ${tag} · Owner` });
  await expect(page.locator('#workspace-select option:checked')).toHaveText(`Agencia ${tag} · Owner`);
  await page.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await expect(page.getByRole('cell', { name: `colab-${tag}` })).toBeVisible();
});
