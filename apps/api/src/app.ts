import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z, ZodError } from 'zod';
import { config } from '@glitch/config';
import {
  prisma,
  listSites,
  createSite,
  setSiteArchived,
  getSiteOverview,
  listLogImports,
  deleteLogImport,
  getLogReport,
  getBotUrlRows,
  replaceSitemapUrls,
  listAuditEvents,
  listCrawlRuns,
  listCrawledPages,
  listIssues,
  setIssueStatus,
  getCrawlDiff,
  listAlerts,
  acknowledgeAlert,
  WorkflowError,
  getConnection,
  saveConnection,
  deleteConnection,
  testConnection,
  listRemoteCategories,
  createGeneratedPage,
  listGeneratedPages,
  reviewPage,
  dryRunPage,
  pushPageAsDraft,
  rollbackPublication,
  explorerSummary,
  explorerRows,
  explorerPageDetail,
  explorerCsv,
  explorerCustom,
  gscStatus,
  gscAuthUrl,
  gscFinishOAuth,
  gscDisconnect,
  gscProperties,
  setSiteGscProperty,
  gscReport,
  explorerStructure,
  lookupEditable,
  proposeChange,
  listProposals,
  reviewProposal,
  applyProposal,
  revertProposal,
  verifyProposal,
  importDataset,
  listDatasets,
  deleteDataset,
  createTemplate,
  listTemplates,
  generateFromTemplate,
  bulkReview,
  bulkPush,
  archivePage,
  deleteRejectedPages,
  MAX_BATCH,
  DuplicateImportError
} from '@glitch/db';
import { HARD_MAX_URLS, MAX_RPS, fetchSitemap, findBrowser, parseSitemapXml } from '@glitch/crawler';
import { validateJsonLd } from '@glitch/schema-engine';
import { renderTemplate, computeJaccardSimilarity, evaluateQualityGate } from '@glitch/content-engine';
import { registerAuth } from './auth';
import { enqueue, cancelJob, retryJob, listJobs, queueHealth, setSiteSchedule, getSiteSchedule, closeProducer, uploadDir } from '@glitch/jobs';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

const MAX_UPLOAD_BYTES = Number(process.env.MAX_LOG_UPLOAD_BYTES ?? 2 * 1024 ** 3);
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(os.tmpdir(), 'glitch-uploads');
const ALLOWED_LOG_EXT = /\.(log|txt|gz)(\.\d+)?$/i;

const idParam = z.object({ id: z.string().uuid() });
const createSiteBody = z
  .object({
    name: z.string().min(1).max(120),
    domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i, 'Invalid domain'),
    canonicalUrl: z.string().url(),
    environment: z.enum(['production', 'staging', 'development']).optional(),
    sitemapUrl: z.string().url().optional(),
    language: z.string().max(10).optional(),
    targetCountry: z.string().max(2).optional(),
    timezone: z.string().max(64).optional()
  })
  .strict(); // rejects unknown fields (mass-assignment guard)

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  // Neutralize spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** JSON can't serialize BigInt; convert at the edge. */
const jsonSafe = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: config.LOG_LEVEL },
    genReqId: req => (typeof req.headers['x-correlation-id'] === 'string' ? req.headers['x-correlation-id'].slice(0, 64) : crypto.randomUUID()),
    bodyLimit: 5 * 1024 * 1024
  });

  await app.register(cors, { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map(s => s.trim()), credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: 'Glitch SEO Ops Engine API', version: '0.2.0' }, servers: [{ url: `http://localhost:${config.PORT}` }] }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Log uploads arrive as a raw stream; the handler enforces the size limit while writing.
  app.addContentTypeParser(['application/octet-stream', 'application/gzip', 'application/x-gzip'], (_req, payload, done) => done(null, payload));
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.addContentTypeParser(['application/xml', 'text/xml'], { parseAs: 'string', bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Unexpected error';
    let details: Record<string, unknown> = {};
    if (err instanceof ApiError) ({ status, code, message, details } = err);
    else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = { issues: err.issues };
    } else if (err instanceof WorkflowError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof DuplicateImportError) {
      status = 409;
      code = 'DUPLICATE_IMPORT';
      message = err.message;
      details = { existingImportId: err.existingImportId };
    } else if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      status = (err as { statusCode: number }).statusCode;
      code = (err as { code?: string }).code ?? 'BAD_REQUEST';
      message = (err as Error).message;
    } else req.log.error(err);
    reply.status(status).send({ error: { code, message, details, correlationId: req.id } });
  });

  const requireSite = async (id: string) => {
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) throw new ApiError(404, 'SITE_NOT_FOUND', `Site ${id} not found`);
    return site;
  };

  await registerAuth(app);

  // ------------------------------------------------------------------ health
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/health/live', async () => ({ status: 'live' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      return reply.status(503).send({ status: 'not_ready', db: 'error', message: (e as Error).message });
    }
    // The API can serve reads without Redis; queue state is reported, not required.
    const q = await queueHealth();
    return { status: 'ready', db: 'ok', queue: q.redis, worker: q.worker ? 'ok' : 'none', workerSeenAt: q.worker?.at ?? null };
  });
  app.addHook('onClose', async () => closeProducer());

  // ------------------------------------------------------------------ sites
  app.get('/api/v1/sites', async req => jsonSafe(await listSites(req.auth!.workspaceId)));

  app.post('/api/v1/sites', async (req, reply) => {
    const body = createSiteBody.parse(req.body);
    const site = await createSite({ ...body, workspaceId: req.auth!.workspaceId });
    return reply.status(201).send(jsonSafe(site));
  });

  app.post('/api/v1/sites/:id/archive', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return setSiteArchived(id, true);
  });
  app.post('/api/v1/sites/:id/restore', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return setSiteArchived(id, false);
  });

  app.get('/api/v1/sites/:id/overview', async req => {
    const { id } = idParam.parse(req.params);
    const ov = await getSiteOverview(id);
    if (!ov) throw new ApiError(404, 'SITE_NOT_FOUND', `Site ${id} not found`);
    return jsonSafe(ov);
  });

  // ------------------------------------------------------------------ log imports
  app.get('/api/v1/sites/:id/log-imports', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return jsonSafe(await listLogImports(id));
  });

  /**
   * Upload: raw body (application/octet-stream), original name in ?fileName=.
   * The file is streamed to the upload directory (size-capped, checksummed) and a
   * background job parses it. Responds 202 with the job id.
   */
  app.post('/api/v1/sites/:id/log-imports', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ fileName: z.string().min(1).max(200), replace: z.enum(['true', 'false']).optional() }).parse(req.query);
    const site = await requireSite(id);
    const baseName = path.basename(q.fileName);
    if (!ALLOWED_LOG_EXT.test(baseName)) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Only .log, .txt and .gz files are accepted');
    if (!(req.body instanceof Readable)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as application/octet-stream');

    const dir = uploadDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const stored = path.join(dir, `${crypto.randomUUID()}.upload`); // never trust the client name for paths
    let written = 0;
    const hash = crypto.createHash('sha256');
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        hash.update(chunk);
        if (written > MAX_UPLOAD_BYTES) cb(new ApiError(413, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`));
        else cb(null, chunk);
      }
    });
    try {
      await pipeline(req.body, limiter, fs.createWriteStream(stored));
      if (written === 0) throw new ApiError(400, 'EMPTY_FILE', 'Uploaded file is empty');
      // Same checksum the parser computes: reject duplicates now, not minutes later in the worker.
      const existing = await prisma.logImport.findUnique({ where: { siteId_checksum: { siteId: id, checksum: hash.digest('hex') } } });
      if (existing && q.replace !== 'true') throw new DuplicateImportError(existing.id);
      const job = await enqueue('log-import', { siteId: id, filePath: stored, fileName: baseName, replaceExisting: q.replace === 'true', fileSize: written }, { siteId: id, workspaceId: site.workspaceId });
      return reply.status(202).send({ jobId: job.id, status: job.status });
    } catch (e) {
      await fs.promises.rm(stored, { force: true });
      throw e;
    }
  });

  app.delete('/api/v1/log-imports/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { confirm } = z.object({ confirm: z.literal('true', { message: 'Pass ?confirm=true to permanently delete this import' }) }).parse(req.query);
    void confirm;
    const exists = await prisma.logImport.findUnique({ where: { id } });
    if (!exists) throw new ApiError(404, 'IMPORT_NOT_FOUND', `Import ${id} not found`);
    await deleteLogImport(id);
    return reply.status(204).send();
  });

  app.get('/api/v1/sites/:id/log-report', async req => {
    const { id } = idParam.parse(req.params);
    const { importId } = z.object({ importId: z.string().uuid().optional() }).parse(req.query);
    await requireSite(id);
    const report = await getLogReport(id, importId);
    if (!report) throw new ApiError(404, 'NO_LOG_DATA', 'No completed log import for this site yet');
    return jsonSafe(report);
  });

  app.get('/api/v1/sites/:id/log-report.csv', async (req, reply: FastifyReply) => {
    const { id } = idParam.parse(req.params);
    const { importId } = z.object({ importId: z.string().uuid().optional() }).parse(req.query);
    await requireSite(id);
    const rows = await getBotUrlRows(id, importId);
    const header = ['date', 'bot', 'category', 'status', 'path', 'hits', 'avgResponseMs'];
    const lines = [header.join(','), ...rows.map(r => header.map(h => csvEscape(r[h as keyof typeof r])).join(','))];
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="bot-urls-${id.slice(0, 8)}.csv"`)
      .send(lines.join('\n'));
  });

  // ------------------------------------------------------------------ sitemaps
  /** JSON {url} fetches the sitemap (SSRF-guarded); an XML body is parsed directly. */
  app.post('/api/v1/sites/:id/sitemap', async req => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    if (typeof req.body === 'string') {
      const parsed = parseSitemapXml(req.body);
      if (parsed.kind === 'sitemapindex') throw new ApiError(422, 'SITEMAP_INDEX_UPLOAD', 'Upload child sitemaps or provide the index URL instead', { children: parsed.childSitemaps.slice(0, 50) });
      const count = await replaceSitemapUrls(id, 'uploaded sitemap.xml', parsed.urls);
      return { urls: count, fetched: [], errors: [] };
    }
    const { url } = z.object({ url: z.string().url().optional() }).strict().parse(req.body ?? {});
    const target = url ?? site.sitemapUrl;
    if (!target) throw new ApiError(400, 'NO_SITEMAP_URL', 'Provide a sitemap URL');
    const allowHosts = (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const res = await fetchSitemap(target, { allowHosts, userAgent: site.userAgent });
    if (res.urls.length === 0) throw new ApiError(422, 'SITEMAP_EMPTY', 'No URLs could be read from the sitemap', { errors: res.errors });
    const count = await replaceSitemapUrls(id, target, res.urls);
    return { urls: count, fetched: res.fetched, errors: res.errors };
  });

  // ------------------------------------------------------------------ crawls (run by the worker)
  const crawlBody = z
    .object({
      maxUrls: z.number().int().min(1).max(HARD_MAX_URLS).default(500),
      maxDepth: z.number().int().min(0).max(20).default(5),
      concurrency: z.number().int().min(1).max(8).default(2),
      rps: z.number().min(0.1).max(MAX_RPS).optional(),
      respectRobots: z.boolean().default(true),
      include: z.array(z.string().max(200)).max(20).default([]),
      exclude: z.array(z.string().max(200)).max(50).default([]),
      seedFromSitemap: z.boolean().default(true),
      renderJs: z.boolean().default(false),
      // Screaming Frog-style limits
      listUrls: z.array(z.string().url().max(2000)).max(10_000).optional(),
      maxUrlLength: z.number().int().min(20).max(10_000).optional(),
      maxFolderDepth: z.number().int().min(0).max(50).optional(),
      maxUrlsPerFolder: z.number().int().min(1).max(100_000).optional(),
      maxQueryParams: z.number().int().min(0).max(50).optional(),
      maxLinksPerPage: z.number().int().min(1).max(10_000).optional(),
      maxRedirects: z.number().int().min(0).max(20).optional(),
      stayInStartFolder: z.boolean().optional(),
      maxPageSizeKb: z.number().int().min(16).max(51_200).optional()
    })
    .strict();
  const ACTIVE = ['QUEUED', 'RUNNING', 'RETRYING'] as const;
  /** API body → crawler options: page size in KB to bytes; list-mode URLs must belong to the site. */
  const crawlOptions = (b: z.infer<typeof crawlBody>, canonicalUrl: string) => {
    const { maxPageSizeKb, ...rest } = b;
    if (rest.listUrls?.length) {
      const host = new URL(canonicalUrl).hostname;
      const foreign = rest.listUrls.filter(u => new URL(u).hostname !== host);
      if (foreign.length) throw new ApiError(400, 'FOREIGN_URL', `La lista solo puede tener URLs de ${host}.`, { foreign: foreign.slice(0, 20) });
    }
    return { ...rest, ...(maxPageSizeKb ? { maxBodyBytes: maxPageSizeKb * 1024 } : {}) };
  };

  const validatePatterns = (b: { include: string[]; exclude: string[]; renderJs?: boolean }) => {
    if (b.renderJs && !findBrowser()) throw new ApiError(400, 'BROWSER_NOT_FOUND', 'Para ejecutar JavaScript se necesita Chrome, Chromium o Edge instalado en el servidor (o la variable CHROME_PATH).');
    for (const r of b.include.concat(b.exclude)) {
      try {
        new RegExp(r);
      } catch {
        throw new ApiError(400, 'INVALID_PATTERN', `Invalid regular expression: ${r}`);
      }
    }
  };

  app.post('/api/v1/sites/:id/crawls', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = crawlBody.parse(req.body ?? {});
    const site = await requireSite(id);
    validatePatterns(body);
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'crawl', status: { in: [...ACTIVE] } } });
    if (active) throw new ApiError(409, 'CRAWL_RUNNING', 'A crawl is already queued or running for this site', { jobId: active.id });
    const job = await enqueue('crawl', { siteId: id, options: crawlOptions(body, site.canonicalUrl) }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });

  app.get('/api/v1/sites/:id/crawls', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const running = await prisma.job.findMany({ where: { siteId: id, type: 'crawl', status: { in: [...ACTIVE] } } });
    const byRun = new Map(running.map(j => [(j.progressDetail as { crawlRunId?: string } | null)?.crawlRunId, j]));
    return (await listCrawlRuns(id)).map(r => {
      const j = byRun.get(r.id);
      return { ...r, jobId: j?.id ?? null, progress: j ? (j.progressDetail as object) : null };
    });
  });

  /** Kept for API compatibility: cancels the job that runs this crawl. */
  app.post('/api/v1/crawls/:id/cancel', async req => {
    const { id } = idParam.parse(req.params);
    const jobs = await prisma.job.findMany({ where: { type: 'crawl', status: { in: [...ACTIVE] } } });
    const job = jobs.find(j => (j.progressDetail as { crawlRunId?: string } | null)?.crawlRunId === id);
    if (!job) throw new ApiError(409, 'CRAWL_NOT_RUNNING', 'This crawl is not running');
    await cancelJob(job.id);
    return { id, jobId: job.id, status: 'cancelling' };
  });

  app.get('/api/v1/sites/:id/schedule', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return getSiteSchedule(id);
  });

  app.put('/api/v1/sites/:id/schedule', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ cron: z.string().max(100).nullable(), options: crawlBody.optional() }).strict().parse(req.body);
    if (b.options) validatePatterns(b.options);
    return setSiteSchedule(id, b.cron?.trim() || null, crawlOptions(b.options ?? crawlBody.parse({}), (await requireSite(id)).canonicalUrl));
  });

  // ------------------------------------------------------------------ SEO explorer (Screaming Frog-style)
  const explorerQuery = z.object({
    tab: z.string().max(40).default('internal'),
    filter: z.string().max(40).optional(),
    q: z.string().max(200).optional(),
    sort: z.string().max(40).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional()
  });
  const requireRun = async (id: string) => {
    const run = await prisma.crawlRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'CRAWL_NOT_FOUND', `Crawl ${id} not found`);
    return run;
  };

  app.get('/api/v1/crawls/:id/explorer/summary', async req => {
    const { id } = idParam.parse(req.params);
    await requireRun(id);
    return explorerSummary(id);
  });

  app.get('/api/v1/crawls/:id/explorer', async req => {
    const { id } = idParam.parse(req.params);
    await requireRun(id);
    return explorerRows(id, explorerQuery.parse(req.query));
  });

  app.get('/api/v1/crawls/:id/explorer.csv', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireRun(id);
    const q = explorerQuery.parse(req.query);
    const csv = await explorerCsv(id, q);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${q.tab}-${q.filter ?? 'all'}-${id.slice(0, 8)}.csv"`)
      .send(csv);
  });

  app.get('/api/v1/crawls/:id/explorer/pages/:pageId', async req => {
    const p = z.object({ id: z.string().uuid(), pageId: z.string().uuid() }).parse(req.params);
    await requireRun(p.id);
    return explorerPageDetail(p.id, p.pageId);
  });

  app.get('/api/v1/crawls/:id/explorer/structure', async req => {
    const { id } = idParam.parse(req.params);
    await requireRun(id);
    return explorerStructure(id);
  });

  const customBody = z
    .object({
      search: z.array(z.object({ name: z.string().trim().min(1).max(60), mode: z.enum(['contains', 'not_contains', 'regex', 'not_regex']), pattern: z.string().min(1).max(300), scope: z.enum(['html', 'text']).default('html') }).strict()).max(10).default([]),
      extract: z.array(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['css', 'regex']), selector: z.string().min(1).max(300), attr: z.string().max(60).optional() }).strict()).max(10).default([])
    })
    .strict();
  app.post('/api/v1/crawls/:id/explorer/custom', async req => {
    const { id } = idParam.parse(req.params);
    await requireRun(id);
    return explorerCustom(id, customBody.parse(req.body ?? {}));
  });

  // ------------------------------------------------------------------ SEO changes on live WordPress content
  app.get('/api/v1/sites/:id/seo-edits/lookup', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ url: z.string().url(), images: z.string().max(20_000).optional() }).parse(req.query);
    await requireSite(id);
    return lookupEditable(id, q.url, q.images ? q.images.split('\n').filter(Boolean) : []);
  });

  app.get('/api/v1/sites/:id/seo-edits', async req => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['proposed', 'approved', 'rejected', 'applied', 'conflict', 'failed', 'reverted']).optional() }).parse(req.query);
    await requireSite(id);
    return listProposals(id, status);
  });

  app.post('/api/v1/sites/:id/seo-edits', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z
      .object({ url: z.string().url(), field: z.enum(['postTitle', 'slug', 'seoTitle', 'metaDescription', 'imageAlt']), newValue: z.string().max(1000), note: z.string().max(500).optional(), imageSrc: z.string().max(2000).optional() })
      .strict()
      .parse(req.body);
    return reply.status(201).send(await proposeChange(id, b));
  });

  app.post('/api/v1/seo-edits/:id/review', async req => {
    const { id } = idParam.parse(req.params);
    const { decision } = z.object({ decision: z.enum(['approved', 'rejected']) }).strict().parse(req.body);
    return reviewProposal(id, decision);
  });

  app.post('/api/v1/seo-edits/:id/apply', async req => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal(true, { message: 'Send {"confirm": true}: this changes live content' }) }).strict().parse(req.body);
    return applyProposal(id);
  });

  app.post('/api/v1/seo-edits/:id/verify', async req => {
    const { id } = idParam.parse(req.params);
    return verifyProposal(id);
  });

  app.post('/api/v1/seo-edits/:id/revert', async req => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal(true, { message: 'Send {"confirm": true}' }) }).strict().parse(req.body);
    return revertProposal(id);
  });

  // ------------------------------------------------------------------ performance (Core Web Vitals)
  /** Homepage + most-linked indexable pages of the latest completed crawl. */
  const performanceCandidates = async (siteId: string, canonicalUrl: string, take = 4) => {
    const home = new URL('/', canonicalUrl).toString();
    const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed' }, orderBy: { startedAt: 'desc' } });
    const pages = run
      ? await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, isIndexable: true, NOT: { url: home } }, orderBy: { inlinks: 'desc' }, take, select: { url: true, inlinks: true, title: true } })
      : [];
    return [{ url: home, inlinks: null as number | null, title: 'Portada' }, ...pages];
  };

  app.get('/api/v1/sites/:id/performance/candidates', async req => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    return performanceCandidates(id, site.canonicalUrl);
  });

  app.post('/api/v1/sites/:id/performance', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    const b = z
      .object({ urls: z.array(z.string().url()).min(1).max(10).optional(), strategies: z.array(z.enum(['mobile', 'desktop'])).min(1).max(2).default(['mobile']) })
      .strict()
      .parse(req.body ?? {});
    const host = new URL(site.canonicalUrl).hostname;
    const urls = b.urls ?? (await performanceCandidates(id, site.canonicalUrl)).map(c => c.url);
    const foreign = urls.filter(u => new URL(u).hostname !== host);
    if (foreign.length) throw new ApiError(400, 'FOREIGN_URL', `Only URLs of ${host} can be measured`, { foreign });
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'performance', status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } });
    if (active) throw new ApiError(409, 'PERFORMANCE_RUNNING', 'A measurement is already queued or running for this site', { jobId: active.id });
    const job = await enqueue('performance', { siteId: id, urls: [...new Set(urls)], strategies: b.strategies }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });

  /** Latest run per URL+strategy, with the last 10 runs of each for trends. */
  app.get('/api/v1/sites/:id/performance', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const runs = await prisma.performanceRun.findMany({ where: { siteId: id }, orderBy: { createdAt: 'desc' }, take: 500, omit: { report: true } });
    const groups = new Map<string, typeof runs>();
    for (const r of runs) {
      const k = `${r.url}|${r.strategy}`;
      if (!groups.has(k)) groups.set(k, []);
      if (groups.get(k)!.length < 10) groups.get(k)!.push(r);
    }
    return {
      config: { psiConfigured: !!process.env.PSI_API_KEY, source: process.env.PSI_API_KEY ? 'psi' : 'lighthouse-local' },
      items: [...groups.values()].map(list => ({ latest: list[0], history: list.map(r => ({ id: r.id, createdAt: r.createdAt, status: r.status, performanceScore: r.performanceScore, labLcp: r.labLcp, labCls: r.labCls, labTbt: r.labTbt, fieldLcp: r.fieldLcp, fieldInp: r.fieldInp, fieldCls: r.fieldCls })) }))
    };
  });

  /** Full GTmetrix-style report of one measurement (screenshot, filmstrip, issues, waterfall). */
  app.get('/api/v1/performance-runs/:id', async req => {
    const { id } = idParam.parse(req.params);
    const run = await prisma.performanceRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Measurement not found');
    await requireSite(run.siteId);
    return run;
  });

  // ------------------------------------------------------------------ jobs
  app.get('/api/v1/jobs', async req => {
    const q = z
      .object({ siteId: z.string().uuid().optional(), status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRYING']).optional(), type: z.string().max(40).optional(), take: z.coerce.number().int().min(1).max(500).optional() })
      .parse(req.query);
    return listJobs(req.auth!.workspaceId, q);
  });

  app.get('/api/v1/jobs/:id', async req => {
    const { id } = idParam.parse(req.params);
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job || job.workspaceId !== req.auth!.workspaceId) throw new ApiError(404, 'JOB_NOT_FOUND', `Job ${id} not found`);
    return job;
  });

  app.post('/api/v1/jobs/:id/cancel', async req => {
    const { id } = idParam.parse(req.params);
    return cancelJob(id);
  });

  app.post('/api/v1/jobs/:id/retry', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return reply.status(202).send(await retryJob(id));
  });

  app.post('/api/v1/maintenance/retention', async (req, reply) => {
    const job = await enqueue('retention', {}, { workspaceId: req.auth!.workspaceId, trigger: 'manual' });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });

  app.get('/api/v1/crawls/:id/pages', async req => {
    const { id } = idParam.parse(req.params);
    const q = z
      .object({
        status: z.enum(['ok', 'redirect', 'error', 'blocked']).optional(),
        indexable: z.enum(['true', 'false']).optional(),
        q: z.string().max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50)
      })
      .parse(req.query);
    const run = await prisma.crawlRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'CRAWL_NOT_FOUND', `Crawl ${id} not found`);
    const res = await listCrawledPages(id, { status: q.status, indexable: q.indexable === undefined ? undefined : q.indexable === 'true', q: q.q, skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    return { ...res, page: q.page, pageSize: q.pageSize };
  });

  app.get('/api/v1/crawls/:id/diff', async req => {
    const { id } = idParam.parse(req.params);
    const { base, type } = z.object({ base: z.string().uuid().optional(), type: z.string().max(40).optional() }).parse(req.query);
    const run = await prisma.crawlRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'CRAWL_NOT_FOUND', `Crawl ${id} not found`);
    const diff = await getCrawlDiff(id, base);
    if (!diff) throw new ApiError(404, 'NO_BASELINE', 'There is no earlier completed crawl to compare with');
    const changes = type ? diff.changes.filter(c => c.type === type) : diff.changes;
    return { ...diff, changes: changes.slice(0, 1000), totalChanges: changes.length };
  });

  // ------------------------------------------------------------------ alerts
  app.get('/api/v1/sites/:id/alerts', async req => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['open', 'acknowledged']).optional() }).parse(req.query);
    await requireSite(id);
    return listAlerts(id, status);
  });

  app.post('/api/v1/alerts/:id/acknowledge', async req => {
    const { id } = idParam.parse(req.params);
    const exists = await prisma.alert.findUnique({ where: { id } });
    if (!exists) throw new ApiError(404, 'ALERT_NOT_FOUND', `Alert ${id} not found`);
    return acknowledgeAlert(id);
  });

  // ------------------------------------------------------------------ issues
  app.get('/api/v1/sites/:id/issues', async req => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional() }).parse(req.query);
    await requireSite(id);
    return listIssues(id, status);
  });

  app.post('/api/v1/issues/:id/status', async req => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'ignored']) }).strict().parse(req.body);
    const exists = await prisma.issue.findUnique({ where: { id } });
    if (!exists) throw new ApiError(404, 'ISSUE_NOT_FOUND', `Issue ${id} not found`);
    return setIssueStatus(id, status);
  });

  // ------------------------------------------------------------------ audit
  app.get('/api/v1/audit-events', async req => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return listAuditEvents(req.auth!.workspaceId, limit);
  });

  // ------------------------------------------------------------------ tools (stateless)
  app.post('/api/v1/schemas/validate', async req => {
    const body = req.body;
    return validateJsonLd(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  });

  const previewBody = z.object({
    titleTemplate: z.string().max(500).default('{{keyword}} guide {{year}}'),
    bodyTemplate: z.string().max(50_000).default('<p>{{keyword}}</p>'),
    metaDescription: z.string().max(500).default(''),
    slug: z.string().max(200).default(''),
    compareWith: z.string().max(50_000).default(''),
    data: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
  });
  app.post('/api/v1/generated-pages/preview', async req => {
    const b = previewBody.parse(req.body ?? {});
    const title = renderTemplate(b.titleTemplate, b.data);
    const content = renderTemplate(b.bodyTemplate, b.data);
    const similarityScore = b.compareWith ? computeJaccardSimilarity(content, b.compareWith) : 0;
    const qualityGate = evaluateQualityGate({ title, metaDescription: b.metaDescription, content, similarityScore, slug: b.slug });
    return { title, content, similarityScore, qualityGate };
  });

  // ------------------------------------------------------------------ WordPress connection
  app.get('/api/v1/sites/:id/wordpress', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return { connection: await getConnection(id) };
  });

  app.put('/api/v1/sites/:id/wordpress', async req => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ endpointUrl: z.string().url().max(500), username: z.string().min(1).max(100), appPassword: z.string().min(8).max(200).optional() })
      .strict()
      .parse(req.body);
    try {
      return { connection: await saveConnection(id, body) };
    } catch (e) {
      if ((e as { code?: string }).code === 'HTTPS_REQUIRED') throw new ApiError(400, 'HTTPS_REQUIRED', (e as Error).message);
      throw e;
    }
  });

  app.delete('/api/v1/sites/:id/wordpress', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal('true', { message: 'Pass ?confirm=true to delete the stored credentials' }) }).parse(req.query);
    await deleteConnection(id);
    return reply.status(204).send();
  });

  app.post('/api/v1/sites/:id/wordpress/test', async req => {
    const { id } = idParam.parse(req.params);
    return testConnection(id);
  });

  app.get('/api/v1/sites/:id/wordpress/categories', async req => {
    const { id } = idParam.parse(req.params);
    return listRemoteCategories(id);
  });

  // ------------------------------------------------------------------ generated pages
  app.get('/api/v1/sites/:id/generated-pages', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ status: z.enum(['BLOCKED', 'NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'APPROVED', 'SENT_AS_DRAFT', 'ARCHIVED']).optional(), templateId: z.string().uuid().optional() }).parse(req.query);
    await requireSite(id);
    return listGeneratedPages(id, q);
  });

  // ------------------------------------------------------------------ datasets & templates
  app.post('/api/v1/sites/:id/datasets', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ name: z.string().min(1).max(120), fileName: z.string().min(1).max(200) }).parse(req.query);
    if (typeof req.body !== 'string') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the CSV as text/csv');
    if (!/\.(csv|tsv|txt)$/i.test(q.fileName)) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Only .csv, .tsv or .txt files are accepted');
    return reply.status(201).send(await importDataset(id, { name: q.name, filename: q.fileName, csv: req.body }));
  });

  app.get('/api/v1/sites/:id/datasets', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listDatasets(id);
  });

  app.delete('/api/v1/datasets/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal('true', { message: 'Pass ?confirm=true to delete the dataset and its templates' }) }).parse(req.query);
    await deleteDataset(id);
    return reply.status(204).send();
  });

  const templateBody = z
    .object({
      name: z.string().min(1).max(120),
      titleTemplate: z.string().min(1).max(500),
      descTemplate: z.string().max(1000),
      bodyTemplate: z.string().min(1).max(100_000),
      slugTemplate: z.string().min(1).max(300)
    })
    .strict();

  app.post('/api/v1/datasets/:id/templates', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return reply.status(201).send(await createTemplate(id, templateBody.parse(req.body)));
  });

  app.get('/api/v1/sites/:id/templates', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listTemplates(id);
  });

  app.post('/api/v1/templates/:id/generate', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ rows: z.array(z.number().int().min(0)).max(MAX_BATCH).optional(), limit: z.number().int().min(1).max(MAX_BATCH).optional() }).strict().parse(req.body ?? {});
    return generateFromTemplate(id, b);
  });

  const idList = z.array(z.string().uuid()).min(1).max(MAX_BATCH);
  app.post('/api/v1/generated-pages/bulk-review', async req => {
    const b = z.object({ ids: idList, decision: z.enum(['approved', 'rejected']), reviewer: z.string().max(100).optional(), notes: z.string().max(2000).optional() }).strict().parse(req.body);
    return { results: await bulkReview(b.ids, b.decision, req.auth!.user.name, b.notes) };
  });

  app.post('/api/v1/generated-pages/bulk-push', async req => {
    const b = z.object({ ids: idList.max(100), categories: z.array(z.number().int().positive()).max(20).optional() }).strict().parse(req.body);
    return { results: await bulkPush(b.ids, { categories: b.categories }) };
  });

  /** Deletes rejected pages of a site (all of them, or the given ids). Pages already in WordPress are kept. */
  app.post('/api/v1/sites/:id/generated-pages/delete-rejected', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ ids: z.array(z.string().uuid()).max(1000).optional(), confirm: z.literal(true, { message: 'Send {"confirm": true} to delete' }) }).strict().parse(req.body);
    return deleteRejectedPages(id, b.ids, req.auth!.user.id);
  });

  app.post('/api/v1/generated-pages/:id/archive', async req => {
    const { id } = idParam.parse(req.params);
    return archivePage(id);
  });

  app.post('/api/v1/sites/:id/generated-pages', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        titleTemplate: z.string().min(1).max(500),
        bodyTemplate: z.string().min(1).max(100_000),
        metaTemplate: z.string().max(1000).default(''),
        slugTemplate: z.string().max(300).default(''),
        data: z.record(z.union([z.string().max(10_000), z.number(), z.boolean()])).refine(d => Object.keys(d).length <= 100, 'Too many fields')
      })
      .strict()
      .parse(req.body);
    return reply.status(201).send(await createGeneratedPage(id, body));
  });

  app.post('/api/v1/generated-pages/:id/review', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ decision: z.enum(['approved', 'rejected']), reviewer: z.string().max(100).optional(), notes: z.string().max(2000).optional() }).strict().parse(req.body);
    // The reviewer is the signed-in user; a name in the body is ignored.
    return reviewPage(id, b.decision, req.auth!.user.name, b.notes);
  });

  const sendBody = z.object({ categories: z.array(z.number().int().positive()).max(20).optional(), overwriteRemoteChanges: z.boolean().optional() }).strict();

  app.post('/api/v1/generated-pages/:id/wordpress/dry-run', async req => {
    const { id } = idParam.parse(req.params);
    const b = sendBody.omit({ overwriteRemoteChanges: true }).parse(req.body ?? {});
    return dryRunPage(id, b);
  });

  // Idempotency: a retried request with the same Idempotency-Key returns the first result instead of sending again.
  const idempotent = new Map<string, { at: number; status: number; body: unknown }>();
  app.post('/api/v1/generated-pages/:id/wordpress/push', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = sendBody.parse(req.body ?? {});
    const key = typeof req.headers['idempotency-key'] === 'string' ? `${id}:${req.headers['idempotency-key'].slice(0, 100)}` : null;
    const now = Date.now();
    for (const [k, v] of idempotent) if (now - v.at > 24 * 3600_000) idempotent.delete(k);
    if (key && idempotent.has(key)) {
      const prev = idempotent.get(key)!;
      return reply.status(prev.status).header('idempotent-replay', 'true').send(prev.body);
    }
    const result = await pushPageAsDraft(id, b);
    if (key) idempotent.set(key, { at: now, status: 200, body: result });
    return result;
  });

  app.post('/api/v1/wordpress/publications/:id/rollback', async req => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal(true, { message: 'Send {"confirm": true} to overwrite the remote draft with the saved copy' }) }).strict().parse(req.body);
    return rollbackPublication(id);
  });

  // ------------------------------------------------------------------ Google Search Console
  const webOrigin = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim();
  app.get('/api/v1/gsc/status', async req => gscStatus(req.auth!.workspaceId));
  app.get('/api/v1/gsc/oauth/start', async (req, reply) => reply.redirect(gscAuthUrl(req.auth!.workspaceId, req.auth!.user.id)));
  app.get('/api/v1/gsc/oauth/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    const back = (params: Record<string, string>) => reply.redirect(`${webOrigin()}/?${new URLSearchParams({ nav: 'gsc', ...params })}`);
    if (q.error || !q.code || !q.state) return back({ gsc: 'error', message: q.error === 'access_denied' ? 'Cancelaste el permiso en Google.' : `Google respondió: ${q.error ?? 'sin código'}` });
    try {
      await gscFinishOAuth({ code: q.code, state: q.state, workspaceId: req.auth!.workspaceId, userId: req.auth!.user.id });
      return back({ gsc: 'connected' });
    } catch (e) {
      return back({ gsc: 'error', message: (e as Error).message });
    }
  });
  app.delete('/api/v1/gsc/connection', async req => gscDisconnect(req.auth!.workspaceId, req.auth!.user.id));
  app.get('/api/v1/gsc/properties', async req => gscProperties(req.auth!.workspaceId));
  app.put('/api/v1/sites/:id/gsc', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ property: z.string().min(1).max(500).nullable() }).strict().parse(req.body);
    return setSiteGscProperty(id, b.property);
  });
  app.post('/api/v1/sites/:id/gsc/import', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    const b = z.object({ days: z.number().int().min(7).max(480).default(90) }).strict().parse(req.body ?? {});
    if (!site.gscProperty) throw new ApiError(400, 'GSC_NO_PROPERTY', 'Elige la propiedad de Search Console de este sitio.');
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'gsc-import', status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } });
    if (active) throw new ApiError(409, 'GSC_IMPORT_RUNNING', 'Ya hay una importación en curso para este sitio.', { jobId: active.id });
    const job = await enqueue('gsc-import', { siteId: id, days: b.days }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });
  app.get('/api/v1/sites/:id/gsc/report', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return gscReport(id);
  });

  return app;
}
