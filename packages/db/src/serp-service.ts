import { decryptSecret } from '@glitch/core';
import { SERP_FEATURES, SearchConsoleClient, SerpApiClient, SerpError, googleConfig, type SerpFeature } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { keywordTopicsReport } from './content-analysis-service';

/**
 * SERP & AI snapshot tracker: a weekly photo of Google's results page for the main keywords (through SerpAPI):
 * which blocks are there (AI Overview, People Also Ask, featured snippet, forums, videos…), where the site
 * ranks and whether the AI Overview cites it. Crossed with daily Search Console clicks to explain drops that
 * are not ranking drops ("Google added an AI Overview above you").
 */

export const SERP_MAX_KEYWORDS = 100;
const day = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

async function monitorRow(siteId: string) {
  return prisma.siteMonitor.upsert({ where: { siteId }, create: { siteId }, update: {} });
}

export async function serpConfig(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const m = await monitorRow(siteId);
  const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId: site.workspaceId, provider: 'serpapi' } } });
  const keywords = await prisma.serpKeyword.findMany({ where: { siteId }, orderBy: { keyword: 'asc' } });
  return { enabled: m.serpEnabled, gl: m.serpGl, hl: m.serpHl, lastRunAt: m.serpLastRunAt, hasKey: !!key, keywords: keywords.map(k => ({ id: k.id, keyword: k.keyword, active: k.active })), max: SERP_MAX_KEYWORDS };
}

export async function saveSerpConfig(siteId: string, input: { enabled: boolean; gl: string; hl: string }, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  await monitorRow(siteId);
  await prisma.siteMonitor.update({ where: { siteId }, data: { serpEnabled: input.enabled, serpGl: input.gl.toLowerCase(), serpHl: input.hl.toLowerCase() } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'serp.config_saved', entity: 'Site', entityId: siteId, details: input });
  return serpConfig(siteId);
}

export async function addSerpKeywords(siteId: string, keywords: string[]) {
  const existing = await prisma.serpKeyword.count({ where: { siteId } });
  const clean = [...new Set(keywords.map(k => k.replace(/\s+/g, ' ').trim().toLowerCase()).filter(k => k.length >= 2 && k.length <= 120))];
  if (existing + clean.length > SERP_MAX_KEYWORDS) throw new WorkflowError('TOO_MANY_KEYWORDS', `Máximo ${SERP_MAX_KEYWORDS} keywords por sitio (cada una es una búsqueda de SerpAPI por semana).`, 400);
  for (const keyword of clean) await prisma.serpKeyword.upsert({ where: { siteId_keyword: { siteId, keyword } }, create: { siteId, keyword }, update: { active: true } });
  return serpConfig(siteId);
}

/** The lead query of the biggest keyword topics (Análisis de contenido → Temas). */
export async function suggestSerpKeywords(siteId: string, n = 20) {
  const t = await keywordTopicsReport(siteId);
  const have = new Set((await prisma.serpKeyword.findMany({ where: { siteId }, select: { keyword: true } })).map(k => norm(k.keyword)));
  return t.topics.filter(x => !have.has(norm(x.name))).slice(0, n).map(x => ({ keyword: x.name, impressions: x.impressions, clicks: x.clicks, status: x.status }));
}

export async function removeSerpKeyword(siteId: string, id: string) {
  const r = await prisma.serpKeyword.deleteMany({ where: { id, siteId } });
  if (!r.count) throw new WorkflowError('KEYWORD_NOT_FOUND', 'Esa keyword no está en este sitio.', 404);
  return { deleted: true };
}

/** Daily clicks of the tracked keywords (last 120 days) from Search Console, to compare before and after a change. */
async function syncQueryDays(siteId: string, keywords: string[], log: (m: string) => void) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const acc = await prisma.googleAccount.findUnique({ where: { workspaceId: site.workspaceId } });
  const cfg = googleConfig();
  if (!site.gscProperty || !acc || !cfg || !keywords.length) return;
  const client = new SearchConsoleClient(cfg, decryptSecret(acc.refreshTokenEnc));
  const end = new Date(Date.now() - 2 * 86400_000);
  const start = new Date(end.getTime() - 119 * 86400_000);
  const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await client.query(site.gscProperty, { startDate: day(start), endDate: day(end), dimensions: ['date', 'query'], maxRows: 50_000, filters: [{ dimension: 'query', operator: 'includingRegex', expression: `^(${keywords.map(esc).join('|')})$` }] });
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.$transaction(
      rows.slice(i, i + 500).map(r =>
        prisma.gscQueryDay.upsert({
          where: { siteId_date_query: { siteId, date: r.keys[0], query: r.keys[1].toLowerCase() } },
          create: { siteId, date: r.keys[0], query: r.keys[1].toLowerCase(), clicks: r.clicks, impressions: r.impressions, position: r.position },
          update: { clicks: r.clicks, impressions: r.impressions, position: r.position }
        })
      )
    );
  }
  log(`Search Console: ${rows.length} filas diarias de las keywords seguidas`);
}

export async function runSerpCheck(siteId: string, opts: { log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const log = opts.log ?? (() => undefined);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const m = await monitorRow(siteId);
  const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId: site.workspaceId, provider: 'serpapi' } } });
  if (!key) throw new WorkflowError('SERPAPI_KEY_MISSING', 'Agrega la clave de SerpAPI en Configuración → Claves de API.', 400);
  const keywords = await prisma.serpKeyword.findMany({ where: { siteId, active: true } });
  if (!keywords.length) throw new WorkflowError('NO_KEYWORDS', 'Agrega keywords para seguir.', 400);
  const client = new SerpApiClient(decryptSecret(key.keyEnc));
  const host = domainOf(site.canonicalUrl);
  const mine = (d: string) => d === host || d.endsWith(`.${host}`);
  const today = day(new Date());
  let ok = 0;
  for (const k of keywords) {
    if (opts.signal?.aborted) throw new Error('Cancelado');
    try {
      const r = await client.search(k.keyword, { gl: m.serpGl, hl: m.serpHl });
      const own = r.organic.find(o => mine(o.domain));
      const above = r.features.filter(f => SERP_FEATURES[f].above || (own && own.position > 3 && ['people_also_ask', 'forums', 'videos'].includes(f)));
      await prisma.serpSnapshot.deleteMany({ where: { keywordId: k.id, date: today } });
      await prisma.serpSnapshot.create({
        data: {
          keywordId: k.id,
          date: today,
          position: own?.position ?? null,
          url: own?.url ?? null,
          features: r.features,
          aiCitesUs: r.aiOverview.present ? r.aiOverview.sources.some(s => mine(s.domain)) : null,
          aiSources: r.aiOverview.sources.slice(0, 15),
          aboveUs: above,
          topDomains: r.organic.slice(0, 10).map(o => ({ position: o.position, domain: o.domain, url: o.url }))
        }
      });
      ok++;
    } catch (e) {
      if (e instanceof SerpError && e.code !== 'PROVIDER_ERROR') throw new WorkflowError(`SERPAPI_${e.code}`, e.message, e.code === 'AUTH' ? 400 : 429);
      log(`"${k.keyword}": ${(e as Error).message}`);
    }
  }
  await syncQueryDays(siteId, keywords.map(k => k.keyword), log).catch(e => log(`Search Console no se actualizó: ${(e as Error).message}`));
  await prisma.siteMonitor.update({ where: { siteId }, data: { serpLastRunAt: new Date() } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'serp.checked', entity: 'Site', entityId: siteId, details: { keywords: keywords.length, ok } });
  log(`${ok} de ${keywords.length} keywords revisadas`);
  return { keywords: keywords.length, ok };
}

/** Sites with the weekly SERP check on and due (last run more than 6.5 days ago). */
export async function sitesDueForSerp() {
  const cutoff = new Date(Date.now() - 6.5 * 86400_000);
  return prisma.site.findMany({ where: { status: 'active', monitor: { serpEnabled: true, OR: [{ serpLastRunAt: null }, { serpLastRunAt: { lt: cutoff } }] } }, select: { id: true, workspaceId: true } });
}

// ---------------------------------------------------------------- report

const label = (f: string) => SERP_FEATURES[f as SerpFeature]?.label ?? f;

export async function serpReport(siteId: string) {
  const cfg = await serpConfig(siteId);
  const keywords = await prisma.serpKeyword.findMany({ where: { siteId }, include: { snapshots: { orderBy: { date: 'asc' } } }, orderBy: { keyword: 'asc' } });
  const days = await prisma.gscQueryDay.findMany({ where: { siteId } });
  const lastDay = days.reduce((m, d) => (d.date > m ? d.date : m), '');
  const window = (q: string, from: number, to: number) => {
    if (!lastDay) return null;
    const end = new Date(`${lastDay}T00:00:00Z`).getTime();
    const rows = days.filter(d => d.query === norm(q) || d.query === q.toLowerCase()).filter(d => {
      const t = new Date(`${d.date}T00:00:00Z`).getTime();
      return t > end - to * 86400_000 && t <= end - from * 86400_000;
    });
    if (!rows.length) return null;
    const clicks = rows.reduce((n, r) => n + r.clicks, 0);
    const impressions = rows.reduce((n, r) => n + r.impressions, 0);
    return { clicks, impressions, position: impressions ? Math.round((rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions) * 10) / 10 : null };
  };

  const items = keywords.map(k => {
    const snaps = k.snapshots;
    const last = snaps.at(-1) ?? null;
    // Compare with the snapshot closest to 28 days before the last one (or the first one).
    const ref = last ? [...snaps].reverse().find(s => s !== last && new Date(last.date).getTime() - new Date(s.date).getTime() >= 21 * 86400_000) ?? (snaps.length > 1 ? snaps[0] : null) : null;
    const lf = (last?.features as string[] | undefined) ?? [];
    const rf = (ref?.features as string[] | undefined) ?? [];
    const added = ref ? lf.filter(f => !rf.includes(f)) : [];
    const removed = ref ? rf.filter(f => !lf.includes(f)) : [];
    const now = window(k.keyword, 0, 28);
    const before = window(k.keyword, 28, 56);
    const clickChange = now && before && before.clicks >= 10 ? Math.round(((now.clicks - before.clicks) / before.clicks) * 100) : null;
    const posBefore = before?.position ?? ref?.position ?? null;
    const posNow = now?.position ?? last?.position ?? null;
    const stablePos = posBefore !== null && posNow !== null && Math.abs(posNow - posBefore) < 1.5;
    const insights: Array<{ tone: 'bad' | 'warn' | 'good' | 'info'; text: string }> = [];
    const aboveNow = ((last?.aboveUs as string[] | undefined) ?? []).filter(f => added.includes(f));
    if (clickChange !== null && clickChange <= -30) {
      if (stablePos && added.length) insights.push({ tone: 'bad', text: `Perdiste ${-clickChange} % de clics sin caer en ranking (posición ${posBefore} → ${posNow}): Google activó ${added.map(label).join(', ')}${aboveNow.length ? ' arriba o cerca de tu resultado' : ''}.${added.includes('ai_overview') && last?.aiCitesUs === false ? ' El AI Overview no te cita.' : ''}` });
      else if (posBefore !== null && posNow !== null && posNow - posBefore >= 1.5) insights.push({ tone: 'bad', text: `Perdiste ${-clickChange} % de clics y bajaste de posición (${posBefore} → ${posNow}): revisa quién te pasó en el top 10.` });
      else if (stablePos) insights.push({ tone: 'warn', text: `Perdiste ${-clickChange} % de clics con la misma posición y sin bloques nuevos: puede ser menos demanda (estacionalidad) o un cambio en tu título o descripción.` });
    }
    if (last?.aiCitesUs === false) insights.push({ tone: 'warn', text: `Hay un AI Overview y no te cita${(last.aiSources as Array<{ domain: string }>).length ? `; cita a ${[...new Set((last.aiSources as Array<{ domain: string }>).map(s => s.domain))].slice(0, 4).join(', ')}` : ''}. Revisa "Listo para IA" de tu página.` });
    if (last?.aiCitesUs === true) insights.push({ tone: 'good', text: 'El AI Overview cita tu sitio.' });
    if (added.length && !insights.some(i => i.tone === 'bad')) insights.push({ tone: 'info', text: `Bloques nuevos desde ${ref!.date}: ${added.map(label).join(', ')}.` });
    if (removed.length) insights.push({ tone: 'info', text: `Ya no aparecen: ${removed.map(label).join(', ')}.` });
    if (last && last.position === null) insights.push({ tone: 'warn', text: 'Tu sitio no está en los primeros 10 resultados.' });
    return {
      id: k.id,
      keyword: k.keyword,
      active: k.active,
      last: last ? { date: last.date, position: last.position, url: last.url, features: lf, aiCitesUs: last.aiCitesUs, aiSources: last.aiSources, aboveUs: last.aboveUs, topDomains: last.topDomains } : null,
      compare: ref ? { date: ref.date, position: ref.position, features: rf } : null,
      added,
      removed,
      gsc: now ? { clicks: now.clicks, clicksBefore: before?.clicks ?? null, clickChange, position: now.position } : null,
      insights,
      history: snaps.map(s => ({ date: s.date, position: s.position, features: s.features as string[] }))
    };
  });
  const latest = items.filter(i => i.last);
  const share = (f: string) => (latest.length ? Math.round((latest.filter(i => i.last!.features.includes(f)).length / latest.length) * 100) : 0);
  return {
    config: cfg,
    features: SERP_FEATURES,
    totals: {
      keywords: items.length,
      checked: latest.length,
      aiOverview: share('ai_overview'),
      aiCitesUs: latest.filter(i => i.last!.aiCitesUs === true).length,
      aiWithoutUs: latest.filter(i => i.last!.aiCitesUs === false).length,
      top3: latest.filter(i => (i.last!.position ?? 99) <= 3).length,
      notRanking: latest.filter(i => i.last!.position === null).length,
      explainedDrops: items.filter(i => i.insights.some(x => x.tone === 'bad')).length
    },
    featureShare: Object.keys(SERP_FEATURES).map(f => ({ feature: f, label: label(f), pct: share(f) })).filter(x => x.pct > 0),
    items
  };
}
