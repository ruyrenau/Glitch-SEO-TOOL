import { parseCsv, CsvError } from '@glitch/content-engine';
import { detectBacklinkColumns, domainOf, fetchWithRedirects, findLinkOnPage, isAllowedByRobots, parseRobotsTxt, spamSignals, type RobotsTxt } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscKey } from './gsc-service';

/**
 * Backlink inspector: upload a CSV of external links (Search Console "latest links", Ahrefs, Semrush, Moz,
 * Majestic…); a background job visits each linking page (slowly, respecting robots.txt) to see whether the
 * link is still there, its rel and anchor, and where it lands on our site (404s are authority to rescue).
 */

export const MAX_BACKLINKS = 20_000;
const UA = 'Mozilla/5.0 (compatible; G.SEO-backlink-check/1.0)';
const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export async function importBacklinks(siteId: string, fileName: string, csv: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const siteHost = domainOf(site.canonicalUrl);
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(csv.replace(/^﻿/, ''), { maxRows: MAX_BACKLINKS + 1, maxColumns: 80, maxCellLength: 4000 });
  } catch (e) {
    throw new WorkflowError('INVALID_CSV', e instanceof CsvError ? e.message : 'No se pudo leer el CSV.', 400);
  }
  const cols = detectBacklinkColumns(parsed.header);
  if (!cols) throw new WorkflowError('NO_SOURCE_COLUMN', 'No se encontró la columna con las páginas que te enlazan (por ejemplo "Linking page", "Referring page URL" o "Source url").', 400);
  const seen = new Set<string>();
  const rows: Array<{ sourceUrl: string; sourceDomain: string; targetUrl: string | null; csvAnchor: string | null }> = [];
  for (const r of parsed.rows) {
    const src = (r[cols.source] ?? '').trim();
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(src) ? src : `http://${src}`);
    } catch {
      continue;
    }
    const sourceDomain = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!sourceDomain || sourceDomain === siteHost || sourceDomain.endsWith(`.${siteHost}`)) continue; // internal links are not backlinks
    const target = cols.target >= 0 ? (r[cols.target] ?? '').trim() || null : null;
    const k = `${u.toString()}|${target ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ sourceUrl: u.toString(), sourceDomain, targetUrl: target, csvAnchor: cols.anchor >= 0 ? (r[cols.anchor] ?? '').trim().slice(0, 300) || null : null });
    if (rows.length >= MAX_BACKLINKS) break;
  }
  if (!rows.length) throw new WorkflowError('NO_LINKS', 'El archivo no tiene enlaces externos válidos.', 400);
  const imp = await prisma.backlinkImport.create({ data: { siteId, fileName: fileName.slice(0, 200), format: cols.format, rows: rows.length } });
  for (let i = 0; i < rows.length; i += 1000) await prisma.backlink.createMany({ data: rows.slice(i, i + 1000).map(r => ({ importId: imp.id, ...r })) });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'backlinks.imported', entity: 'BacklinkImport', entityId: imp.id, details: { fileName, format: cols.format, rows: rows.length } });
  return imp;
}

/** Visits every pending linking page. One request per second per domain, up to 6 domains at a time. */
export async function runBacklinkCheck(importId: string, opts: { log?: (m: string) => void; progress?: (pct: number | null, d?: Record<string, unknown>) => void; signal?: AbortSignal } = {}) {
  const imp = await prisma.backlinkImport.findUniqueOrThrow({ where: { id: importId }, include: { site: true } });
  const siteHost = domainOf(imp.site.canonicalUrl);
  await prisma.backlinkImport.update({ where: { id: importId }, data: { status: 'running', error: null } });
  const pending = await prisma.backlink.findMany({ where: { importId, status: 'pending' }, select: { id: true, sourceUrl: true, sourceDomain: true, targetUrl: true } });
  const byDomain = new Map<string, typeof pending>();
  for (const b of pending) byDomain.set(b.sourceDomain, [...(byDomain.get(b.sourceDomain) ?? []), b]);

  // Where links land on our site: the latest crawl first, a request otherwise (cached).
  const run = await prisma.crawlRun.findFirst({ where: { siteId: imp.siteId, status: 'completed' }, orderBy: { startedAt: 'desc' } });
  const crawled = new Map<string, { status: number; final: string; hops: number }>();
  if (run) {
    for (const p of await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, finalUrl: true, statusCode: true, redirectChain: true } })) {
      const chain = (p.redirectChain as Array<{ status: number }> | null) ?? [];
      crawled.set(gscKey(p.url), { status: chain.length ? chain[0].status : p.statusCode, final: p.finalUrl, hops: chain.length });
    }
  }
  const targetCache = new Map<string, Promise<{ status: number; final: string; hops: number }>>();
  const targetInfo = (url: string) => {
    const k = gscKey(url);
    if (crawled.has(k)) return Promise.resolve(crawled.get(k)!);
    if (!targetCache.has(k))
      targetCache.set(
        k,
        fetchWithRedirects(url, { userAgent: UA, timeoutMs: 15_000, allowHosts: allowHosts(), maxBodyBytes: 1, readBody: false, maxHops: 5 })
          .then(r => ({ status: r.chain.length ? r.chain[0].status : r.status, final: r.finalUrl, hops: r.chain.length }))
          .catch(() => ({ status: 0, final: url, hops: 0 }))
      );
    return targetCache.get(k)!;
  };

  let done = 0;
  const total = pending.length;
  const domains = [...byDomain.entries()];
  const worker = async () => {
    for (let next = domains.shift(); next; next = domains.shift()) {
      const [domain, links] = next;
      let robots: RobotsTxt | null = null;
      try {
        const r = await fetchWithRedirects(`${new URL(links[0].sourceUrl).origin}/robots.txt`, { userAgent: UA, timeoutMs: 10_000, allowHosts: allowHosts(), maxBodyBytes: 300_000, anyContentType: true });
        if (r.status === 200 && r.body) robots = parseRobotsTxt(r.body);
      } catch {
        /* no robots.txt */
      }
      for (const b of links) {
        if (opts.signal?.aborted) return;
        const u = new URL(b.sourceUrl);
        const data: Record<string, unknown> = { checkedAt: new Date() };
        if (robots && !isAllowedByRobots(robots, 'G.SEO-backlink-check', u.pathname + u.search)) {
          Object.assign(data, { status: 'blocked' });
        } else {
          const r = await fetchWithRedirects(b.sourceUrl, { userAgent: UA, timeoutMs: 15_000, allowHosts: allowHosts(), maxBodyBytes: 2_000_000 }).catch(e => ({ status: 0, body: null, finalUrl: b.sourceUrl, error: (e as Error).message }) as { status: number; body: string | null; finalUrl: string; error?: string });
          data.sourceStatus = r.status || null;
          if (r.status < 200 || r.status >= 300 || !r.body) Object.assign(data, { status: 'source-error' });
          else {
            const l = findLinkOnPage(r.body, r.finalUrl || b.sourceUrl, siteHost, b.targetUrl);
            const sig = spamSignals({ sourceUrl: b.sourceUrl, anchor: l.anchor, outlinks: l.outlinks });
            Object.assign(data, { status: l.found ? 'live' : 'lost', rel: l.rel, anchor: l.anchor, pageOutlinks: l.outlinks, toxicScore: sig.score, toxicReasons: sig.reasons });
            if (l.href && !b.targetUrl) data.targetUrl = l.href;
          }
        }
        const target = (data.targetUrl as string | undefined) ?? b.targetUrl;
        if (target) {
          const t = await targetInfo(target);
          Object.assign(data, { targetStatus: t.status || null, targetFinal: t.final, targetHops: t.hops });
        }
        if (data.toxicScore === undefined) {
          const sig = spamSignals({ sourceUrl: b.sourceUrl });
          Object.assign(data, { toxicScore: sig.score, toxicReasons: sig.reasons });
        }
        await prisma.backlink.update({ where: { id: b.id }, data });
        done++;
        if (done % 10 === 0 || done === total) {
          opts.progress?.(Math.round((done / total) * 100), { checked: done, total, domain });
          await prisma.backlinkImport.update({ where: { id: importId }, data: { checked: { increment: done % 10 === 0 ? 10 : done % 10 } } });
        }
        await new Promise(res => setTimeout(res, Number(process.env.BACKLINK_DELAY_MS ?? 1000)));
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(6, domains.length || 1) }, worker));
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const checked = await prisma.backlink.count({ where: { importId, status: { not: 'pending' } } });
    opts.log?.(`${checked} de ${imp.rows} enlaces revisados`);
    return prisma.backlinkImport.update({ where: { id: importId }, data: { status: 'completed', checked, completedAt: new Date() } });
  } catch (e) {
    await prisma.backlinkImport.update({ where: { id: importId }, data: { status: 'failed', error: (e as Error).message.slice(0, 500), completedAt: new Date() } });
    throw e;
  }
}

export async function listBacklinkImports(siteId: string) {
  return prisma.backlinkImport.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, take: 20 });
}

const isBroken = (s: number | null) => s === 404 || s === 410;

export async function backlinkReport(siteId: string, opts: { importId?: string } = {}) {
  const imp = opts.importId ? await prisma.backlinkImport.findFirst({ where: { id: opts.importId, siteId } }) : await prisma.backlinkImport.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } });
  if (!imp) return { import: null, totals: null };
  const links = await prisma.backlink.findMany({ where: { importId: imp.id } });
  const count = (f: (l: (typeof links)[number]) => boolean) => links.filter(f).length;
  const live = links.filter(l => l.status === 'live');
  const domains = new Map<string, { domain: string; links: number; live: number; follow: number; toxic: number }>();
  for (const l of links) {
    const d = domains.get(l.sourceDomain) ?? { domain: l.sourceDomain, links: 0, live: 0, follow: 0, toxic: 0 };
    d.links++;
    if (l.status === 'live') d.live++;
    if (l.status === 'live' && l.rel === 'follow') d.follow++;
    d.toxic = Math.max(d.toxic, l.toxicScore);
    domains.set(l.sourceDomain, d);
  }
  const anchors = new Map<string, number>();
  for (const l of live) anchors.set((l.anchor ?? '').toLowerCase().slice(0, 80) || '(vacío)', (anchors.get((l.anchor ?? '').toLowerCase().slice(0, 80) || '(vacío)') ?? 0) + 1);
  // Authority to rescue: live links that land on a 404/410 of our site, grouped by target.
  const rescue = new Map<string, { target: string; links: number; domains: Set<string>; follow: number }>();
  for (const l of live.filter(x => isBroken(x.targetStatus) && x.targetUrl)) {
    const e = rescue.get(gscKey(l.targetUrl!)) ?? { target: l.targetUrl!, links: 0, domains: new Set<string>(), follow: 0 };
    e.links++;
    e.domains.add(l.sourceDomain);
    if (l.rel === 'follow') e.follow++;
    rescue.set(gscKey(l.targetUrl!), e);
  }
  const row = (l: (typeof links)[number]) => ({ id: l.id, sourceUrl: l.sourceUrl, sourceDomain: l.sourceDomain, targetUrl: l.targetUrl, status: l.status, sourceStatus: l.sourceStatus, rel: l.rel, anchor: l.anchor ?? l.csvAnchor, targetStatus: l.targetStatus, targetHops: l.targetHops, toxicScore: l.toxicScore, toxicReasons: l.toxicReasons as string[] });
  return {
    import: imp,
    totals: {
      links: links.length,
      domains: domains.size,
      pending: count(l => l.status === 'pending'),
      live: live.length,
      lost: count(l => l.status === 'lost'),
      sourceError: count(l => l.status === 'source-error'),
      blocked: count(l => l.status === 'blocked'),
      follow: count(l => l.status === 'live' && l.rel === 'follow'),
      nofollow: count(l => l.status === 'live' && !!l.rel?.includes('nofollow')),
      sponsored: count(l => l.status === 'live' && !!l.rel?.includes('sponsored')),
      ugc: count(l => l.status === 'live' && !!l.rel?.includes('ugc')),
      toBroken: count(l => l.status === 'live' && isBroken(l.targetStatus)),
      toRedirect: count(l => l.status === 'live' && (l.targetHops ?? 0) > 0),
      suspicious: count(l => l.toxicScore >= 40)
    },
    rescue: [...rescue.values()].map(r => ({ target: r.target, links: r.links, domains: r.domains.size, follow: r.follow })).sort((a, b) => b.follow - a.follow || b.links - a.links),
    topDomains: [...domains.values()].sort((a, b) => b.live - a.live || b.links - a.links).slice(0, 100),
    anchors: [...anchors.entries()].map(([anchor, n]) => ({ anchor, links: n })).sort((a, b) => b.links - a.links).slice(0, 50),
    lost: links.filter(l => l.status === 'lost' || l.status === 'source-error').map(row).slice(0, 2000),
    suspicious: links.filter(l => l.toxicScore >= 40).sort((a, b) => b.toxicScore - a.toxicScore).map(row).slice(0, 2000),
    links: links.map(row).slice(0, 5000)
  };
}

/** Broken targets that still receive backlinks (for the 301 map in Arquitectura). */
export async function backlinkBrokenTargets(siteId: string) {
  const imp = await prisma.backlinkImport.findFirst({ where: { siteId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
  if (!imp) return [];
  const rows = await prisma.backlink.groupBy({ by: ['targetUrl'], where: { importId: imp.id, status: 'live', targetStatus: { in: [404, 410] }, targetUrl: { not: null } }, _count: { _all: true } });
  return rows.map(r => ({ url: r.targetUrl!, links: r._count._all }));
}
