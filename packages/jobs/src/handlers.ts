import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma, importLogFile, runCrawl, deleteLogImport, purgeExpiredSessions } from '@glitch/db';

export interface JobContext {
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
  const summary = { logImportsDeleted: oldImports.length, sessionsPurged: sessions, jobsDeleted: jobs, tempFilesDeleted: files, logRetentionDays: logDays };
  ctx.log(JSON.stringify(summary));
  return summary;
}

export const HANDLERS = {
  'log-import': logImportHandler,
  crawl: crawlHandler,
  retention: retentionHandler
} as const;
