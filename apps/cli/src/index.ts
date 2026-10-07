#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { validateJsonLd } from '@glitch/schema-engine';
import { analyzeLogFile } from '@glitch/log-parser';
import { fetchSitemap, parseSitemapXml } from '@glitch/crawler';
import { prisma, createSite, listSites, importLogFile, replaceSitemapUrls, getLogReport, DuplicateImportError, runCrawl, listIssues, listAlerts, listGeneratedPages, dryRunPage, pushPageAsDraft, WorkflowError, saveConnection, testConnection, importDataset, generateFromTemplate, listTemplates, createUser, resetPassword, prisma as db } from '@glitch/db';

const program = new Command();
program.name('seo-ops').description('Glitch SEO Ops Engine CLI').version('0.2.0');

const fail = (msg: string, code = 1): never => {
  console.error(`Error: ${msg}`);
  process.exit(code);
};
const requireFile = (p: string) => {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) fail(`File not found: ${p}`);
  return path.resolve(p);
};
const n = (v: number) => v.toLocaleString('en-US');

program
  .command('users:create')
  .description('Create a user. Reads the password from GLITCH_USER_PASSWORD so it stays out of shell history')
  .requiredOption('--username <u>', 'Login name')
  .requiredOption('--name <name>', 'Display name')
  .option('--role <role>', 'OWNER | ADMIN | SEO_MANAGER | EDITOR | VIEWER', 'VIEWER')
  .option('--temporary', 'Force a password change at first login')
  .action(async (o: { username: string; name: string; role: string; temporary?: boolean }) => {
    const password = process.env.GLITCH_USER_PASSWORD;
    if (!password) fail('Set GLITCH_USER_PASSWORD.');
    if (!['OWNER', 'ADMIN', 'SEO_MANAGER', 'EDITOR', 'VIEWER'].includes(o.role)) fail(`Invalid role: ${o.role}`);
    try {
      const u = await createUser({ username: o.username, name: o.name, password: password!, role: o.role as 'VIEWER', mustChangePassword: !!o.temporary });
      console.log(`User "${u.username}" created as ${u.roleLabel}.`);
    } catch (e) {
      if (e instanceof WorkflowError) fail(`${e.code}: ${e.message}`);
      throw e;
    }
  });

program
  .command('users:reset-password')
  .description('Set a new password for a user (reads GLITCH_USER_PASSWORD) and end their sessions')
  .requiredOption('--username <u>', 'Login name')
  .option('--temporary', 'Force a password change at next login')
  .action(async (o: { username: string; temporary?: boolean }) => {
    const password = process.env.GLITCH_USER_PASSWORD;
    if (!password) fail('Set GLITCH_USER_PASSWORD.');
    const user = await db.user.findUnique({ where: { username: o.username.toLowerCase() } });
    if (!user) fail(`User "${o.username}" not found.`);
    try {
      await resetPassword(user!.id, password!, null, { mustChange: !!o.temporary });
      console.log(`Password updated for "${user!.username}". Existing sessions were closed.`);
    } catch (e) {
      if (e instanceof WorkflowError) fail(`${e.code}: ${e.message}`);
      throw e;
    }
  });

program
  .command('sites:list')
  .description('List registered sites')
  .action(async () => {
    const sites = await listSites();
    if (!sites.length) console.log('No sites. Create one with site:create or run pnpm demo:seed.');
    console.table(sites.map(s => ({ id: s.id, name: s.name, domain: s.domain, env: s.environment, logImports: s._count.logImports, sitemapUrls: s._count.sitemapUrls })));
  });

program
  .command('site:create')
  .description('Register a site')
  .requiredOption('--name <name>', 'Display name')
  .requiredOption('--url <url>', 'Canonical URL, e.g. https://www.example.com')
  .option('--env <env>', 'production | staging | development', 'production')
  .action(async (o: { name: string; url: string; env: string }) => {
    let url: URL;
    try {
      url = new URL(o.url);
    } catch {
      return fail(`Invalid URL: ${o.url}`);
    }
    if (!['production', 'staging', 'development'].includes(o.env)) fail(`Invalid --env: ${o.env}`);
    const site = await createSite({ name: o.name, domain: url.hostname, canonicalUrl: url.origin, environment: o.env as 'production' });
    console.log(`Site created: ${site.id} (${site.domain})`);
  });

program
  .command('logs:analyze')
  .description('Analyze a log file locally without saving anything')
  .argument('<file>', '.log, .txt or .gz file')
  .option('--json', 'Print the full summary as JSON')
  .action(async (file: string, o: { json?: boolean }) => {
    const t0 = Date.now();
    const r = await analyzeLogFile(requireFile(file), { onProgress: l => process.stderr.write(`\r${n(l)} lines…`) });
    process.stderr.write('\r');
    const { aggregates, ...summary } = r;
    if (o.json) return console.log(JSON.stringify({ ...summary, aggregateRows: aggregates.length }, null, 2));
    console.log(`Lines: ${n(r.totalLines)} (valid ${n(r.validLines)}, invalid ${n(r.invalidLines)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`Bots: ${n(r.botRequests)} · Googlebot ${n(r.googlebotRequests)} · AI bots ${n(r.aiBotRequests)}`);
    console.table(r.statusDistribution);
    console.table(r.botDistribution);
    if (r.errorSamples.length) console.log('Unparsed sample (IPs redacted):\n  ' + r.errorSamples.slice(0, 5).join('\n  '));
  });

program
  .command('logs:import')
  .description('Stream a log file into the database for a site')
  .argument('<file>', '.log, .txt or .gz file')
  .requiredOption('--site <id>', 'Site id (see sites:list)')
  .option('--replace', 'Replace an earlier import of the same file')
  .action(async (file: string, o: { site: string; replace?: boolean }) => {
    try {
      const res = await importLogFile({ siteId: o.site, filePath: requireFile(file), replaceExisting: o.replace, onProgress: l => process.stderr.write(`\r${n(l)} lines…`) });
      process.stderr.write('\r');
      console.log(`Imported ${n(res.analysis.validLines)} valid lines into import ${res.importId} (${n(res.analysis.aggregateRows)} aggregate rows).`);
    } catch (err) {
      if (err instanceof DuplicateImportError) fail(`${err.message} Use --replace to re-import.`, 2);
      throw err;
    }
  });

program
  .command('sitemap:import')
  .description('Load sitemap URLs for a site from a URL (SSRF-guarded) or a local XML file')
  .argument('<source>', 'https://…/sitemap.xml or ./sitemap.xml')
  .requiredOption('--site <id>', 'Site id')
  .action(async (source: string, o: { site: string }) => {
    let urls;
    if (/^https?:\/\//i.test(source)) {
      const res = await fetchSitemap(source);
      res.errors.forEach(e => console.warn(`warning: ${e}`));
      urls = res.urls;
    } else {
      const parsed = parseSitemapXml(fs.readFileSync(requireFile(source), 'utf8'));
      if (parsed.kind === 'sitemapindex') fail('This is a sitemap index; pass its URL instead so children are fetched.');
      urls = parsed.urls;
    }
    if (!urls.length) fail('No URLs found in sitemap.');
    console.log(`Stored ${n(await replaceSitemapUrls(o.site, source, urls))} sitemap URLs.`);
  });

program
  .command('logs:report')
  .description('Print the latest log report for a site')
  .requiredOption('--site <id>', 'Site id')
  .option('--json', 'Print the full report as JSON')
  .action(async (o: { site: string; json?: boolean }) => {
    const r = await getLogReport(o.site);
    if (!r) fail('No completed log import for this site.', 3);
    const report = r!;
    if (o.json) return console.log(JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
    console.log(`${report.import.fileName}: ${n(report.totals.requests)} requests, ${n(report.totals.botRequests)} from bots`);
    console.log(`Potential crawl waste: ${(report.crawlWaste.share * 100).toFixed(1)}% (estimate)`);
    if (report.sitemapCoverage) console.log(`Sitemap URLs without Googlebot visits: ${n(report.sitemapCoverage.neverCrawledCount)} of ${n(report.sitemapCoverage.sitemapUrls)}`);
    console.log('Top bot 4xx:');
    console.table(report.bot4xx.slice(0, 10));
  });

program
  .command('crawl:start')
  .description('Crawl a site (robots.txt respected) and update its issues')
  .requiredOption('--site <id>', 'Site id')
  .option('--max-urls <n>', 'Maximum URLs (<= 5000)', '500')
  .option('--max-depth <n>', 'Maximum click depth', '5')
  .option('--rps <n>', 'Requests per second (default: site setting)')
  .option('--concurrency <n>', 'Parallel requests (1-8)', '2')
  .option('--no-sitemap', 'Do not seed from stored sitemap URLs')
  .option('--allow-private <hosts>', 'Comma-separated hosts allowed to resolve to private IPs (local testing only)')
  .action(async (o: { site: string; maxUrls: string; maxDepth: string; rps?: string; concurrency: string; sitemap: boolean; allowPrivate?: string }) => {
    const ac = new AbortController();
    process.once('SIGINT', () => {
      console.error('\nCancelling… (pages fetched so far are saved)');
      ac.abort();
    });
    const run = await runCrawl({
      siteId: o.site,
      maxUrls: Number(o.maxUrls),
      maxDepth: Number(o.maxDepth),
      rps: o.rps ? Number(o.rps) : undefined,
      concurrency: Number(o.concurrency),
      seedFromSitemap: o.sitemap,
      allowHosts: o.allowPrivate?.split(',').map(s => s.trim()),
      signal: ac.signal,
      onProgress: p => process.stderr.write(`\r${n(p.crawled)} crawled, ${n(p.queued)} queued   `)
    });
    process.stderr.write('\n');
    console.log(`Crawl ${run.id} ${run.status}: ${n(run.urlsCrawled)} pages, ${n(run.issuesFound)} issue types.`);
  });

program
  .command('issues:list')
  .description('List open issues for a site, most severe first')
  .requiredOption('--site <id>', 'Site id')
  .option('--status <s>', 'open | in_progress | resolved | ignored', 'open')
  .action(async (o: { site: string; status: string }) => {
    const issues = await listIssues(o.site, o.status);
    if (!issues.length) return console.log('No issues with that status.');
    console.table(issues.map(i => ({ severity: i.severity, priority: i.priorityScore, code: i.code, urls: i.affectedUrlsCount, title: i.title })));
  });

program
  .command('alerts:list')
  .description('List alerts raised by changes between crawls')
  .requiredOption('--site <id>', 'Site id')
  .option('--all', 'Include acknowledged alerts')
  .action(async (o: { site: string; all?: boolean }) => {
    const alerts = await listAlerts(o.site, o.all ? undefined : 'open');
    if (!alerts.length) return console.log('No alerts.');
    console.table(alerts.map(a => ({ severity: a.severity, type: a.type, status: a.status, message: a.message, created: a.createdAt.toISOString() })));
  });

program
  .command('wordpress:connect')
  .description('Store (encrypted) and test WordPress credentials for a site. Reads the password from WP_APP_PASSWORD')
  .requiredOption('--site <id>', 'Site id')
  .requiredOption('--url <url>', 'WordPress site root (https)')
  .requiredOption('--user <name>', 'WordPress username')
  .action(async (o: { site: string; url: string; user: string }) => {
    const appPassword = process.env.WP_APP_PASSWORD;
    if (!appPassword) fail('Set WP_APP_PASSWORD (kept out of shell history and process lists).');
    await saveConnection(o.site, { endpointUrl: o.url, username: o.user, appPassword });
    const r = await testConnection(o.site);
    if (!r.ok) fail(`Saved, but the test failed: ${r.error}`);
    console.log(`Connected to "${r.ok ? r.siteName : ''}" as ${r.ok ? r.user : ''}.`);
  });

program
  .command('datasets:import')
  .description('Import a CSV dataset for programmatic pages')
  .argument('<file>', '.csv, .tsv or .txt file')
  .requiredOption('--site <id>', 'Site id')
  .option('--name <name>', 'Dataset name (default: file name)')
  .action(async (file: string, o: { site: string; name?: string }) => {
    const abs = requireFile(file);
    try {
      const ds = await importDataset(o.site, { name: o.name ?? path.basename(abs).replace(/\.\w+$/, ''), filename: path.basename(abs), csv: fs.readFileSync(abs, 'utf8') });
      console.log(`Dataset ${ds.id}: ${n(ds.rowCount)} rows, columns: ${ds.columns.map(c => `{{${c.variable}}}(${c.type})`).join(' ')}`);
      if (ds.issues.duplicateRows.length) console.log(`warning: duplicate rows ${ds.issues.duplicateRows.join(', ')}`);
      if (ds.issues.emptyCells) console.log(`warning: ${ds.issues.emptyCells} empty cells`);
    } catch (e) {
      if (e instanceof WorkflowError) fail(`${e.code}: ${e.message}`, e.code === 'DUPLICATE_DATASET' ? 2 : 1);
      throw e;
    }
  });

program
  .command('templates:list')
  .description('List content templates for a site')
  .requiredOption('--site <id>', 'Site id')
  .action(async (o: { site: string }) => {
    const t = await listTemplates(o.site);
    if (!t.length) return console.log('No templates. Create one in the dashboard or through the API.');
    console.table(t.map(x => ({ id: x.id, name: x.name, dataset: x.dataset.name, rows: x.dataset.rowCount, pages: x._count.generatedPages })));
  });

program
  .command('content:generate')
  .description('Generate pages from a template and its dataset (quality gates applied; nothing is sent anywhere)')
  .requiredOption('--template <id>', 'Template id')
  .option('--limit <n>', 'Maximum rows this run (<= 500)')
  .action(async (o: { template: string; limit?: string }) => {
    const r = await generateFromTemplate(o.template, { limit: o.limit ? Number(o.limit) : undefined });
    console.log(`Created ${n(r.created)} pages: ${Object.entries(r.byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}.`);
    r.skipped.forEach(sk => console.log(`skipped row ${sk.rowIndex === null ? '-' : sk.rowIndex + 1}: ${sk.reason} (/${sk.slug})`));
    if (r.remaining) console.log(`${n(r.remaining)} rows left; run again.`);
  });

program
  .command('pages:list')
  .description('List generated pages for a site with their review and WordPress status')
  .requiredOption('--site <id>', 'Site id')
  .action(async (o: { site: string }) => {
    const pages = await listGeneratedPages(o.site);
    if (!pages.length) return console.log('No generated pages.');
    console.table(pages.map(p => ({ id: p.id, status: p.status, slug: p.slug, wpPostId: p.publishedWpPostId ?? '', similarity: p.similarityScore })));
  });

program
  .command('wordpress:dry-run')
  .description('Show what would be sent to WordPress for a page (nothing is sent)')
  .requiredOption('--page <id>', 'Generated page id')
  .action(async (o: { page: string }) => {
    const r = await dryRunPage(o.page);
    console.log(`Action: ${r.action} (status: draft)`);
    r.warnings.forEach(w => console.log(`warning: ${w}`));
    if (r.diff.title) console.log(`Title: "${r.diff.title.before}" -> "${r.diff.title.after}"`);
    for (const l of r.diff.content) if (l.op !== 'same') console.log(`${l.op === 'add' ? '+' : '-'} ${l.text}`);
  });

program
  .command('wordpress:push')
  .description('Send an approved page to WordPress as a draft (never publishes)')
  .requiredOption('--page <id>', 'Generated page id')
  .option('--overwrite-remote-changes', 'Overwrite edits made in WordPress since the last send')
  .action(async (o: { page: string; overwriteRemoteChanges?: boolean }) => {
    try {
      const r = await pushPageAsDraft(o.page, { overwriteRemoteChanges: o.overwriteRemoteChanges });
      console.log(`Draft ${r.result}: post ${r.wpPostId}. Edit: ${r.editLink}`);
    } catch (e) {
      if (e instanceof WorkflowError) fail(`${e.code}: ${e.message}`, e.code === 'REMOTE_CHANGED' ? 4 : 1);
      throw e;
    }
  });

program
  .command('schema:validate')
  .description('Validate a JSON-LD file (exit code 1 when invalid)')
  .argument('<file>', 'Path to a JSON-LD file')
  .action((file: string) => {
    const result = validateJsonLd(fs.readFileSync(requireFile(file), 'utf8'));
    console.log(`Status: ${result.isValid ? 'VALID' : 'INVALID'} · type ${result.type}`);
    result.errors.forEach(e => console.log(`  ✕ ${e}`));
    result.warnings.forEach(w => console.log(`  ! ${w}`));
    if (!result.isValid) process.exitCode = 1;
  });

program
  .parseAsync(process.argv)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
