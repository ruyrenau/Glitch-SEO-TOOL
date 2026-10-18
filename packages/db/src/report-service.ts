import crypto from 'crypto';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { monitorOverview } from './monitor-service';
import { gscReport } from './gsc-service';
import { aiMatrix } from './ai-visibility-service';

/**
 * Client reports: a frozen snapshot of the chosen sections (so the client sees exactly what was reviewed),
 * shared through a secret link that can expire or be revoked. Internal details (pasted AI answers, URLs of
 * webhooks, user names) are never included.
 */

export const REPORT_SECTIONS = {
  summary: 'Resumen y cambios importantes',
  gsc: 'Search Console (clics, impresiones, consultas)',
  monitor: 'Evolución (crawl y velocidad en el tiempo)',
  crawl: 'Salud técnica (último crawl e issues)',
  vitals: 'Core Web Vitals por página',
  ai: 'Visibilidad en IA'
} as const;
export type ReportSection = keyof typeof REPORT_SECTIONS;

export async function buildReportSnapshot(siteId: string, sections: ReportSection[]) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const want = new Set(sections);
  const snap: Record<string, unknown> = { site: { name: site.name, url: site.canonicalUrl }, generatedAt: new Date().toISOString(), sections };

  if (want.has('summary') || want.has('monitor')) {
    const o = await monitorOverview(siteId);
    if (want.has('summary')) snap.summary = { insights: o.insights.map(i => ({ tone: i.tone, area: i.area, title: i.title, detail: i.detail, related: i.related.slice(0, 3) })) };
    if (want.has('monitor')) snap.monitor = { crawl: o.crawl.map(c => ({ date: c.date, urls: c.urls, indexable: c.indexable, errors4xx: c.errors4xx, errors5xx: c.errors5xx, issues: c.issues, partial: c.partial })), vitals: o.vitals, events: o.events.filter(e => e.kind !== 'crawl').map(e => ({ date: e.date, kind: e.kind, label: e.label })) };
  }
  if (want.has('gsc')) {
    const r = await gscReport(siteId);
    snap.gsc = r.import
      ? { property: r.property, startDate: r.import.startDate, endDate: r.import.endDate, totals: r.totals, daily: r.daily, topPages: r.topPages?.slice(0, 10), topQueries: r.topQueries?.slice(0, 10), opportunities: r.opportunities?.slice(0, 10), lowCtr: r.lowCtr?.slice(0, 10) }
      : null;
  }
  if (want.has('crawl')) {
    const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
    if (run) {
      const [indexable, e4, e5, issues] = await Promise.all([
        prisma.crawledPage.count({ where: { crawlRunId: run.id, isIndexable: true } }),
        prisma.crawledPage.count({ where: { crawlRunId: run.id, statusCode: { gte: 400, lt: 500 } } }),
        prisma.crawledPage.count({ where: { crawlRunId: run.id, statusCode: { gte: 500 } } }),
        prisma.issue.findMany({ where: { siteId, status: { in: ['open', 'in_progress'] } }, orderBy: [{ priorityScore: 'desc' }], take: 50, select: { title: true, severity: true, category: true, affectedUrlsCount: true, priorityScore: true } })
      ]);
      const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
      snap.crawl = { date: run.startedAt, urls: run.urlsCrawled, indexable, errors4xx: e4, errors5xx: e5, openIssues: issues.length, issues: issues.sort((a, b) => rank[a.severity] - rank[b.severity] || b.priorityScore - a.priorityScore).slice(0, 12) };
    } else snap.crawl = null;
  }
  if (want.has('vitals')) {
    const runs = await prisma.performanceRun.findMany({ where: { siteId, status: 'ok' }, orderBy: { createdAt: 'desc' }, take: 300, select: { url: true, strategy: true, createdAt: true, performanceScore: true, labLcp: true, labCls: true, labTbt: true, fieldLcp: true, fieldInp: true, fieldCls: true, fieldStatus: true, report: true } });
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latest.has(`${r.url}|${r.strategy}`)) latest.set(`${r.url}|${r.strategy}`, r);
    snap.vitals = [...latest.values()].map(r => ({ url: r.url, strategy: r.strategy, date: r.createdAt, score: r.performanceScore, grade: (r.report as { grade?: { letter?: string } } | null)?.grade?.letter ?? null, labLcp: r.labLcp, labCls: r.labCls, labTbt: r.labTbt, fieldLcp: r.fieldLcp, fieldInp: r.fieldInp, fieldCls: r.fieldCls, field: r.fieldStatus === 'available' }));
  }
  if (want.has('ai')) {
    const m = await aiMatrix(siteId);
    snap.ai = m.rows.length ? { rows: m.rows.map(r => ({ text: r.prompt.text, keyword: r.prompt.keyword, cells: r.cells })), evolution: m.evolution, byKeyword: m.byKeyword, engines: m.engines } : null;
  }
  return snap;
}

export async function createReport(siteId: string, input: { title: string; sections: ReportSection[]; expiresDays: number | null }, actorUserId: string | null) {
  const sections = input.sections.filter(s => s in REPORT_SECTIONS);
  if (!sections.length) throw new WorkflowError('NO_SECTIONS', 'Elige al menos una sección.', 400);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const snapshot = await buildReportSnapshot(siteId, sections);
  const r = await prisma.reportShare.create({
    data: { siteId, token: crypto.randomBytes(24).toString('base64url'), title: input.title.trim() || `Reporte SEO — ${site.name}`, sections, snapshot: snapshot as object, createdById: actorUserId, expiresAt: input.expiresDays ? new Date(Date.now() + input.expiresDays * 86400_000) : null }
  });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'report.created', entity: 'ReportShare', entityId: r.id, details: { sections, expiresDays: input.expiresDays } });
  return r;
}

export async function listReports(siteId: string) {
  return prisma.reportShare.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, take: 100, omit: { snapshot: true } });
}

export async function revokeReport(id: string, actorUserId: string | null) {
  const r = await prisma.reportShare.update({ where: { id }, data: { revokedAt: new Date() }, include: { site: true } });
  await recordAuditEvent({ workspaceId: r.site.workspaceId, userId: actorUserId, action: 'report.revoked', entity: 'ReportShare', entityId: id });
  return { revoked: true };
}

/** For the public link: only live (not revoked, not expired) reports; counts views. */
export async function publicReport(token: string) {
  const r = await prisma.reportShare.findUnique({ where: { token } });
  if (!r || r.revokedAt || (r.expiresAt && r.expiresAt < new Date())) throw new WorkflowError('REPORT_NOT_AVAILABLE', 'Este reporte no existe, caducó o fue retirado.', 404);
  await prisma.reportShare.update({ where: { id: r.id }, data: { views: { increment: 1 } } });
  return { title: r.title, createdAt: r.createdAt, expiresAt: r.expiresAt, snapshot: r.snapshot };
}
