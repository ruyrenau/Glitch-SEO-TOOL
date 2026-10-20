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
  getMonitorConfig,
  REPORT_SECTIONS,
  createReport,
  listReports,
  revokeReport,
  publicReport,
  getNotifyConfig,
  saveNotifyConfig,
  testMonitorWebhook,
  listMonitorNotifications,
  notifyMonitorChanges,
  Prisma,
  listAiPrompts,
  createAiPrompt,
  updateAiPrompt,
  deleteAiPrompt,
  saveAiObservation,
  deleteAiObservation,
  aiHistory,
  aiMatrix,
  aiCsv,
  listAiAnalyses,
  runAiAnalysis,
  listAiKeys,
  setAiKey,
  deleteAiKey,
  recordAuditEvent,
  saveMonitorConfig,
  pickVitalsUrls,
  monitorOverview,
  gscStatus,
  gscAuthUrl,
  gscFinishOAuth,
  gscDisconnect,
  gscProperties,
  setSiteGscProperty,
  gscReport,
  cannibalizationReport,
  aiReadinessReport,
  latestAgentAudit,
  listExperiments,
  gseoPluginInfo,
  publishLlmsTxt,
  siteDashboard,
  latestContentGap,
  gapKeywordSuggestions,
  startContentGap,
  createGapBrief,
  createExperiment,
  updateExperiment,
  deleteExperiment,
  runExperimentAnalysis,
  startAgentAudit,
  getAgentCatalog,
  saveAgentCatalog,
  buildAgentDocuments,
  publishAgentCatalog,
  validateAgentEndpoints,
  workspaceLimits,
  ensureSuperAdmin,
  importBacklinks,
  listBacklinkImports,
  backlinkReport,
  serpReport,
  saveSerpConfig,
  addSerpKeywords,
  suggestSerpKeywords,
  removeSerpKeyword,
  ENTITY_PAGE_TYPES,
  getEntityOrg,
  saveEntityOrg,
  listEntityAuthors,
  saveEntityAuthor,
  deleteEntityAuthor,
  listEntityPages,
  saveEntityPage,
  entityGraphFor,
  suggestPageEntities,
  searchWikidata,
  eeatAudit,
  consolidationCandidates,
  listConsolidations,
  createConsolidation,
  getConsolidation,
  aiDraft,
  manualDraft,
  saveDraft,
  approveConsolidation,
  applyConsolidation,
  revertConsolidation,
  discardConsolidation,
  proposeInternalLink,
  internalLinkReport,
  internalLinkSuggestions,
  redirectSuggestions,
  pushRedirectsToWordPress,
  renderReport,
  renderDiff,
  aiBotView,
  generateSiteLlmsTxt,
  validateSiteLlmsTxt,
  ga4Status,
  ga4Properties,
  setSiteGa4Property,
  ga4Report,
  duplicateContentReport,
  decliningContentReport,
  keywordTopicsReport,
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
import { HARD_MAX_URLS, MAX_RPS, fetchSitemap, findBrowser, parseSitemapXml, fetchWithRedirects, extractPageHints, suggestSchemaForms, renderPdf } from '@glitch/crawler';
import { validateJsonLd, validateSchema, CATALOG } from '@glitch/schema-engine';
import { renderTemplate, computeJaccardSimilarity, evaluateQualityGate } from '@glitch/content-engine';
import { fetchCruxHistory, CruxError, type CruxHistory } from '@glitch/performance';
import { registerAuth } from './auth';
import { zipFolder } from './zip';
import { enqueue, cancelJob, retryJob, listJobs, queueHealth, setSiteSchedule, getSiteSchedule, setVitalsSchedule, describeCron, closeProducer, uploadDir } from '@glitch/jobs';

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
    bodyLimit: 5 * 1024 * 1024,
    // Behind Apache/Nginx on the same server (TRUST_PROXY=1): the visitor's IP comes from X-Forwarded-For,
    // trusted only when the request arrives from the local proxy.
    trustProxy: process.env.TRUST_PROXY === '1' ? ['127.0.0.1', '::1'] : false
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
  await ensureSuperAdmin().catch(() => undefined);

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
    const lim = await workspaceLimits(req.auth!.workspaceId);
    if (lim.maxSites !== null && lim.sites >= lim.maxSites) throw new ApiError(400, 'SITE_LIMIT', `Este espacio admite hasta ${lim.maxSites} sitios. Archiva uno o pide al administrador que suba el límite.`);
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

  /** Overview desk: the headline result of every module. */
  app.get('/api/v1/sites/:id/dashboard', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return siteDashboard(id);
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

  const assertCrawlLimit = async (workspaceId: string, maxUrls: number | undefined) => {
    const lim = await workspaceLimits(workspaceId);
    if (lim.maxCrawlUrls !== null && (maxUrls ?? 0) > lim.maxCrawlUrls) throw new ApiError(400, 'CRAWL_LIMIT', `Este espacio permite crawls de hasta ${lim.maxCrawlUrls.toLocaleString('es-MX')} URLs.`);
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
    await assertCrawlLimit(site.workspaceId, body.maxUrls);
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

  // ------------------------------------------------------------------ Monitoreo (optional automation + evolution)
  const CRAWL_CRON = { daily: '0 3 * * *', weekly: '0 3 * * 1' } as const;
  const VITALS_CRON = { daily: '0 5 * * *', weekly: '0 5 * * 1' } as const;
  const freqOf = (cron: string | null | undefined, table: Record<string, string>) => (Object.entries(table).find(([, c]) => c === cron)?.[0] ?? (cron ? 'custom' : null));
  const monitorState = async (siteId: string) => {
    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const cfg = await getMonitorConfig(siteId);
    const crawl = await getSiteSchedule(siteId);
    const gsc = await gscStatus(site.workspaceId);
    return {
      crawl: { enabled: !!crawl.cron, frequency: freqOf(crawl.cron, CRAWL_CRON), cron: crawl.cron, nextRuns: crawl.nextRuns, maxUrls: (crawl.options as { maxUrls?: number } | null)?.maxUrls ?? 500 },
      gsc: { enabled: cfg.gscEnabled, configured: gsc.configured, connected: gsc.connected, property: site.gscProperty },
      vitals: { enabled: cfg.vitalsEnabled, frequency: freqOf(cfg.vitalsCron, VITALS_CRON), nextRuns: cfg.vitalsEnabled ? describeCron(cfg.vitalsCron, site.timezone) : [], urlMode: cfg.vitalsUrlMode, urls: cfg.vitalsUrls, count: cfg.vitalsCount, strategies: cfg.vitalsStrategies, willMeasure: await pickVitalsUrls(siteId), source: process.env.PSI_API_KEY ? 'psi' : 'lighthouse-local' }
    };
  };
  app.get('/api/v1/sites/:id/monitor', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return monitorState(id);
  });
  const monitorBody = z
    .object({
      crawl: z.object({ enabled: z.boolean(), frequency: z.enum(['daily', 'weekly']).default('weekly'), maxUrls: z.number().int().min(1).max(100_000).default(500) }).strict(),
      gsc: z.object({ enabled: z.boolean() }).strict(),
      vitals: z
        .object({
          enabled: z.boolean(),
          frequency: z.enum(['daily', 'weekly']).default('weekly'),
          urlMode: z.enum(['top', 'manual']).default('top'),
          urls: z.array(z.string().url().max(2000)).max(20).default([]),
          count: z.number().int().min(1).max(20).default(5),
          strategies: z.array(z.enum(['mobile', 'desktop'])).min(1).max(2).default(['mobile'])
        })
        .strict()
    })
    .strict();
  app.put('/api/v1/sites/:id/monitor', async req => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    const b = monitorBody.parse(req.body);
    if (b.gsc.enabled && !site.gscProperty) throw new ApiError(400, 'GSC_NO_PROPERTY', 'Conecta Search Console y elige la propiedad de este sitio antes de activar la importación diaria.');
    const host = new URL(site.canonicalUrl).hostname;
    if (b.vitals.urls.some(u => new URL(u).hostname !== host)) throw new ApiError(400, 'FOREIGN_URL', `Solo se pueden medir URLs de ${host}.`);
    const prevOptions = ((await getSiteSchedule(id)).options ?? {}) as Record<string, unknown>;
    await setSiteSchedule(id, b.crawl.enabled ? CRAWL_CRON[b.crawl.frequency] : null, crawlOptions(crawlBody.parse({ ...prevOptions, maxUrls: b.crawl.maxUrls }), site.canonicalUrl));
    const vitalsCron = VITALS_CRON[b.vitals.frequency];
    await saveMonitorConfig(id, { gscEnabled: b.gsc.enabled, vitalsEnabled: b.vitals.enabled, vitalsCron, vitalsUrlMode: b.vitals.urlMode, vitalsUrls: b.vitals.urls, vitalsCount: b.vitals.count, vitalsStrategies: b.vitals.strategies });
    await setVitalsSchedule(id, b.vitals.enabled ? vitalsCron : null);
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: req.auth!.user.id, action: 'monitor.updated', entity: 'Site', entityId: id, details: { crawl: b.crawl.enabled ? b.crawl.frequency : 'off', gsc: b.gsc.enabled, vitals: b.vitals.enabled ? b.vitals.frequency : 'off' } });
    return monitorState(id);
  });
  /** Runs every enabled part now (skipping parts already queued or running). */
  app.post('/api/v1/sites/:id/monitor/run', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    const state = await monitorState(id);
    const busy = async (type: string) => !!(await prisma.job.findFirst({ where: { siteId: id, type, status: { in: [...ACTIVE] } } }));
    const queued: Record<string, string> = {};
    const o = { siteId: id, workspaceId: site.workspaceId };
    if (state.crawl.enabled && !(await busy('crawl'))) queued.crawl = (await enqueue('crawl', { siteId: id, options: (await getSiteSchedule(id)).options ?? {} }, o)).id;
    if (state.gsc.enabled && site.gscProperty && !(await busy('gsc-import'))) queued.gsc = (await enqueue('gsc-import', { siteId: id, days: 90 }, o)).id;
    if (state.vitals.enabled && !(await busy('monitor-vitals')) && !(await busy('performance'))) queued.vitals = (await enqueue('monitor-vitals', { siteId: id }, o)).id;
    if (!Object.keys(queued).length) throw new ApiError(400, 'NOTHING_TO_RUN', 'No hay nada activo para ejecutar, o ya se está ejecutando.');
    return reply.status(202).send({ queued });
  });
  app.get('/api/v1/sites/:id/monitor/notifications', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return { config: await getNotifyConfig(id), sent: await listMonitorNotifications(id) };
  });
  app.put('/api/v1/sites/:id/monitor/notifications', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ enabled: z.boolean(), level: z.enum(['bad', 'bad_warn']).default('bad'), webhookUrl: z.string().max(2000).nullable().optional() }).strict().parse(req.body);
    return saveNotifyConfig(id, b);
  });
  app.post('/api/v1/sites/:id/monitor/notifications/test', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return testMonitorWebhook(id);
  });
  /** Sends now whatever important change has not been notified yet. */
  app.post('/api/v1/sites/:id/monitor/notifications/send', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return notifyMonitorChanges(id);
  });
  app.get('/api/v1/sites/:id/monitor/overview', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return monitorOverview(id);
  });

  // ------------------------------------------------------------------ Visibilidad en IA (GEO)
  const requirePrompt = async (id: string) => {
    const p = await prisma.aiPrompt.findUnique({ where: { id } });
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'Pregunta no encontrada');
    return p;
  };
  app.get('/api/v1/sites/:id/ai-visibility/prompts', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listAiPrompts(id);
  });
  app.post('/api/v1/sites/:id/ai-visibility/prompts', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ text: z.string().min(3).max(500), keyword: z.string().min(1).max(120) }).strict().parse(req.body);
    return reply.status(201).send(await createAiPrompt(id, b));
  });
  app.patch('/api/v1/ai-prompts/:id', async req => {
    const { id } = idParam.parse(req.params);
    await requirePrompt(id);
    return updateAiPrompt(id, z.object({ text: z.string().min(3).max(500).optional(), keyword: z.string().min(1).max(120).optional(), active: z.boolean().optional() }).strict().parse(req.body));
  });
  app.delete('/api/v1/ai-prompts/:id', async req => {
    const { id } = idParam.parse(req.params);
    await requirePrompt(id);
    return deleteAiPrompt(id);
  });
  const pos = z.union([z.literal(1), z.literal(3), z.literal(4)]).nullable().optional();
  app.post('/api/v1/sites/:id/ai-visibility/observations', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z
      .object({
        promptId: z.string().uuid(),
        engine: z.enum(['chatgpt', 'claude', 'gemini', 'google_ai']),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mentioned: z.boolean(),
        mentionPos: pos,
        mentionText: z.string().max(20_000).nullable().optional(),
        mentionComment: z.string().max(2000).nullable().optional(),
        cited: z.boolean(),
        citePos: pos,
        citeText: z.string().max(20_000).nullable().optional(),
        citeComment: z.string().max(2000).nullable().optional()
      })
      .strict()
      .parse(req.body);
    return saveAiObservation(id, b);
  });
  app.get('/api/v1/sites/:id/ai-visibility/history', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const q = z.object({ promptId: z.string().uuid(), engine: z.string().max(20) }).parse(req.query);
    return aiHistory(id, q.promptId, q.engine);
  });
  app.delete('/api/v1/ai-observations/:id', async req => {
    const { id } = idParam.parse(req.params);
    if (!(await prisma.aiObservation.findUnique({ where: { id } }))) throw new ApiError(404, 'NOT_FOUND', 'Revisión no encontrada');
    return deleteAiObservation(id);
  });
  app.get('/api/v1/sites/:id/ai-visibility/matrix', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return aiMatrix(id, z.object({ keyword: z.string().max(120).optional() }).parse(req.query));
  });
  app.get('/api/v1/sites/:id/ai-visibility/export.csv', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="visibilidad-ia.csv"');
    return '\ufeff' + (await aiCsv(id));
  });
  app.get('/api/v1/sites/:id/ai-visibility/analyses', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listAiAnalyses(id);
  });
  app.post('/api/v1/sites/:id/ai-visibility/analyses', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return reply.status(201).send(await runAiAnalysis(id, req.auth!.user.id));
  });
  // API keys of AI providers (Admins). Values are never returned, only a 4-character hint.
  app.get('/api/v1/ai-keys', async req => listAiKeys(req.auth!.workspaceId));
  app.put('/api/v1/ai-keys/:provider', async req => {
    const { provider } = z.object({ provider: z.string().max(20) }).parse(req.params);
    const b = z.object({ key: z.string().min(1).max(500) }).strict().parse(req.body);
    return setAiKey(req.auth!.workspaceId, provider, b.key, req.auth!.user.id);
  });
  app.delete('/api/v1/ai-keys/:provider', async req => {
    const { provider } = z.object({ provider: z.string().max(20) }).parse(req.params);
    return deleteAiKey(req.auth!.workspaceId, provider, req.auth!.user.id);
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

  // "Vista de bot de IA": clean Markdown and RAG chunks of one page.
  app.get('/api/v1/crawls/:id/explorer/pages/:pageId/ai-view', async req => {
    const p = z.object({ id: z.string().uuid(), pageId: z.string().uuid() }).parse(req.params);
    const q = z.object({ size: z.coerce.number().int().min(128).max(4096).optional() }).parse(req.query);
    await requireRun(p.id);
    return aiBotView(p.id, p.pageId, { maxTokens: q.size });
  });

  app.get('/api/v1/crawls/:id/explorer/pages/:pageId/render-diff', async req => {
    const p = z.object({ id: z.string().uuid(), pageId: z.string().uuid() }).parse(req.params);
    await requireRun(p.id);
    return renderDiff(p.id, p.pageId);
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
      .object({ url: z.string().url(), field: z.enum(['postTitle', 'slug', 'seoTitle', 'metaDescription', 'imageAlt', 'schemaJsonLd']), newValue: z.string().max(60_000), note: z.string().max(500).optional(), imageSrc: z.string().max(2000).optional() })
      .strict()
      .parse(req.body);
    return reply.status(201).send(await proposeChange(id, b));
  });
  // Internal link (from "Arquitectura" → Enlazado interno): same review flow as the other SEO edits.
  app.post('/api/v1/sites/:id/seo-edits/link', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ url: z.string().url(), targetUrl: z.string().url(), anchor: z.string().min(2).max(120), note: z.string().max(500).optional() }).strict().parse(req.body);
    return reply.status(201).send(await proposeInternalLink(id, b));
  });

  // WordPress helper plugins (mu-plugins) shipped with G.SEO, to download from the dashboard.
  const PLUGIN_FILES = new Set(['glitch-seo-meta.php', 'glitch-agents.php']);
  app.get('/api/v1/downloads/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().max(60) }).parse(req.params);
    if (!PLUGIN_FILES.has(file)) throw new ApiError(404, 'NOT_FOUND', 'Archivo no disponible.');
    const full = path.resolve(__dirname, '../../../docs/wordpress', file);
    return reply.header('content-type', 'application/x-php; charset=utf-8').header('content-disposition', `attachment; filename="${file}"`).send(await fs.promises.readFile(full, 'utf8'));
  });
  /** The G.SEO – SEO plugin as a .zip for Plugins → Add New → Upload Plugin. */
  app.get('/api/v1/downloads/plugin/gseo-seo.zip', async (_req, reply) => {
    const zip = zipFolder(path.resolve(__dirname, '../../../docs/wordpress/gseo-seo'), 'gseo-seo');
    return reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="gseo-seo.zip"').send(zip);
  });
  app.get('/api/v1/sites/:id/wordpress/seo-plugin', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return gseoPluginInfo(id);
  });
  app.post('/api/v1/sites/:id/wordpress/llms', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ llms: z.string().min(1).max(2_000_000), full: z.string().max(2_000_000).nullable().optional() }).strict().parse(req.body);
    await requireSite(id);
    return publishLlmsTxt(id, b, req.auth!.user.id);
  });

  // Agentes: navigation audit (Chrome) and the catalog for agents (agent.json + catalog + MCP in WordPress).
  app.get('/api/v1/sites/:id/agents/audit', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return latestAgentAudit(id);
  });
  app.post('/api/v1/sites/:id/agents/audit', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ urls: z.array(z.string().url()).max(15).optional() }).strict().parse(req.body ?? {});
    const site = await requireSite(id);
    if (!findBrowser()) throw new ApiError(400, 'BROWSER_NOT_FOUND', 'Esta revisión necesita Chrome, Chromium o Edge instalado en el servidor (o CHROME_PATH).');
    const audit = await startAgentAudit(id, b.urls);
    const job = await enqueue('agent-audit', { auditId: audit.id }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ auditId: audit.id, jobId: job.id });
  });
  const catalogItem = z.object({ id: z.string().max(80).default(''), kind: z.enum(['service', 'product']), name: z.string().min(1).max(200), description: z.string().max(1000).optional(), url: z.string().url().optional().or(z.literal('')), price: z.number().min(0).nullable().optional(), currency: z.string().max(10).optional(), priceText: z.string().max(100).optional(), availability: z.enum(['InStock', 'OutOfStock', 'PreOrder', 'OnRequest']).nullable().optional(), category: z.string().max(100).optional() });
  const catalogBusiness = z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), url: z.string().url(), email: z.string().max(200).optional(), phone: z.string().max(60).optional(), address: z.string().max(300).optional(), hours: z.string().max(300).optional(), areaServed: z.string().max(200).optional(), languages: z.array(z.string().max(20)).max(10).optional(), quoteUrl: z.string().url().optional().or(z.literal('')), bookingUrl: z.string().url().optional().or(z.literal('')), contactUrl: z.string().url().optional().or(z.literal('')) });
  app.get('/api/v1/sites/:id/agents/catalog', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const c = await getAgentCatalog(id);
    return { ...c, preview: buildAgentDocuments(c.business, c.items) };
  });
  app.put('/api/v1/sites/:id/agents/catalog', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ business: catalogBusiness, items: z.array(catalogItem).max(500) }).strict().parse(req.body);
    await requireSite(id);
    const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as T;
    return saveAgentCatalog(id, { business: clean(b.business) as never, items: b.items.map(i => clean(i)) as never }, req.auth!.user.id);
  });
  app.post('/api/v1/sites/:id/agents/catalog/publish', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return publishAgentCatalog(id, req.auth!.user.id);
  });
  app.get('/api/v1/sites/:id/agents/validate', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return validateAgentEndpoints(id);
  });

  // Experimentos SEO: before/after with a control group (Search Console).
  const experimentBody = z.object({
    name: z.string().min(1).max(200),
    hypothesis: z.string().max(2000).nullable().optional(),
    changeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    testUrls: z.array(z.string().url()).min(1).max(200),
    controlUrls: z.array(z.string().url()).max(200).optional(),
    windowDays: z.number().int().min(7).max(90).optional()
  });
  app.get('/api/v1/sites/:id/experiments', async req => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    return { gscReady: !!site.gscProperty, items: await listExperiments(id) };
  });
  app.post('/api/v1/sites/:id/experiments', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = experimentBody.strict().parse(req.body);
    await requireSite(id);
    return reply.status(201).send(await createExperiment(id, b, req.auth!.user.id));
  });
  app.patch('/api/v1/experiments/:id', async req => {
    const { id } = idParam.parse(req.params);
    const b = experimentBody.partial().extend({ notes: z.string().max(5000).nullable().optional() }).strict().parse(req.body);
    return updateExperiment(id, b, req.auth!.user.id);
  });
  app.delete('/api/v1/experiments/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await deleteExperiment(id, req.auth!.user.id);
    return reply.status(204).send();
  });
  app.post('/api/v1/experiments/:id/analyze', async req => {
    const { id } = idParam.parse(req.params);
    return runExperimentAnalysis(id);
  });

  // Brechas de contenido frente a competidores (SerpAPI + Search Console) y briefs.
  app.get('/api/v1/sites/:id/content-gaps', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const [latest, suggestions] = await Promise.all([latestContentGap(id), gapKeywordSuggestions(id)]);
    return { latest, suggestions };
  });
  app.post('/api/v1/sites/:id/content-gaps', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ competitors: z.array(z.string().min(3).max(200)).min(1).max(5), keywords: z.array(z.string().max(120)).min(1).max(100), expand: z.boolean().optional(), maxSearches: z.number().int().min(5).max(100).optional() }).strict().parse(req.body);
    const site = await requireSite(id);
    const gap = await startContentGap(id, b);
    const job = await enqueue('content-gap', { gapId: gap.id }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ gapId: gap.id, jobId: job.id });
  });
  app.post('/api/v1/content-gaps/:id/briefs', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ clusterId: z.string().max(20), useAi: z.boolean().default(false) }).strict().parse(req.body);
    return createGapBrief(id, b.clusterId, { useAi: b.useAi }, req.auth!.user.id);
  });

  // Backlinks: upload a CSV of external links, check each linking page in the background.
  app.get('/api/v1/sites/:id/backlinks', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ importId: z.string().uuid().optional() }).parse(req.query);
    await requireSite(id);
    return { imports: await listBacklinkImports(id), report: await backlinkReport(id, q) };
  });
  app.post('/api/v1/sites/:id/backlinks', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ fileName: z.string().min(1).max(200) }).parse(req.query);
    if (typeof req.body !== 'string') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envía el archivo como text/csv.');
    const site = await requireSite(id);
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'backlink-check', status: { in: [...ACTIVE] } } });
    if (active) throw new ApiError(409, 'BACKLINK_CHECK_RUNNING', 'Ya hay una revisión de backlinks en curso para este sitio.', { jobId: active.id });
    const imp = await importBacklinks(id, q.fileName, req.body);
    const job = await enqueue('backlink-check', { importId: imp.id }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ importId: imp.id, rows: imp.rows, format: imp.format, jobId: job.id });
  });

  // SERP & AI snapshot tracker (SerpAPI).
  app.get('/api/v1/sites/:id/serp', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return serpReport(id);
  });
  app.put('/api/v1/sites/:id/serp/config', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ enabled: z.boolean(), gl: z.string().regex(/^[a-zA-Z]{2}$/), hl: z.string().regex(/^[a-zA-Z]{2}(-[a-zA-Z]{2})?$/) }).strict().parse(req.body);
    await requireSite(id);
    return saveSerpConfig(id, b, req.auth!.user.id);
  });
  app.post('/api/v1/sites/:id/serp/keywords', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ keywords: z.array(z.string().max(120)).min(1).max(100) }).strict().parse(req.body);
    await requireSite(id);
    return addSerpKeywords(id, b.keywords);
  });
  app.get('/api/v1/sites/:id/serp/suggestions', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return suggestSerpKeywords(id);
  });
  app.delete('/api/v1/sites/:id/serp/keywords/:keywordId', async req => {
    const p = z.object({ id: z.string().uuid(), keywordId: z.string().uuid() }).parse(req.params);
    await requireSite(p.id);
    return removeSerpKeyword(p.id, p.keywordId);
  });
  app.post('/api/v1/sites/:id/serp/run', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const site = await requireSite(id);
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'serp-check', status: { in: [...ACTIVE] } } });
    if (active) throw new ApiError(409, 'SERP_CHECK_RUNNING', 'Ya hay una revisión de SERP en curso.', { jobId: active.id });
    const job = await enqueue('serp-check', { siteId: id }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ jobId: job.id });
  });

  // Entidades y E-E-A-T: Organization + authors + per-page entities → one connected JSON-LD graph.
  const entityRef = z.object({ label: z.string().min(1).max(200), qid: z.string().regex(/^Q\d+$/).optional(), wikipedia: z.string().url().optional() });
  const urlList = z.array(z.string().url().max(500)).max(30);
  app.get('/api/v1/sites/:id/entities', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return { org: await getEntityOrg(id), authors: await listEntityAuthors(id), types: ENTITY_PAGE_TYPES };
  });
  app.put('/api/v1/sites/:id/entities/org', async req => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        name: z.string().min(1).max(200),
        legalName: z.string().max(200).optional(),
        type: z.string().regex(/^[A-Za-z]+$/).max(60).optional(),
        url: z.string().url(),
        logo: z.string().url().optional().or(z.literal('')),
        description: z.string().max(2000).optional(),
        email: z.string().max(200).optional(),
        telephone: z.string().max(60).optional(),
        address: z.object({ streetAddress: z.string().max(200).optional(), addressLocality: z.string().max(100).optional(), addressRegion: z.string().max(100).optional(), postalCode: z.string().max(20).optional(), addressCountry: z.string().max(60).optional() }).optional(),
        foundingDate: z.string().max(20).optional(),
        sameAs: urlList.optional()
      })
      .strict()
      .parse(req.body);
    await requireSite(id);
    return saveEntityOrg(id, { ...b, logo: b.logo || undefined }, req.auth!.user.id);
  });
  const authorBody = z.object({ name: z.string().min(1).max(120), url: z.string().url().nullable().optional().or(z.literal('')), jobTitle: z.string().max(120).nullable().optional(), description: z.string().max(3000).nullable().optional(), image: z.string().url().nullable().optional().or(z.literal('')), sameAs: urlList.optional(), knowsAbout: z.array(z.string().max(120)).max(30).optional() }).strict();
  app.post('/api/v1/sites/:id/entities/authors', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = authorBody.parse(req.body);
    await requireSite(id);
    return reply.status(201).send(await saveEntityAuthor(id, b));
  });
  app.put('/api/v1/sites/:id/entities/authors/:authorId', async req => {
    const p = z.object({ id: z.string().uuid(), authorId: z.string().uuid() }).parse(req.params);
    const b = authorBody.parse(req.body);
    await requireSite(p.id);
    return saveEntityAuthor(p.id, { ...b, id: p.authorId });
  });
  app.delete('/api/v1/sites/:id/entities/authors/:authorId', async req => {
    const p = z.object({ id: z.string().uuid(), authorId: z.string().uuid() }).parse(req.params);
    await requireSite(p.id);
    return deleteEntityAuthor(p.id, p.authorId);
  });
  app.get('/api/v1/sites/:id/entities/pages', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listEntityPages(id);
  });
  app.put('/api/v1/sites/:id/entities/pages', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ url: z.string().url(), type: z.enum(ENTITY_PAGE_TYPES), authorId: z.string().uuid().nullable().optional(), about: z.array(entityRef).max(10).optional(), mentions: z.array(entityRef).max(20).optional(), datePublished: z.string().max(30).nullable().optional() }).strict().parse(req.body);
    await requireSite(id);
    return saveEntityPage(id, b);
  });
  app.get('/api/v1/sites/:id/entities/graph', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ url: z.string().url() }).parse(req.query);
    await requireSite(id);
    return entityGraphFor(id, q.url);
  });
  app.get('/api/v1/sites/:id/entities/suggest', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ url: z.string().url() }).parse(req.query);
    await requireSite(id);
    return suggestPageEntities(id, q.url);
  });
  app.get('/api/v1/wikidata/search', async req => {
    const q = z.object({ q: z.string().min(1).max(120), lang: z.enum(['es', 'en', 'pt', 'fr']).default('es') }).parse(req.query);
    return searchWikidata(q.q, q.lang);
  });
  app.get('/api/v1/sites/:id/entities/eeat', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return eeatAudit(id);
  });

  // Consolidación: merge two competing pages, 301 the other one, revert if needed.
  app.get('/api/v1/sites/:id/consolidations', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return { items: await listConsolidations(id), candidates: await consolidationCandidates(id) };
  });
  app.post('/api/v1/sites/:id/consolidations', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ a: z.string().url(), b: z.string().url(), winnerUrl: z.string().url().optional(), queries: z.array(z.string().max(200)).max(30).optional() }).strict().parse(req.body);
    await requireSite(id);
    return reply.status(201).send(await createConsolidation(id, b));
  });
  const cId = z.object({ id: z.string().uuid() });
  app.get('/api/v1/consolidations/:id', async req => getConsolidation(cId.parse(req.params).id));
  app.post('/api/v1/consolidations/:id/draft-ai', async req => aiDraft(cId.parse(req.params).id, req.auth!.user.id));
  app.post('/api/v1/consolidations/:id/draft-manual', async req => manualDraft(cId.parse(req.params).id));
  app.put('/api/v1/consolidations/:id/draft', async req => saveDraft(cId.parse(req.params).id, z.object({ title: z.string().max(200).optional(), html: z.string().max(300_000).optional(), winnerUrl: z.string().url().optional() }).strict().parse(req.body)));
  app.post('/api/v1/consolidations/:id/approve', async req => approveConsolidation(cId.parse(req.params).id));
  app.post('/api/v1/consolidations/:id/apply', async req => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    return applyConsolidation(cId.parse(req.params).id);
  });
  app.post('/api/v1/consolidations/:id/revert', async req => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    return revertConsolidation(cId.parse(req.params).id);
  });
  app.delete('/api/v1/consolidations/:id', async req => discardConsolidation(cId.parse(req.params).id));

  // Arquitectura: internal link graph, link suggestions, 301 map and rendering audit.
  const runQuery = z.object({ crawlRunId: z.string().uuid().optional() });
  app.get('/api/v1/sites/:id/architecture/links', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return internalLinkReport(id, runQuery.parse(req.query));
  });
  app.get('/api/v1/sites/:id/architecture/link-suggestions', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ crawlRunId: z.string().uuid().optional(), targetUrl: z.string().url().optional() }).parse(req.query);
    await requireSite(id);
    return internalLinkSuggestions(id, q);
  });
  app.get('/api/v1/sites/:id/architecture/redirects', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return redirectSuggestions(id, runQuery.parse(req.query));
  });
  app.post('/api/v1/sites/:id/architecture/redirects/wordpress', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ rules: z.array(z.object({ from: z.string().min(1).max(2000), to: z.string().url() })).min(1).max(500) }).strict().parse(req.body);
    await requireSite(id);
    return pushRedirectsToWordPress(id, b.rules, req.auth!.user.id);
  });
  app.get('/api/v1/sites/:id/architecture/render', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return renderReport(id, runQuery.parse(req.query));
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

  /** CrUX field data (real Chrome users): weekly history for the origin and, optionally, one URL. Cached 12 h. */
  const cruxCache = new Map<string, { at: number; value: CruxHistory | null }>();
  const crux = async (target: { url: string } | { origin: string }, formFactor: 'PHONE' | 'DESKTOP' | 'ALL') => {
    const k = `${JSON.stringify(target)}|${formFactor}`;
    const hit = cruxCache.get(k);
    if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value;
    try {
      const value = await fetchCruxHistory(target, { formFactor });
      if (cruxCache.size > 500) cruxCache.clear();
      cruxCache.set(k, { at: Date.now(), value });
      return value;
    } catch (e) {
      if (e instanceof CruxError) throw new ApiError(e.status === 400 ? 400 : 502, 'CRUX_ERROR', e.message);
      throw e;
    }
  };
  app.get('/api/v1/sites/:id/crux', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ url: z.string().url().optional(), formFactor: z.enum(['PHONE', 'DESKTOP', 'ALL']).default('PHONE') }).parse(req.query);
    const site = await requireSite(id);
    const configured = !!(process.env.CRUX_API_KEY ?? process.env.PSI_API_KEY);
    if (!configured) return { configured, origin: null, url: null };
    const home = new URL(site.canonicalUrl);
    if (q.url && new URL(q.url).hostname !== home.hostname) throw new ApiError(400, 'FOREIGN_URL', `Only URLs of ${home.hostname} can be queried`);
    const [origin, url] = await Promise.all([crux({ origin: home.origin }, q.formFactor), q.url ? crux({ url: q.url }, q.formFactor) : null]);
    return { configured, origin, url };
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

  app.get('/api/v1/crawls/:id/diff', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { base, type, q, format } = z.object({ base: z.string().uuid().optional(), type: z.string().max(40).optional(), q: z.string().max(200).optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const run = await prisma.crawlRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'CRAWL_NOT_FOUND', `Crawl ${id} not found`);
    const diff = await getCrawlDiff(id, base);
    if (!diff) throw new ApiError(404, 'NO_BASELINE', 'There is no earlier completed crawl to compare with');
    const needle = q?.toLowerCase();
    const changes = diff.changes.filter(c => (!type || c.type === type) && (!needle || c.url.toLowerCase().includes(needle)));
    if (format === 'csv') {
      const cell = (v: unknown) => {
        const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' | ') : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = ['url,cambio,antes,despues', ...changes.map(c => [c.url, c.type, c.before, c.after].map(cell).join(','))].join('\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="cambios-${id.slice(0, 8)}.csv"`).send('\ufeff' + csv);
    }
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

  // ------------------------------------------------------------------ Client reports
  const sectionEnum = z.enum(Object.keys(REPORT_SECTIONS) as [string, ...string[]]);
  app.get('/api/v1/reports/sections', async () => REPORT_SECTIONS);
  app.get('/api/v1/sites/:id/reports', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return listReports(id);
  });
  app.post('/api/v1/sites/:id/reports', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    const b = z.object({ title: z.string().max(200).default(''), sections: z.array(sectionEnum).min(1).max(6), expiresDays: z.number().int().min(1).max(365).nullable().default(90) }).strict().parse(req.body);
    return reply.status(201).send(await createReport(id, b as Parameters<typeof createReport>[1], req.auth!.user.id));
  });
  const requireReport = async (id: string) => {
    const r = await prisma.reportShare.findUnique({ where: { id } });
    if (!r) throw new ApiError(404, 'NOT_FOUND', 'Reporte no encontrado');
    return r;
  };
  app.delete('/api/v1/reports/:id', async req => {
    const { id } = idParam.parse(req.params);
    await requireReport(id);
    return revokeReport(id, req.auth!.user.id);
  });
  /** PDF of a report, printed by Chrome from the public page of our own web app. */
  app.get('/api/v1/reports/:id/pdf', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await requireReport(id);
    if (r.revokedAt) throw new ApiError(400, 'REPORT_REVOKED', 'Este reporte fue retirado.');
    const pdf = await renderPdf(`${webOrigin()}/r/${r.token}?print=1`);
    const safe = r.title.normalize('NFD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'reporte';
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${safe}.pdf"`).send(pdf);
  });
  /** Public (no login): the client's link. Only live reports; never internal data. */
  app.get('/api/v1/public/reports/:token', async req => {
    const { token } = z.object({ token: z.string().min(20).max(64).regex(/^[\w-]+$/) }).parse(req.params);
    return publicReport(token);
  });

  // ------------------------------------------------------------------ Schema.org generator
  app.get('/api/v1/schema/catalog', async () => CATALOG);
  /** Full report: per node, Google-required fields (errors), recommended fields (warnings), formats. */
  app.post('/api/v1/schema/validate', async req => {
    const body = req.body;
    return validateSchema(typeof body === 'string' ? body : (body ?? {}) as object);
  });
  /** Reads any public page and proposes forms from what it already says. */
  app.post('/api/v1/schema/prefill', async req => {
    const { url } = z.object({ url: z.string().url().max(2000) }).strict().parse(req.body);
    const allowHosts = (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const r = await fetchWithRedirects(url, { userAgent: 'GlitchSeoOpsBot/0.2 (schema generator)', timeoutMs: 15_000, allowHosts, maxBodyBytes: 3 * 1024 * 1024 });
    if (r.error && !r.body) throw new ApiError(400, 'FETCH_FAILED', `No se pudo leer la página: ${r.error}`);
    if (!r.body) throw new ApiError(400, 'NOT_HTML', `La página respondió ${r.status} sin HTML.`);
    if (r.status >= 400) throw new ApiError(400, 'HTTP_ERROR', `La página respondió ${r.status}.`);
    const hints = extractPageHints(r.body, r.finalUrl);
    return { finalUrl: r.finalUrl, hints, suggestions: suggestSchemaForms(hints) };
  });
  const schemaTemplateBody = z.object({ name: z.string().trim().min(1).max(120), forms: z.array(z.record(z.unknown())).min(1).max(20) }).strict();
  app.get('/api/v1/schema-templates', async req => prisma.schemaTemplate.findMany({ where: { workspaceId: req.auth!.workspaceId }, orderBy: { updatedAt: 'desc' } }));
  app.post('/api/v1/schema-templates', async (req, reply) => {
    const b = schemaTemplateBody.parse(req.body);
    const t = await prisma.schemaTemplate.create({ data: { workspaceId: req.auth!.workspaceId, name: b.name, forms: b.forms as Prisma.InputJsonValue, createdById: req.auth!.user.id } });
    return reply.status(201).send(t);
  });
  const requireTemplate = async (id: string, workspaceId: string) => {
    const t = await prisma.schemaTemplate.findFirst({ where: { id, workspaceId } });
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Plantilla no encontrada');
    return t;
  };
  app.put('/api/v1/schema-templates/:id', async req => {
    const { id } = idParam.parse(req.params);
    await requireTemplate(id, req.auth!.workspaceId);
    const b = schemaTemplateBody.parse(req.body);
    return prisma.schemaTemplate.update({ where: { id }, data: { name: b.name, forms: b.forms as Prisma.InputJsonValue } });
  });
  app.delete('/api/v1/schema-templates/:id', async req => {
    const { id } = idParam.parse(req.params);
    await requireTemplate(id, req.auth!.workspaceId);
    await prisma.schemaTemplate.delete({ where: { id } });
    return { deleted: true };
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
  app.get('/api/v1/gsc/oauth/start', async (req, reply) => {
    const q = z.object({ back: z.enum(['gsc', 'ga4']).optional() }).parse(req.query);
    return reply.redirect(gscAuthUrl(req.auth!.workspaceId, req.auth!.user.id, q.back));
  });
  app.get('/api/v1/gsc/oauth/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    let nav = 'gsc';
    const back = (params: Record<string, string>) => reply.redirect(`${webOrigin()}/?${new URLSearchParams({ nav, ...params })}`);
    if (q.error || !q.code || !q.state) return back({ gsc: 'error', message: q.error === 'access_denied' ? 'Cancelaste el permiso en Google.' : `Google respondió: ${q.error ?? 'sin código'}` });
    try {
      nav = (await gscFinishOAuth({ code: q.code, state: q.state })).back;
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
  // Google Analytics 4 (same Google account as Search Console).
  app.get('/api/v1/ga4/status', async req => ga4Status(req.auth!.workspaceId));
  app.get('/api/v1/ga4/properties', async req => ga4Properties(req.auth!.workspaceId));
  app.put('/api/v1/sites/:id/ga4', async req => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ property: z.string().regex(/^properties\/\d+$/).nullable() }).strict().parse(req.body);
    await requireSite(id);
    return setSiteGa4Property(id, b.property, req.auth!.user.id);
  });
  app.post('/api/v1/sites/:id/ga4/import', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ days: z.number().int().min(7).max(480).default(90) }).parse(req.body ?? {});
    const site = await requireSite(id);
    if (!site.ga4Property) throw new ApiError(400, 'GA4_NO_PROPERTY', 'Elige la propiedad de Google Analytics de este sitio.');
    const active = await prisma.job.findFirst({ where: { siteId: id, type: 'ga4-import', status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } });
    if (active) throw new ApiError(409, 'GA4_IMPORT_RUNNING', 'Ya hay una importación de Analytics en curso para este sitio.', { jobId: active.id });
    const job = await enqueue('ga4-import', { siteId: id, days: b.days }, { siteId: id, workspaceId: site.workspaceId });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });
  app.get('/api/v1/sites/:id/ga4/report', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return ga4Report(id);
  });

  app.get('/api/v1/sites/:id/gsc/cannibalization', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ minImpressions: z.coerce.number().int().min(1).max(100000).optional(), minShare: z.coerce.number().min(1).max(50).optional() }).parse(req.query);
    await requireSite(id);
    return cannibalizationReport(id, { minImpressions: q.minImpressions, minShare: q.minShare ? q.minShare / 100 : undefined });
  });

  // Análisis de contenido: duplicates and thin pages (crawl), declining pages (monthly GSC), keyword topics (GSC).
  app.get('/api/v1/sites/:id/content/duplicates', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ crawlRunId: z.string().uuid().optional(), threshold: z.coerce.number().int().min(50).max(99).optional(), minWords: z.coerce.number().int().min(10).max(5000).optional() }).parse(req.query);
    await requireSite(id);
    return duplicateContentReport(id, { crawlRunId: q.crawlRunId, threshold: q.threshold ? q.threshold / 100 : undefined, minWords: q.minWords });
  });
  app.get('/api/v1/sites/:id/content/declining', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ minClicks: z.coerce.number().int().min(1).max(1_000_000).optional(), minDrop: z.coerce.number().int().min(5).max(95).optional() }).parse(req.query);
    await requireSite(id);
    return decliningContentReport(id, { minClicks: q.minClicks, minDrop: q.minDrop ? q.minDrop / 100 : undefined });
  });
  app.get('/api/v1/sites/:id/content/topics', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return keywordTopicsReport(id);
  });

  // llms.txt: validate the live file and generate one from the crawl.
  app.get('/api/v1/sites/:id/llms-txt', async req => {
    const { id } = idParam.parse(req.params);
    await requireSite(id);
    return validateSiteLlmsTxt(id);
  });
  app.get('/api/v1/sites/:id/llms-txt/generate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z
      .object({
        crawlRunId: z.string().uuid().optional(),
        perSection: z.coerce.number().int().min(1).max(200).optional(),
        maxLinks: z.coerce.number().int().min(5).max(2000).optional(),
        fullPages: z.coerce.number().int().min(1).max(200).optional(),
        summary: z.string().max(500).optional(),
        download: z.enum(['llms', 'full']).optional()
      })
      .parse(req.query);
    await requireSite(id);
    const g = await generateSiteLlmsTxt(id, { crawlRunId: q.crawlRunId, perSection: q.perSection, maxLinks: q.maxLinks, summary: q.summary || null, full: q.download === 'full' || !!q.fullPages, fullPages: q.fullPages });
    if (q.download) {
      const name = q.download === 'full' ? 'llms-full.txt' : 'llms.txt';
      return reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(q.download === 'full' ? g.full?.text ?? '' : g.text);
    }
    return { ...g, full: g.full ? { pages: g.full.pages, truncated: g.full.truncated, bytes: Buffer.byteLength(g.full.text, 'utf8'), preview: g.full.text.slice(0, 20_000) } : null };
  });

  // "Listo para IA": per-page AI readiness of a crawl, plus robots.txt access for AI bots and llms.txt.
  app.get('/api/v1/sites/:id/ai-readiness', async req => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ crawlRunId: z.string().uuid().optional() }).parse(req.query);
    await requireSite(id);
    return aiReadinessReport(id, { crawlRunId: q.crawlRunId });
  });

  return app;
}
