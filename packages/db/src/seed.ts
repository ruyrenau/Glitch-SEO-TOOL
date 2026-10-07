import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { writeSyntheticLog, syntheticSitemapPaths } from '@glitch/log-parser';
import { prisma } from './client';
import { createSite } from './site-service';
import { importLogFile, replaceSitemapUrls } from './log-service';
import { runCrawl } from './crawl-service';
import { importDataset, createTemplate, generateFromTemplate } from './content-service';
import { startFixtureSite } from '@glitch/testing';
import { parseSitemapXml } from '@glitch/crawler';

/**
 * `pnpm db:seed`   -> workspace + admin user (forced password change).
 * `pnpm demo:seed` -> also two [DEMO] sites with a synthetic log imported through
 *                     the real streaming pipeline and a synthetic sitemap.
 */
async function main() {
  const demo = process.argv.includes('--demo');
  const ws = await prisma.workspace.upsert({
    where: { slug: 'default' },
    update: {},
    create: { name: demo ? '[DEMO] Glitch Workspace' : 'Default Workspace', slug: 'default' }
  });

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@glitch.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const password = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(9).toString('base64url');
    const user = await prisma.user.create({
      data: { email, name: 'Admin', passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true }
    });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } });
    console.log(`Admin created: ${email} / ${password}  (must be changed on first login)`);
  }

  if (!demo) return;

  await seedFixtureCrawl(ws.id);

  const existingStore = await prisma.site.findFirst({ where: { name: '[DEMO] Example Store' } });
  if (existingStore) await seedContent(existingStore.id);

  const demoSites = await prisma.site.findMany({ where: { name: { in: ['[DEMO] Example Store', '[DEMO] Example Staging'] } } });
  if (demoSites.length) {
    console.log('Log demo sites already exist; skipping synthetic log import.');
    return;
  }

  const store = await createSite({ workspaceId: ws.id, name: '[DEMO] Example Store', domain: 'demo.example.com', canonicalUrl: 'https://demo.example.com' });
  await createSite({ workspaceId: ws.id, name: '[DEMO] Example Staging', domain: 'staging.example.com', canonicalUrl: 'https://staging.example.com', environment: 'staging' });

  const tmp = path.join(os.tmpdir(), `glitch-demo-${Date.now()}.log`);
  await writeSyntheticLog(tmp, 60_000, { seed: 7, days: 14 });
  const res = await importLogFile({ siteId: store.id, filePath: tmp, fileName: 'demo-access.log (synthetic)' });
  fs.unlinkSync(tmp);

  const paths = syntheticSitemapPaths();
  await replaceSitemapUrls(store.id, 'demo-sitemap.xml (synthetic)', paths.map(p => ({ url: `https://demo.example.com${p}`, path: p, lastmod: null })));
  console.log(`Demo logs seeded: ${res.analysis.validLines} log lines, ${res.analysis.aggregateRows} aggregate rows, ${paths.length} sitemap URLs.`);
  await seedContent(store.id);
}

/** Demo dataset, template and generated pages (nothing is sent to WordPress). */
async function seedContent(siteId: string) {
  if (await prisma.dataset.count({ where: { siteId } })) return;
  const csvPath = path.resolve(__dirname, '../../../fixtures/servicios_ciudades.csv');
  if (!fs.existsSync(csvPath)) return;
  const ds = await importDataset(siteId, { name: '[DEMO] Servicios por ciudad', filename: 'servicios_ciudades.csv', csv: fs.readFileSync(csvPath, 'utf8') });
  const tpl = await createTemplate(ds.id, {
    name: 'Servicio por ciudad',
    titleTemplate: '{{servicio}} en {{ciudad}}: auditoría y mejora continua',
    descTemplate: '{{servicio}} en {{ciudad}} desde {{precio}} MXN, con evidencia por URL y un plan priorizado.',
    slugTemplate: '{{servicio}}-{{ciudad}}',
    bodyTemplate: [
      '<h1>{{servicio}} en {{ciudad}}</h1>',
      '<p>{{descripcion}}</p>',
      '<h2>Contexto local</h2><p>{{dato_local}}</p>',
      '<h2>Cómo trabajamos</h2>',
      '<p>Empezamos con una revisión de logs del servidor y un rastreo controlado del sitio. Después priorizamos los problemas por impacto y esfuerzo, y acordamos con tu equipo qué corregir primero.</p>',
      '<p>Cada recomendación incluye evidencia por URL y un criterio para verificar que quedó resuelta.</p>',
      '<h2>Qué recibes</h2><ul><li>Un reporte priorizado con las URLs afectadas y la causa de cada problema.</li><li>Una sesión de revisión con tu equipo de desarrollo o tu agencia.</li><li>Un segundo rastreo para confirmar que los cambios funcionaron.</li></ul>',
      '<p>Precio de referencia: {{precio}} MXN.</p>'
    ].join('\n')
  });
  const r = await generateFromTemplate(tpl.id);
  console.log(`Demo content: ${r.created} pages generated (${Object.entries(r.byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
}

/**
 * Crawls the local fixture website (intentional SEO problems) on 127.0.0.1:4500.
 * Re-crawl later with `pnpm demo:site` running and CRAWL_ALLOW_PRIVATE_HOSTS=127.0.0.1.
 */
async function seedFixtureCrawl(workspaceId: string) {
  const name = '[DEMO] Fixture site (local)';
  if (await prisma.site.findFirst({ where: { name } })) return;
  const port = Number(process.env.DEMO_SITE_PORT ?? 4500);
  let fixture;
  try {
    fixture = await startFixtureSite(port);
  } catch {
    console.warn(`Port ${port} busy; skipping the demo crawl (stop "pnpm demo:site" and re-run).`);
    return;
  }
  try {
    const site = await createSite({ workspaceId, name, domain: '127.0.0.1', canonicalUrl: fixture.origin, environment: 'production' });
    const urls = parseSitemapXml(fixture.sitemapXml).urls;
    await replaceSitemapUrls(site.id, `${fixture.origin}/sitemap.xml`, urls);
    const opts = { siteId: site.id, allowHosts: ['127.0.0.1'], rps: 50, concurrency: 4, maxDepth: 10 };
    const run = await runCrawl(opts);
    // Second crawl against "version 2" of the fixture (a simulated bad deploy) so the demo has a diff and alerts.
    fixture.setVersion(2);
    const run2 = await runCrawl(opts);
    const alerts = await prisma.alert.count({ where: { crawlRunId: run2.id } });
    console.log(`Demo crawls: ${run.urlsCrawled} pages, then a simulated bad deploy with ${alerts} alerts.`);
  } finally {
    await fixture.close();
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
