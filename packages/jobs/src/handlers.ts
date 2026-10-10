import fs from 'fs';
import os from 'os';
import path from 'path';
import { Prisma, prisma, importLogFile, runCrawl, deleteLogImport, purgeExpiredSessions, purgeOldCrawlDetail, runGscImport, sitesForDailyGsc, getMonitorConfig, pickVitalsUrls } from '@glitch/db';
import { enqueue } from './producer';
import { measure, PerformanceError } from '@glitch/performance';

export interface JobContext {
  jobId: string;
  signal: AbortSignal;
  /** pct 0-100 when known; detail is shown in the dashboard. Throttled by the runner. */
  progress: (pct: number | null, detail?: Record<string, unknown>) => void;
  log: (msg: string, level?: 'info' | 'warn') => void;
}

export const uploadDir = () => process.env.UPLOAD_DIR ?? path.join(os.tmpdir(), 'glitch-uploads');

export async function logImportHandler(p: { siteId: string; filePath: string; fileName: string; replaceExisting?: boolean; fileSize?: number }, ctx: JobContext) {
  if (!fs.existsSync(p.filePath)) throw Object.assign(new Error('The uploaded file is no longer available'), { unrecoverable: true });
  ctx.log(`Procesando ${p.fileName}`);
  try {
    const r = await importLogFile({
      siteId: p.siteId,
      filePath: p.filePath,
      fileName: p.fileName,
      replaceExisting: p.replaceExisting,
      signal: ctx.signal,
      onProgress: lines => ctx.progress(null, { lines })
    });
    ctx.log(`${r.analysis.validLines} líneas válidas, ${r.analysis.invalidLines} inválidas`);
    await fs.promises.rm(p.filePath, { force: true });
    return { importId: r.importId, validLines: r.analysis.validLines, invalidLines: r.analysis.invalidLines, aggregateRows: r.analysis.aggregateRows };
  } catch (e) {
    // Errors that will not change on retry: drop the temp file and stop.
    if ((e as Error).name === 'DuplicateImportError' || /cancelled|not found/i.test((e as Error).message)) {
      await fs.promises.rm(p.filePath, { force: true });
      throw Object.assign(e as Error, { unrecoverable: true });
    }
    throw e;
  }
}

export async function crawlHandler(p: { siteId: string; options?: Record<string, unknown> }, ctx: JobContext) {
  const o = p.options ?? {};
  let runId = '';
  const allowHosts = (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const maxUrls = typeof o.maxUrls === 'number' ? o.maxUrls : 500;
  const run = await runCrawl({
    siteId: p.siteId,
    ...(o as object),
    allowHosts,
    signal: ctx.signal,
    onStarted: id => {
      runId = id;
      ctx.log(`Crawl ${id} iniciado`);
      ctx.progress(0, { crawlRunId: id, crawled: 0, queued: 0 });
    },
    onProgress: pr => ctx.progress(Math.min(99, Math.round((pr.crawled / maxUrls) * 100)), { crawlRunId: runId, ...pr })
  });
  ctx.log(`${run.urlsCrawled} páginas, ${run.issuesFound} tipos de issue (${run.status})`);
  return { crawlRunId: run.id, status: run.status, pages: run.urlsCrawled, issues: run.issuesFound };
}

/** Deletes data past its retention period. Every deletion of user data is audited. */
export async function retentionHandler(_p: Record<string, unknown>, ctx: JobContext) {
  const logDays = Number(process.env.LOG_RETENTION_DAYS ?? 90);
  const jobDays = Number(process.env.JOB_RETENTION_DAYS ?? 90);
  const cutoff = (days: number) => new Date(Date.now() - days * 86400_000);

  const oldImports = await prisma.logImport.findMany({ where: { createdAt: { lt: cutoff(logDays) } }, select: { id: true } });
  for (const imp of oldImports) {
    if (ctx.signal.aborted) break;
    await deleteLogImport(imp.id);
  }
  const sessions = await purgeExpiredSessions();
  const crawlDetail = await purgeOldCrawlDetail();
  // SQLite keeps freed pages until VACUUM; reclaim them after a large purge (the file can shrink a lot).
  let vacuumed = false;
  if (crawlDetail.linksRemoved + crawlDetail.htmlRemoved > 10_000 && (process.env.DATABASE_URL ?? 'file:').startsWith('file:')) {
    await prisma.$executeRawUnsafe('VACUUM');
    vacuumed = true;
  }
  const jobs = (await prisma.job.deleteMany({ where: { createdAt: { lt: cutoff(jobDays) }, status: { in: ['COMPLETED', 'CANCELLED'] } } })).count;

  // Upload temp files older than a day belong to jobs that will never run again.
  let files = 0;
  const dir = uploadDir();
  if (fs.existsSync(dir)) {
    for (const f of await fs.promises.readdir(dir)) {
      const full = path.join(dir, f);
      const st = await fs.promises.stat(full).catch(() => null);
      if (st?.isFile() && Date.now() - st.mtimeMs > 86400_000) {
        await fs.promises.rm(full, { force: true });
        files++;
      }
    }
  }
  const summary = { crawlDetail, vacuumed, logImportsDeleted: oldImports.length, sessionsPurged: sessions, jobsDeleted: jobs, tempFilesDeleted: files, logRetentionDays: logDays };
  ctx.log(JSON.stringify(summary));
  return summary;
}

/** Measures each URL × strategy. One URL failing is recorded, not fatal; quota errors stop the run. */
export async function performanceHandler(p: { siteId: string; urls: string[]; strategies: Array<'mobile' | 'desktop'> }, ctx: JobContext) {
  const allowHosts = (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const work = p.urls.flatMap(url => p.strategies.map(strategy => ({ url, strategy })));
  let ok = 0;
  let failed = 0;
  for (const [i, w] of work.entries()) {
    if (ctx.signal.aborted) break;
    ctx.progress(Math.round((i / work.length) * 100), { current: `${w.strategy} ${w.url}`, done: i, total: work.length });
    try {
      const r = await measure(w.url, { strategy: w.strategy, allowHosts, signal: ctx.signal });
      await prisma.performanceRun.create({
        data: {
          siteId: p.siteId,
          jobId: ctx.jobId,
          url: w.url,
          finalUrl: r.finalUrl,
          strategy: w.strategy,
          source: r.source,
          status: 'ok',
          performanceScore: r.lab.performanceScore,
          labLcp: r.lab.LCP,
          labCls: r.lab.CLS,
          labTbt: r.lab.TBT,
          lab: r.lab as unknown as Prisma.InputJsonValue,
          fieldStatus: r.fieldStatus,
          fieldScope: r.field?.scope ?? null,
          fieldLcp: r.field?.metrics.LCP?.p75 ?? null,
          fieldInp: r.field?.metrics.INP?.p75 ?? null,
          fieldCls: r.field?.metrics.CLS?.p75 ?? null,
          field: r.field ? (r.field as unknown as Prisma.InputJsonValue) : undefined,
          diagnostics: r.diagnostics as unknown as Prisma.InputJsonValue,
          resources: r.resources as unknown as Prisma.InputJsonValue,
          report: r.report as unknown as Prisma.InputJsonValue,
          lighthouseVersion: r.lighthouseVersion
        }
      });
      // Screenshots and waterfalls are heavy (~100–600 KB): keep them for the latest runs only.
      const older = await prisma.performanceRun.findMany({ where: { siteId: p.siteId, url: w.url, strategy: w.strategy, report: { not: Prisma.DbNull } }, orderBy: { createdAt: 'desc' }, skip: 5, select: { id: true } });
      if (older.length) await prisma.performanceRun.updateMany({ where: { id: { in: older.map(o => o.id) } }, data: { report: Prisma.DbNull } });
      ok++;
      ctx.log(`${w.strategy} ${w.url}: score ${r.lab.performanceScore ?? '—'} (${r.source})`);
    } catch (e) {
      if (ctx.signal.aborted) break;
      failed++;
      const msg = (e as Error).message.slice(0, 500);
      await prisma.performanceRun.create({ data: { siteId: p.siteId, url: w.url, strategy: w.strategy, source: process.env.PSI_API_KEY ? 'psi' : 'lighthouse-local', status: 'failed', error: msg } });
      ctx.log(`${w.strategy} ${w.url}: ${msg}`, 'warn');
      if (e instanceof PerformanceError && (e.code === 'QUOTA' || e.code === 'BROWSER_NOT_FOUND')) {
        throw Object.assign(new Error(msg), { unrecoverable: true });
      }
    }
  }
  return { measured: ok, failed, total: work.length };
}

/** Imports Search Analytics for one site. */
export async function gscImportHandler(p: { siteId: string; days?: number }, ctx: JobContext) {
  const imp = await runGscImport(p.siteId, { days: p.days, log: m => ctx.log(m), signal: ctx.signal });
  return { gscImportId: imp.id, pages: imp.pageRows, queries: imp.queryRows, startDate: imp.startDate, endDate: imp.endDate };
}

/** Daily refresh: queues an import for every site with a Search Console property. */
export async function gscDailyHandler(_p: Record<string, unknown>, ctx: JobContext) {
  const sites = await sitesForDailyGsc();
  for (const s of sites) await enqueue('gsc-import', { siteId: s.id, days: 90 }, { siteId: s.id, workspaceId: s.workspaceId, trigger: 'schedule' });
  ctx.log(`${sites.length} sitios en cola`);
  return { queued: sites.length };
}

/** Scheduled Core Web Vitals ("Monitoreo"): measures the site's top pages. */
export async function monitorVitalsHandler(p: { siteId: string }, ctx: JobContext) {
  const cfg = await getMonitorConfig(p.siteId);
  if (!cfg.vitalsEnabled) return { skipped: 'disabled' };
  const urls = await pickVitalsUrls(p.siteId);
  ctx.log(`${urls.length} URLs: ${urls.join(', ')}`);
  return performanceHandler({ siteId: p.siteId, urls, strategies: cfg.vitalsStrategies }, ctx);
}

export const HANDLERS = {
  'log-import': logImportHandler,
  crawl: crawlHandler,
  retention: retentionHandler,
  performance: performanceHandler,
  'gsc-import': gscImportHandler,
  'gsc-daily': gscDailyHandler,
  'monitor-vitals': monitorVitalsHandler
} as const;
