import zlib from 'zlib';
import { AI_CHECKS, aiBotAccess, fetchWithRedirects, gradeOf, scoreAiReadiness, type AiCheckId, type AiCheckResult } from '@glitch/crawler';
import { prisma } from './client';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';

/** Pages scored per crawl (the rest are skipped: scoring parses every HTML). */
export const AI_READINESS_MAX_PAGES = 5000;

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Scores the HTML pages of a crawl once and stores the result (later calls read it back). */
async function ensureScored(crawlRunId: string) {
  if (await prisma.aiReadinessPage.count({ where: { crawlRunId } })) return;
  const ids = await prisma.crawledPage.findMany({ where: { crawlRunId, statusCode: 200, mimeType: { contains: 'html' }, htmlGz: { not: null } }, select: { id: true }, orderBy: { depth: 'asc' }, take: AI_READINESS_MAX_PAGES });
  for (let i = 0; i < ids.length; i += 100) {
    const pages = await prisma.crawledPage.findMany({ where: { id: { in: ids.slice(i, i + 100).map(p => p.id) } }, select: { url: true, finalUrl: true, title: true, htmlGz: true, js: true, xRobotsTag: true } });
    const rows = pages.map(p => {
      const html = zlib.gunzipSync(Buffer.from(p.htmlGz!)).toString('utf8');
      const js = p.js as { rendered?: boolean; raw?: { wordCount?: number } } | null;
      const r = scoreAiReadiness(html, p.finalUrl || p.url, { rawWordCount: js?.rendered ? js.raw?.wordCount ?? null : null, xRobotsTag: p.xRobotsTag });
      return { crawlRunId, url: p.url, title: p.title, score: r.score, grade: r.grade, checks: r.checks as unknown as object };
    });
    await prisma.aiReadinessPage.createMany({ data: rows });
  }
}

async function siteSignals(origin: string) {
  const opts = { userAgent: 'G.SEO (+ai-readiness)', timeoutMs: 8000, allowHosts: allowHosts(), maxBodyBytes: 500_000, anyContentType: true };
  const [robots, llms] = await Promise.all([fetchWithRedirects(`${origin}/robots.txt`, opts).catch(() => null), fetchWithRedirects(`${origin}/llms.txt`, opts).catch(() => null)]);
  const robotsFound = robots?.status === 200 && robots.body !== null;
  const llmsFound = llms?.status === 200 && !!llms.body && !/<html/i.test(llms.body.slice(0, 500));
  return {
    robots: { found: robotsFound, status: robots?.status || null, bots: aiBotAccess(robotsFound ? robots!.body : null) },
    llmsTxt: { found: llmsFound, lines: llmsFound ? llms!.body!.split(/\r?\n/).filter(Boolean).length : 0 }
  };
}

/** "Listo para IA" for a site: per-page scores (latest crawl by default), site-wide gaps and AI bot access. */
export async function aiReadinessReport(siteId: string, opts: { crawlRunId?: string } = {}) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const run = opts.crawlRunId
    ? await prisma.crawlRun.findFirst({ where: { id: opts.crawlRunId, siteId } })
    : await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', detailPurgedAt: null }, orderBy: { startedAt: 'desc' } });
  if (opts.crawlRunId && !run) throw new WorkflowError('CRAWL_NOT_FOUND', 'Ese crawl no existe en este sitio.', 404);
  let origin = site.canonicalUrl;
  try {
    origin = new URL(site.canonicalUrl).origin;
  } catch {
    /* keep */
  }
  const signals = await siteSignals(origin);
  if (!run) return { crawl: null, signals, checks: AI_CHECKS, pages: [], summary: null };
  if (run.detailPurgedAt) throw new WorkflowError('CRAWL_PURGED', 'El HTML de ese crawl ya se borró para ahorrar espacio. Elige un crawl más reciente.', 409);
  await ensureScored(run.id);

  const rows = await prisma.aiReadinessPage.findMany({ where: { crawlRunId: run.id }, orderBy: { score: 'asc' } });
  const imp = await latestGscImport(siteId);
  const gsc = new Map((imp ? await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true, impressions: true } }) : []).map(p => [gscKey(p.page), p]));
  const pages = rows.map(r => {
    const g = gsc.get(gscKey(r.url));
    const checks = r.checks as unknown as AiCheckResult[];
    return { url: r.url, title: r.title, score: r.score, grade: r.grade, clicks: g?.clicks ?? null, impressions: g?.impressions ?? null, failing: checks.filter(c => c.score < 1).map(c => c.id), checks };
  });

  const ids = Object.keys(AI_CHECKS) as AiCheckId[];
  const n = pages.length || 1;
  const byCheck = ids.map(id => {
    const fail = pages.filter(p => p.failing.includes(id)).length;
    return { id, label: AI_CHECKS[id].label, weight: AI_CHECKS[id].weight, failing: fail, pct: Math.round((fail / n) * 100) };
  });
  const avg = pages.length ? Math.round(pages.reduce((s, p) => s + p.score, 0) / pages.length) : 0;
  const dist = { excelente: 0, bien: 0, mejorable: 0, bajo: 0 } as Record<string, number>;
  for (const p of pages) dist[p.grade]++;
  // What to fix first: pages with search demand and a low score, then the checks with the most points lost.
  const priority = pages.filter(p => p.score < 60 && (p.impressions ?? 0) > 0).sort((a, b) => (b.impressions ?? 0) * (100 - b.score) - (a.impressions ?? 0) * (100 - a.score)).slice(0, 10).map(p => p.url);
  const blockedSearch = signals.robots.bots.filter(b => !b.allowed && ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Googlebot', 'Bingbot', 'Claude-SearchBot', 'Claude-User'].includes(b.agent)).map(b => b.agent);

  return {
    crawl: { id: run.id, startedAt: run.startedAt, mode: run.mode },
    signals,
    checks: AI_CHECKS,
    summary: { pages: pages.length, average: avg, grade: gradeOf(avg), distribution: dist, byCheck: byCheck.sort((a, b) => b.failing * b.weight - a.failing * a.weight), priority, blockedSearch, capped: pages.length >= AI_READINESS_MAX_PAGES, hasGsc: !!imp },
    pages
  };
}
