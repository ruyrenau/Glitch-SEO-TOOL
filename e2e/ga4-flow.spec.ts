import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Google Analytics: the section explains what is needed before connecting', async ({ page }) => {
  await login(page);
  const { id } = await (await page.request.post('http://localhost:4000/api/v1/sites', { data: { name: 'GA4 Flow', domain: 'ga4.example.com', canonicalUrl: 'https://ga4.example.com' } })).json();
  await page.goto('/');
  await page.getByLabel('Sitio activo').selectOption(id);
  await page.getByRole('button', { name: 'Google Analytics', exact: true }).click();
  await expect(page.getByText(/qué pasa después: si la gente se queda, convierte o se va/)).toBeVisible();
  // Depending on the machine's .env the OAuth client may or may not be configured; either way the next step is shown.
  await expect(page.getByText(/Falta configurar GSC_CLIENT_ID y GSC_CLIENT_SECRET/).or(page.getByRole('link', { name: /Conectar con Google|Volver a conectar con Google/ }))).toBeVisible();
  const link = page.getByRole('link', { name: /Conectar con Google|Volver a conectar con Google/ });
  if (await link.count()) await expect(link).toHaveAttribute('href', /\/api\/v1\/gsc\/oauth\/start\?back=ga4$/);
});
