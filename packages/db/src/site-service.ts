import { prisma } from './client';
import { recordAuditEvent } from './audit';

export interface CreateSiteInput {
  workspaceId?: string;
  name: string;
  domain: string;
  canonicalUrl: string;
  environment?: 'production' | 'staging' | 'development';
  sitemapUrl?: string | null;
  language?: string;
  targetCountry?: string;
  timezone?: string;
}

/** Until auth lands, requests without a workspace fall back to the first workspace. */
export async function resolveWorkspaceId(workspaceId?: string): Promise<string> {
  if (workspaceId) return workspaceId;
  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  if (ws) return ws.id;
  const created = await prisma.workspace.create({ data: { name: 'Default Workspace', slug: 'default' } });
  return created.id;
}

export async function listSites(workspaceId?: string, includeArchived = false) {
  return prisma.site.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}), ...(includeArchived ? {} : { NOT: { status: 'archived' } }) },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { logImports: true, sitemapUrls: true, issues: true } } }
  });
}

export async function createSite(input: CreateSiteInput, actorUserId?: string | null) {
  const workspaceId = await resolveWorkspaceId(input.workspaceId);
  const canonical = new URL(input.canonicalUrl);
  const site = await prisma.site.create({
    data: {
      workspaceId,
      name: input.name,
      domain: input.domain.toLowerCase(),
      canonicalUrl: canonical.origin,
      environment: input.environment ?? 'production',
      sitemapUrl: input.sitemapUrl ?? `${canonical.origin}/sitemap.xml`,
      robotsUrl: `${canonical.origin}/robots.txt`,
      language: input.language ?? 'en',
      targetCountry: input.targetCountry ?? 'US',
      timezone: input.timezone ?? 'UTC'
    }
  });
  await recordAuditEvent({ workspaceId, userId: actorUserId ?? null, action: 'site.created', entity: 'Site', entityId: site.id, details: { domain: site.domain } });
  return site;
}

export async function setSiteArchived(siteId: string, archived: boolean, actorUserId?: string | null) {
  const site = await prisma.site.update({ where: { id: siteId }, data: { status: archived ? 'archived' : 'active' } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId ?? null, action: archived ? 'site.archived' : 'site.restored', entity: 'Site', entityId: siteId });
  return site;
}

export async function listLogImports(siteId: string) {
  const rows = await prisma.logImport.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' } });
  return rows.map(r => ({ ...r, fileSizeBytes: Number(r.fileSizeBytes) }));
}

/** Overview numbers for a site, all derived from stored data. null fields mean "no data yet". */
export async function getSiteOverview(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return null;
  const [latestImport, importCount, sitemapUrls, openIssues, recentEvents, openAlerts, latestCrawl] = await Promise.all([
    prisma.logImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } }),
    prisma.logImport.count({ where: { siteId } }),
    prisma.sitemapUrl.count({ where: { siteId } }),
    prisma.issue.groupBy({ by: ['severity'], where: { siteId, status: 'open' }, _count: true }),
    prisma.auditEvent.findMany({ where: { workspaceId: site.workspaceId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.alert.findMany({ where: { siteId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } })
  ]);
  return {
    site: { id: site.id, name: site.name, domain: site.domain, environment: site.environment, isDemo: site.name.startsWith('[DEMO]') },
    logs: latestImport
      ? {
          importId: latestImport.id,
          fileName: latestImport.fileName,
          period: { start: latestImport.startDate, end: latestImport.endDate },
          requests: latestImport.validLines,
          googlebotRequests: latestImport.googlebotRequests,
          aiBotRequests: latestImport.aiBotRequests,
          crawledUrls: latestImport.crawledPagesCount
        }
      : null,
    importCount,
    sitemapUrls,
    openIssuesBySeverity: Object.fromEntries(openIssues.map(i => [i.severity, i._count])),
    openAlertsCount: openAlerts.length,
    openAlerts: openAlerts
      .sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(a.severity) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(b.severity) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5),
    latestCrawl: latestCrawl ? { id: latestCrawl.id, startedAt: latestCrawl.startedAt, urlsCrawled: latestCrawl.urlsCrawled, issuesFound: latestCrawl.issuesFound } : null,
    recentEvents
  };
}
