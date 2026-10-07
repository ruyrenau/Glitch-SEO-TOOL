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
  importLogFile,
  deleteLogImport,
  getLogReport,
  getBotUrlRows,
  replaceSitemapUrls,
  listAuditEvents,
  runCrawl,
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
  importDataset,
  listDatasets,
  deleteDataset,
  createTemplate,
  listTemplates,
  generateFromTemplate,
  bulkReview,
  bulkPush,
  archivePage,
  MAX_BATCH,
  DuplicateImportError
} from '@glitch/db';
import { fetchSitemap, parseSitemapXml } from '@glitch/crawler';
import { validateJsonLd } from '@glitch/schema-engine';
import { renderTemplate, computeJaccardSimilarity, evaluateQualityGate } from '@glitch/content-engine';
import { GoogleSearchConsoleClient } from '@glitch/connectors';
import { registerAuth } from './auth';

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
      return { status: 'ready', db: 'ok' };
    } catch (e) {
      return reply.status(503).send({ status: 'not_ready', db: 'error', message: (e as Error).message });
    }
  });

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
   * The stream is written to a temp file with a byte cap, then parsed by streaming.
   */
  app.post('/api/v1/sites/:id/log-imports', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ fileName: z.string().min(1).max(200), replace: z.enum(['true', 'false']).optional() }).parse(req.query);
    await requireSite(id);
    const baseName = path.basename(q.fileName);
    if (!ALLOWED_LOG_EXT.test(baseName)) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Only .log, .txt and .gz files are accepted');
    if (!(req.body instanceof Readable)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as application/octet-stream');

    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const tmp = path.join(UPLOAD_DIR, `${crypto.randomUUID()}.upload`); // never trust the client name for paths
    let written = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > MAX_UPLOAD_BYTES) cb(new ApiError(413, 'FILE_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`));
        else cb(null, chunk);
      }
    });
    try {
      await pipeline(req.body, limiter, fs.createWriteStream(tmp));
      if (written === 0) throw new ApiError(400, 'EMPTY_FILE', 'Uploaded file is empty');
      const result = await importLogFile({ siteId: id, filePath: tmp, fileName: baseName, replaceExisting: q.replace === 'true' });
      return reply.status(201).send(jsonSafe(result));
    } finally {
      await fs.promises.rm(tmp, { force: true });
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

  // ------------------------------------------------------------------ crawls
  // Crawls run in-process in the background (no queue yet). State lives in this map;
  // runs left "running" by a previous process are marked failed at startup.
  const activeCrawls = new Map<string, { siteId: string; controller: AbortController; progress: { crawled: number; queued: number; current: string } }>();
  await prisma.crawlRun.updateMany({ where: { status: 'running' }, data: { status: 'failed', error: 'Interrupted: API restarted', completedAt: new Date() } });
  app.addHook('onClose', async () => activeCrawls.forEach(c => c.controller.abort()));

  const crawlBody = z
    .object({
      maxUrls: z.number().int().min(1).max(5000).default(500),
      maxDepth: z.number().int().min(0).max(20).default(5),
      concurrency: z.number().int().min(1).max(8).default(2),
      rps: z.number().min(0.1).max(20).optional(),
      respectRobots: z.boolean().default(true),
      include: z.array(z.string().max(200)).max(20).default([]),
      exclude: z.array(z.string().max(200)).max(50).default([]),
      seedFromSitemap: z.boolean().default(true)
    })
    .strict();

  app.post('/api/v1/sites/:id/crawls', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = crawlBody.parse(req.body ?? {});
    await requireSite(id);
    for (const r of body.include.concat(body.exclude)) {
      try {
        new RegExp(r);
      } catch {
        throw new ApiError(400, 'INVALID_PATTERN', `Invalid regular expression: ${r}`);
      }
    }
    if ([...activeCrawls.values()].some(c => c.siteId === id)) throw new ApiError(409, 'CRAWL_RUNNING', 'A crawl is already running for this site');
    const allowHosts = (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const controller = new AbortController();
    const state = { siteId: id, controller, progress: { crawled: 0, queued: 0, current: '' } };
    const started = new Promise<string>((resolve, reject) => {
      runCrawl({
        siteId: id,
        ...body,
        allowHosts,
        signal: controller.signal,
        onStarted: runId => {
          activeCrawls.set(runId, state);
          resolve(runId);
        },
        onProgress: p => (state.progress = p)
      })
        .catch(err => {
          req.log.error({ err }, 'crawl failed');
          reject(err);
        })
        .finally(() => {
          for (const [k, v] of activeCrawls) if (v === state) activeCrawls.delete(k);
        });
    });
    const runId = await started;
    return reply.status(202).send({ id: runId, status: 'running' });
  });

  app.get('/api/v1/sites/:id/crawls', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return (await listCrawlRuns(id)).map(r => ({ ...r, progress: activeCrawls.get(r.id)?.progress ?? null }));
  });

  app.post('/api/v1/crawls/:id/cancel', async req => {
    const { id } = idParam.parse(req.params);
    const c = activeCrawls.get(id);
    if (!c) throw new ApiError(409, 'CRAWL_NOT_RUNNING', 'This crawl is not running');
    c.controller.abort();
    return { id, status: 'cancelling' };
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

  app.get('/api/v1/search-console/metrics', async () => {
    if (!config.DEMO_MODE) throw new ApiError(501, 'NOT_CONFIGURED', 'Search Console OAuth is not implemented yet');
    const rows = await new GoogleSearchConsoleClient('sc-domain:demo.example.com', true).getSearchAnalytics();
    return { demo: true, rows };
  });

  return app;
}
