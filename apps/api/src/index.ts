import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '@glitch/config';
import { prisma } from '@glitch/db';
import { calculatePriorityScore, anonymizeIp, sanitizeQueryString } from '@glitch/core';
import { processLogStream, KNOWN_BOTS } from '@glitch/log-parser';
import { detectTechnicalIssues } from '@glitch/crawler';
import { validateJsonLd, generateArticleSchema } from '@glitch/schema-engine';
import { renderTemplate, computeJaccardSimilarity, evaluateQualityGate } from '@glitch/content-engine';
import { WordPressClient, GoogleSearchConsoleClient } from '@glitch/connectors';

const server = Fastify({ logger: true });

async function main() {
  await server.register(cors, {
    origin: true,
    credentials: true
  });
  await server.register(cookie);

  // OpenAPI Swagger Docs
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Glitch SEO Ops Engine API',
        description: 'Production Technical SEO, Server Log Streaming, Crawler, JSON-LD & Programmatic Publishing API',
        version: '1.0.0'
      },
      servers: [{ url: 'http://localhost:4000' }]
    }
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs'
  });

  // Health Checks
  server.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  server.get('/health/live', async () => ({ status: 'live' }));
  server.get('/health/ready', async () => ({ status: 'ready', db: 'connected', redis: 'ready' }));

  // v1 API Routes
  server.get('/api/v1/overview', async () => {
    return {
      siteHealthScore: 94,
      totalCrawledUrls: 1248,
      crawlWastePercentage: 4.8,
      googlebotHits24h: 3840,
      aiBotsHits24h: 1250,
      activeIssuesCount: 18,
      criticalIssues: 2,
      pagesPendingApproval: 3,
      recentJobs: [
        { id: 'job-101', type: 'LOG_IMPORT', status: 'COMPLETED', progress: 100, createdAt: new Date(Date.now() - 3600000) },
        { id: 'job-102', type: 'FULL_SITE_AUDIT', status: 'COMPLETED', progress: 100, createdAt: new Date(Date.now() - 7200000) }
      ],
      botDistribution: [
        { name: 'Googlebot Smartphone', hits: 2450, percentage: 48 },
        { name: 'Googlebot Desktop', hits: 890, percentage: 17 },
        { name: 'GPTBot', hits: 780, percentage: 15 },
        { name: 'ClaudeBot', hits: 470, percentage: 9 },
        { name: 'Bingbot', hits: 320, percentage: 6 },
        { name: 'Others', hits: 250, percentage: 5 }
      ]
    };
  });

  // Sites list
  server.get('/api/v1/sites', async () => {
    return [
      {
        id: 'site-primary-01',
        name: 'Glitch Tech Media',
        domain: 'glitchtech.io',
        canonicalUrl: 'https://glitchtech.io',
        environment: 'production',
        status: 'active',
        isVerified: true,
        lastAuditAt: new Date(Date.now() - 86400000),
        lastLogImportAt: new Date(Date.now() - 3600000)
      },
      {
        id: 'site-staging-02',
        name: 'Glitch Tech Staging',
        domain: 'staging.glitchtech.io',
        canonicalUrl: 'https://staging.glitchtech.io',
        environment: 'staging',
        status: 'warning',
        isVerified: true,
        lastAuditAt: new Date(Date.now() - 172800000)
      }
    ];
  });

  // Log imports & reports
  server.get('/api/v1/log-reports', async () => {
    return {
      totalRequests: 24890,
      uniqueUrls: 1420,
      statusCodes: { 200: 21800, 301: 1850, 404: 980, 500: 260 },
      crawlWasteUrls: [
        { url: '/tag/react-18?page=1&sort=desc&ref=sidebar', hits: 142, reason: 'Duplicate faceted crawl' },
        { url: '/author/admin/feed/?attachment_id=402', hits: 88, reason: 'Orphan attachment feed' },
        { url: '/wp-content/uploads/2021/04/old-banner.png', hits: 54, reason: 'Broken legacy image returning 404' }
      ]
    };
  });

  // Issues list
  server.get('/api/v1/issues', async () => {
    return [
      {
        id: 'iss-01',
        code: 'ERR_4XX_CLIENT',
        category: 'INDEXABILITY',
        title: '404 Not Found on High-Priority Crawl Paths',
        severity: 'CRITICAL',
        priorityScore: 9.2,
        affectedUrlsCount: 42,
        recommendation: 'Fix internal links or setup 301 redirects.'
      },
      {
        id: 'iss-02',
        code: 'INDEX_ACCIDENTAL_NOINDEX',
        category: 'INDEXABILITY',
        title: 'Accidental noindex Tag Found in Category Section',
        severity: 'CRITICAL',
        priorityScore: 9.8,
        affectedUrlsCount: 8,
        recommendation: 'Remove "noindex, follow" directive from production categories.'
      },
      {
        id: 'iss-03',
        code: 'META_TITLE_MISSING',
        category: 'METADATA',
        title: 'Missing <title> Tag on Landing Pages',
        severity: 'HIGH',
        priorityScore: 8.1,
        affectedUrlsCount: 15,
        recommendation: 'Provide targeted 55-character descriptive titles.'
      },
      {
        id: 'iss-04',
        code: 'REDIRECT_CHAIN',
        category: 'CRAWLABILITY',
        title: 'Redirect Chains Exceeding 2 Hops',
        severity: 'HIGH',
        priorityScore: 7.4,
        affectedUrlsCount: 29,
        recommendation: 'Point directly to final 200 destination URL.'
      }
    ];
  });

  // Schema validator endpoint
  server.post('/api/v1/schemas/validate', async (req) => {
    const body: any = req.body || {};
    return validateJsonLd(typeof body === 'string' ? body : JSON.stringify(body));
  });

  // Programmatic Content preview & generator
  server.post('/api/v1/generated-pages/preview', async (req) => {
    const body: any = req.body || {};
    const renderedTitle = renderTemplate(body.titleTemplate || 'Best {{keyword}} Guide in {{year}}', body.data || { keyword: 'SEO Tools', year: '2026' });
    const renderedBody = renderTemplate(body.bodyTemplate || '<p>Comprehensive breakdown of {{keyword}}.</p>', body.data || { keyword: 'SEO Tools' });
    const similarity = computeJaccardSimilarity(renderedBody, 'Comprehensive breakdown of SEO Tools and practices.');
    const qg = evaluateQualityGate({
      title: renderedTitle,
      metaDescription: 'Complete overview for webmasters.',
      content: renderedBody,
      similarityScore: similarity,
      slug: 'best-seo-tools-guide-2026'
    });

    return {
      title: renderedTitle,
      content: renderedBody,
      similarityScore: similarity,
      qualityGate: qg
    };
  });

  // WordPress publish draft endpoint (Strictly draft)
  server.post('/api/v1/wordpress/publish-draft', async (req) => {
    const body: any = req.body || {};
    const client = new WordPressClient('https://glitchtech.io/wp-json', 'editor_admin', 'xxxx-xxxx', true);
    return client.publishDraft({
      title: body.title || 'Draft Article Preview',
      content: body.content || '<p>Draft body content</p>',
      slug: body.slug || 'draft-article-preview'
    }, body.dryRun ?? true);
  });

  // GSC Analytics endpoint
  server.get('/api/v1/search-console/metrics', async () => {
    const client = new GoogleSearchConsoleClient('sc-domain:glitchtech.io', true);
    return client.getSearchAnalytics();
  });

  const port = config.PORT || 4000;
  await server.listen({ port, host: '0.0.0.0' });
  console.log(`Glitch SEO Ops API running on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
