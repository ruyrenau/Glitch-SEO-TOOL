export interface Site {
  id: string;
  name: string;
  domain: string;
  canonicalUrl: string;
  environment: 'production' | 'staging' | 'development';
  status: string;
  sitemapUrl: string | null;
  lastLogImportAt: string | null;
  lastAuditAt: string | null;
  _count: { logImports: number; sitemapUrls: number; issues: number };
}

export interface AuditEvent {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { email: string; name: string } | null;
}

export interface SiteOverview {
  site: { id: string; name: string; domain: string; environment: string; isDemo: boolean };
  logs: {
    importId: string;
    fileName: string;
    period: { start: string | null; end: string | null };
    requests: number;
    googlebotRequests: number;
    aiBotRequests: number;
    crawledUrls: number;
  } | null;
  importCount: number;
  sitemapUrls: number;
  openIssuesBySeverity: Record<string, number>;
  recentEvents: AuditEvent[];
  openAlerts: Alert[];
  openAlertsCount: number;
  latestCrawl: { id: string; startedAt: string; urlsCrawled: number; issuesFound: number } | null;
}

export interface LogImport {
  id: string;
  fileName: string;
  status: string;
  totalLines: number;
  validLines: number;
  invalidLines: number;
  fileSizeBytes: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

export interface UrlHits {
  path: string;
  hits: number;
}

export interface LogReport {
  import: {
    id: string;
    fileName: string;
    createdAt: string;
    startDate: string | null;
    endDate: string | null;
    totalLines: number;
    validLines: number;
    invalidLines: number;
    skippedLines: number;
    errorSamples: string[];
  };
  totals: { requests: number; botRequests: number; googlebotRequests: number; aiBotRequests: number; uniqueBotUrls: number };
  statusDistribution: Record<string, number>;
  botDistribution: Record<string, number>;
  botVerification: Record<string, { claimedHits: number; verifiedHits: number; spoofedHits: number; errorHits: number; uncheckedHits: number; ipsChecked: number }> | null;
  hourlyBotHits: number[];
  responseTime: { p50: number | null; p90: number | null; p99: number | null; samples: number };
  aiReferrals: Record<string, number>;
  aiBots: Record<string, number>;
  crawledParameters: Record<string, number>;
  botHitsByDay: Array<{ date: string; hits: number }>;
  botHitsByDirectory: UrlHits[];
  topBotUrls: UrlHits[];
  leastCrawledBotUrls: UrlHits[];
  bot4xx: UrlHits[];
  bot5xx: UrlHits[];
  botRedirects: UrlHits[];
  botParameterUrls: UrlHits[];
  crawlWaste: { label: string; hits: number; share: number };
  sitemapCoverage: {
    sitemapUrls: number;
    crawledByGooglebot: number;
    neverCrawledByGooglebot: string[];
    neverCrawledCount: number;
    crawledNotInSitemap: UrlHits[];
    crawledNotInSitemapCount: number;
  } | null;
  dataQuality: { aggregatesTruncated: boolean; responseTimeAvailable: boolean };
}

export interface CrawlRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  urlsCrawled: number;
  urlsDiscovered: number;
  issuesFound: number;
  maxDepth: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  config: { robots?: { found: boolean; status: number | null; sitemaps: string[]; crawlDelay: number | null }; limitReached?: boolean; maxUrls?: number } | null;
  progress: { crawled: number; queued: number; current: string } | null;
}

export interface CrawledPage {
  id: string;
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  title: string | null;
  canonical: string | null;
  h1Count: number;
  wordCount: number;
  depth: number;
  inlinks: number;
  isIndexable: boolean;
  indexabilityReason: string | null;
  inSitemap: boolean;
  inLogs: boolean;
  blockedByRobots: boolean;
  error: string | null;
  schemaTypes: string[] | null;
}

export interface Issue {
  id: string;
  code: string;
  category: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  impact: number;
  effort: number;
  risk: number;
  confidence: number;
  priorityScore: number;
  affectedUrlsCount: number;
  affectedUrls: string[] | null;
  evidence: Record<string, unknown> | null;
  recommendation: string;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface Alert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  message: string;
  urls: string[] | null;
  details: Record<string, unknown> | null;
  status: 'open' | 'acknowledged';
  deliveredTo: Array<{ channel: string; ok: boolean; status?: number; error?: string }> | null;
  crawlRunId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface PageChange {
  type: string;
  url: string;
  before: unknown;
  after: unknown;
}

export interface CrawlDiff {
  base: { id: string; startedAt: string; urlsCrawled: number };
  target: { id: string; startedAt: string; urlsCrawled: number };
  counts: Record<string, number>;
  changes: PageChange[];
  totalChanges: number;
  removalsReliable: boolean;
}

export interface WpConnection {
  id: string;
  endpointUrl: string;
  username: string;
  appPassword: string; // masked
  status: 'untested' | 'ok' | 'error';
  remoteName: string | null;
  lastTestAt: string | null;
  lastError: string | null;
}

export interface Publication {
  id: string;
  action: 'dry_run' | 'create' | 'update';
  result: 'success' | 'failed' | 'conflict' | 'refused';
  wpPostId: number | null;
  wpLink: string | null;
  error: string | null;
  createdAt: string;
}

export interface GeneratedPage {
  id: string;
  slug: string;
  title: string;
  metaDescription: string;
  content: string;
  sourceData: Record<string, string | number | boolean> | null;
  status: 'BLOCKED' | 'NEEDS_REVIEW' | 'READY_FOR_APPROVAL' | 'APPROVED' | 'SENT_AS_DRAFT' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';
  similarityScore: number;
  qualityChecks: { issues: string[]; mostSimilar: string | null } | null;
  publishedWpPostId: number | null;
  wpLink: string | null;
  createdAt: string;
  approvals: Array<{ reviewer: string; action: string; notes: string | null; createdAt: string }>;
  publications: Publication[];
}

export interface DiffLine {
  op: 'same' | 'add' | 'remove';
  text: string;
}

export interface DryRun {
  action: 'create' | 'update';
  payload: { title: string; slug: string; excerpt?: string; status: 'draft' };
  diff: { title: { before: string; after: string } | null; slug: { before: string; after: string } | null; content: DiffLine[]; changed: boolean };
  warnings: string[];
  remote: { id: number; status: string; modified_gmt: string; link: string } | null;
}

export type Role = 'OWNER' | 'ADMIN' | 'SEO_MANAGER' | 'EDITOR' | 'VIEWER';
export type Permission = 'read' | 'content:edit' | 'wordpress:send' | 'seo:operate' | 'site:manage' | 'users:manage';

export interface User {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: Role;
  roleLabel: string;
  mustChangePassword: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  permissions: Permission[];
}

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RETRYING';

export interface JobRow {
  id: string;
  type: 'log-import' | 'crawl' | 'retention' | string;
  queue: string;
  status: JobStatus;
  siteId: string | null;
  trigger: 'manual' | 'schedule' | 'system' | string;
  progress: number;
  progressDetail: { lines?: number; crawled?: number; queued?: number; current?: string; crawlRunId?: string } | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: Array<{ at: string; level: string; msg: string }> | null;
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
  retryOfId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export const ACTIVE_JOB: JobStatus[] = ['QUEUED', 'RUNNING', 'RETRYING'];
