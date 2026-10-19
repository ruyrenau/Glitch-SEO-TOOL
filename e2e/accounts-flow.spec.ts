import crypto from 'crypto';
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Cuentas: the master account creates a ticket; the new account signs up with it, cannot see the administration and invites a collaborator', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = crypto.randomBytes(3).toString('hex');
  const pw = 'Clave-e2e-2026';

  // The master account (instance administrator) generates a ticket.
  await login(page);
  await page.getByRole('button', { name: 'Administración', exact: true }).click();
  await expect(page.getByLabel('Registro con tickets activado')).toBeChecked();
  await page.getByLabel('Para quién es el ticket').fill(`Cliente ${tag}`);
  await page.getByLabel('Máximo de sitios del ticket').fill('2');
  await page.getByRole('button', { name: 'Generar ticket' }).click();
  const code = (await page.getByLabel('Código del ticket').textContent())!.trim();
  expect(code).toMatch(/^GSEO-/);
  await page.getByRole('tab', { name: 'Usuarios' }).click();
  await expect(page.getByText('administrador').first()).toBeVisible();

  // Without a code there is no way to sign up.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('/');
  await p2.getByRole('button', { name: 'Crear cuenta' }).click();
  await p2.getByLabel('Código de registro').fill('GSEO-AAAA-BBBB-CCCC');
  await p2.getByLabel('Tu nombre').fill('Cliente');
  await p2.getByLabel('Tu correo').fill(`cliente-${tag}@x.mx`);
  await p2.getByLabel('Usuario nuevo').fill(`cliente-${tag}`);
  await p2.getByLabel(/^Contraseña \(10\+/).fill(pw);
  await p2.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(p2.getByText(/código de registro no es válido/)).toBeVisible();

  // With the ticket link the code is already filled in.
  await p2.goto(`/signup/${code}`);
  await expect(p2.getByLabel('Código de registro')).toHaveValue(code);
  await p2.getByLabel('Tu nombre').fill('Cliente');
  await p2.getByLabel('Tu correo').fill(`cliente-${tag}@x.mx`);
  await p2.getByLabel('Usuario nuevo').fill(`cliente-${tag}`);
  await p2.getByLabel(/^Contraseña \(10\+/).fill(pw);
  await p2.getByLabel('Nombre del espacio').fill(`Agencia ${tag}`);
  await p2.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(p2.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  // Low level: its own empty workspace, no administration, no workspace switcher.
  await expect(p2.getByLabel('Sitio activo')).toContainText('Sin sitios');
  await expect(p2.getByRole('button', { name: 'Administración', exact: true })).toHaveCount(0);
  await expect(p2.locator('#workspace-select')).toHaveCount(0);

  // It invites its own collaborator (no email server in E2E: the link is shown).
  await p2.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await expect(p2.getByText(/2 permitidos/)).toBeVisible();
  await p2.getByLabel('Correo del colaborador').fill(`colab-${tag}@x.mx`);
  await p2.getByRole('button', { name: 'Invitar' }).click();
  const link = (await p2.locator('code').filter({ hasText: '/invite/' }).textContent())!.trim();
  const ctx2 = await browser.newContext();
  const colab = await ctx2.newPage();
  await colab.goto(new URL(link).pathname);
  await colab.getByLabel('Tu nombre').fill('Colaborador');
  await colab.getByLabel('Elige un usuario').fill(`colab-${tag}`);
  await colab.getByLabel(/^Contraseña \(10\+/).fill(pw);
  await colab.getByRole('button', { name: 'Crear cuenta y aceptar' }).click();
  await expect(colab.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(colab.getByRole('button', { name: 'Administración', exact: true })).toHaveCount(0);
  await ctx2.close();
  await ctx.close();

  // The ticket is spent.
  await page.getByRole('tab', { name: 'Registro y tickets' }).click();
  await expect(page.getByRole('row').filter({ hasText: `Cliente ${tag}` })).toContainText('Usado');
});
