import { test, expect } from '@playwright/test';

/**
 * The G.SEO box inside the real WordPress block editor (Playground on :9400, see docs/wordpress/testing).
 * Skipped when that WordPress is not running.
 */
const WP = 'http://127.0.0.1:9400';

test('Editor de WordPress: análisis SEO y de legibilidad en vivo, vistas previas y guardado', async ({ page, request }) => {
  test.setTimeout(180_000);
  const up = await request.get(`${WP}/wp-json/`).then(r => r.ok(), () => false);
  test.skip(!up, 'WordPress Playground no está corriendo en :9400');

  await page.goto(`${WP}/wp-login.php`);
  await page.getByLabel('Username or Email Address').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL(/wp-admin/);

  await page.goto(`${WP}/wp-admin/post-new.php`);
  // Close the block editor welcome guide, and open the "Meta Boxes" pane where plugin boxes live (WordPress 6.8+).
  await page.waitForFunction(() => !!(window as unknown as { wp?: { data?: unknown } }).wp?.data, null, { timeout: 60_000 });
  const close = page.getByRole('dialog').getByRole('button', { name: /close/i });
  if (await close.isVisible({ timeout: 8000 }).catch(() => false)) await close.click();
  const box = page.locator('#gseo-app');
  // Desktop: drag the "Meta Boxes" handle up (that is how the pane opens; smaller screens use a toggle button).
  if (!(await box.isVisible())) {
    const handle = page.getByRole('separator', { name: 'Drag to resize' });
    const hb = await handle.boundingBox();
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, 140, { steps: 12 });
      await page.mouse.up();
    }
    if (!(await box.isVisible())) await page.locator('.edit-post-meta-boxes-main__presenter button[aria-expanded]').click({ force: true });
  }
  await expect(box).toBeVisible({ timeout: 60_000 });

  // Write in the editor (through the block editor's own data store, like typing).
  const body = [
    '<!-- wp:paragraph --><p>El diseño de logotipos en Puebla ayuda a que tu negocio se vea profesional. Además, una buena marca genera confianza.</p><!-- /wp:paragraph -->',
    '<!-- wp:heading --><h2>¿Cuánto cuesta el diseño de logotipos en Puebla?</h2><!-- /wp:heading -->',
    `<!-- wp:paragraph --><p>${'Por ejemplo, un logotipo simple cuesta menos que una identidad completa. Sin embargo, la inversión se recupera rápido. '.repeat(14)}Mira nuestros <a href="/servicios/">servicios</a> o la <a href="https://es.wikipedia.org/wiki/Logotipo">definición de logotipo</a>.</p><!-- /wp:paragraph -->`
  ].join('\n');
  await page.evaluate(([title, content]) => {
    const w = window as unknown as { wp: { data: { dispatch: (s: string) => { editPost: (e: object) => void } } } };
    w.wp.data.dispatch('core/editor').editPost({ title, content, slug: 'diseno-de-logotipos-puebla' });
  }, ['Diseño de logotipos en Puebla', body]);

  await page.locator('#gseo_focus_kw').fill('diseño de logotipos en Puebla');
  await page.locator('#gseo_description').fill('Diseño de logotipos en Puebla: creamos la identidad de tu negocio con un proceso claro, precios justos y entregas en dos semanas.');

  // Live analysis.
  const seo = page.locator('#gseo-seo-results');
  await expect(seo).toContainText('Keyword en la introducción: Aparece en el primer párrafo', { timeout: 15_000 });
  await expect(seo).toContainText('Keyword en subtítulos');
  await expect(seo).toContainText('Enlaces internos: 1 enlace');
  await expect(seo).toContainText('Enlaces externos: 1 enlace');
  await expect(seo).toContainText('Keyword en la URL: La URL contiene la keyword');
  await expect(seo).toContainText('Bien hecho');
  await expect(page.locator('#gseo-dot-seo')).toHaveClass(/good|ok/);

  // Google preview with the keyword in bold.
  await expect(page.locator('#gseo-serp .t')).toHaveText('Diseño de logotipos en Puebla | Glitch Creativo');
  await expect(page.locator('#gseo-serp .d b').first()).toBeVisible();
  await page.getByLabel('Escritorio').check();
  await expect(page.locator('#gseo-serp')).not.toHaveClass(/mobile/);

  if (process.env.GSEO_SHOT) await box.screenshot({ path: process.env.GSEO_SHOT + '/seo.png' });
  // Readability tab.
  await page.getByRole('tab', { name: 'Legibilidad' }).click();
  await expect(page.locator('#gseo-read-results')).toContainText('Fernández-Huerta');
  await expect(page.locator('#gseo-read-results')).toContainText('Palabras de transición');
  await expect(page.locator('#gseo-stats')).toContainText('palabras');

  if (process.env.GSEO_SHOT) await box.screenshot({ path: process.env.GSEO_SHOT + '/read.png' });
  // Social tab falls back to the SEO title.
  await page.getByRole('tab', { name: 'Social' }).click();
  await expect(page.locator('#gseo-fb .st')).toHaveText('Diseño de logotipos en Puebla | Glitch Creativo');
  await page.locator('#gseo_og_title').fill('Logotipos que se recuerdan');
  await expect(page.locator('#gseo-fb .st')).toHaveText('Logotipos que se recuerdan');
  await expect(page.locator('#gseo-x .st')).toHaveText('Logotipos que se recuerdan');

  if (process.env.GSEO_SHOT) await box.screenshot({ path: process.env.GSEO_SHOT + '/social.png' });
  // Save as draft: the box is saved with the post.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('button', { name: 'Saved' }).or(page.getByText('Draft saved')).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000); // meta boxes are saved right after the post
  const id = await page.evaluate(() => (window as unknown as { wp: { data: { select: (s: string) => { getCurrentPostId: () => number } } } }).wp.data.select('core/editor').getCurrentPostId());
  await page.goto(`${WP}/wp-admin/post.php?post=${id}&action=edit`);
  await expect(page.locator('#gseo_focus_kw')).toHaveValue('diseño de logotipos en Puebla', { timeout: 60_000 });
  await expect(page.locator('#gseo_og_title')).toHaveValue('Logotipos que se recuerdan');

  // SEO column in the posts list.
  await page.goto(`${WP}/wp-admin/edit.php?post_status=draft`);
  const row = page.locator(`#post-${id}`);
  await expect(row.locator('.column-gseo')).toContainText('diseño de logotipos en Puebla');
  await expect(row.locator('.column-gseo .gseo-dot').first()).toHaveClass(/good|ok|bad/);
});
