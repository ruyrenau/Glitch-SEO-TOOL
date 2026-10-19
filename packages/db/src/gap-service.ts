import { Prisma } from '@prisma/client';
import { decryptSecret } from '@glitch/core';
import { AiError, SerpApiClient, SerpError, analyzeWithClaude } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { latestGscImport } from './gsc-service';

/**
 * Content gaps vs competitors: searches keywords on Google (SerpAPI), finds where competitors rank in the
 * top 10 and the site does not, groups those keywords by search intent (shared results) and proposes a
 * new page or an improvement for each group, with a content brief (Claude, or a manual outline).
 */

const json = (v: unknown) => v as Prisma.InputJsonValue;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const domainOf = (u: string) => {
  try {
    return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
const owns = (domain: string, host: string) => domain === host || domain.endsWith(`.${host}`);

export const GAP_MAX_SEARCHES = 100;

export type GapKind = 'missing' | 'weak' | 'win' | 'none';

export interface GapKeyword {
  keyword: string;
  source: 'manual' | 'gsc' | 'tracked' | 'related';
  ownPosition: number | null;
  ownUrl: string | null;
  /** Best Search Console position (any page) in the last import. */
  gscPosition: number | null;
  gscImpressions: number | null;
  competitors: Record<string, { position: number; url: string; title: string }>;
  top: Array<{ position: number; domain: string; url: string; title: string; snippet?: string }>;
  questions: string[];
  features: string[];
  kind: GapKind;
  score: number;
}

export interface GapCluster {
  id: string;
  lead: string;
  keywords: string[];
  kind: 'missing' | 'weak';
  score: number;
  /** Own page that already ranks for part of the group (improve it instead of creating a new one). */
  ownUrl: string | null;
  competitorPages: Array<{ domain: string; url: string; title: string; position: number }>;
  questions: string[];
}

export interface GapBrief {
  source: 'ai' | 'manual';
  model?: string;
  title: string;
  markdown: string;
  createdAt: string;
}

export interface GapResult {
  searched: number;
  failed: number;
  keywords: GapKeyword[];
  clusters: GapCluster[];
  competitors: Array<{ domain: string; top10: number; gaps: number; avgPosition: number | null }>;
  briefs: Record<string, GapBrief>;
}

/** Pure classification: where competitors are in the top 10 and the site is not (or far behind). */
export function classifyGap(k: Pick<GapKeyword, 'ownPosition' | 'gscPosition' | 'competitors'>): { kind: GapKind; score: number } {
  const comps = Object.values(k.competitors).map(c => c.position).filter(p => p <= 10);
  const best = comps.length ? Math.min(...comps) : null;
  const score = comps.reduce((s, p) => s + (11 - p), 0);
  if (best === null) return { kind: k.ownPosition ? 'win' : 'none', score: 0 };
  if (k.ownPosition !== null && k.ownPosition < best) return { kind: 'win', score };
  if (k.ownPosition === null && (k.gscPosition === null || k.gscPosition > 20)) return { kind: 'missing', score };
  return { kind: 'weak', score };
}

/** Groups gap keywords whose top 10 share ≥ 3 URLs (Google treats them as the same intent). */
export function clusterGaps(keywords: GapKeyword[]): GapCluster[] {
  const gaps = keywords.filter(k => k.kind === 'missing' || k.kind === 'weak').sort((a, b) => b.score - a.score || (b.gscImpressions ?? 0) - (a.gscImpressions ?? 0));
  const groups: GapKeyword[][] = [];
  for (const k of gaps) {
    const urls = new Set(k.top.map(t => t.url));
    const g = groups.find(gr => gr[0].top.filter(t => urls.has(t.url)).length >= 3);
    if (g) g.push(k);
    else groups.push([k]);
  }
  return groups.map((g, i) => {
    const pages = new Map<string, GapCluster['competitorPages'][number]>();
    for (const k of g) for (const [domain, c] of Object.entries(k.competitors)) if (c.position <= 10 && (!pages.has(c.url) || pages.get(c.url)!.position > c.position)) pages.set(c.url, { domain, url: c.url, title: c.title, position: c.position });
    return {
      id: `c${i + 1}`,
      lead: g[0].keyword,
      keywords: g.map(k => k.keyword),
      kind: (g.some(k => k.kind === 'weak') ? 'weak' : 'missing') as GapCluster['kind'],
      score: g.reduce((s, k) => s + k.score, 0),
      ownUrl: g.find(k => k.ownUrl)?.ownUrl ?? null,
      competitorPages: [...pages.values()].sort((a, b) => a.position - b.position).slice(0, 8),
      questions: [...new Set(g.flatMap(k => k.questions))].slice(0, 12)
    };
  }).sort((a, b) => b.score - a.score);
}

async function serpClient(workspaceId: string) {
  const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId, provider: 'serpapi' } } });
  if (!key) throw new WorkflowError('SERPAPI_KEY_MISSING', 'Agrega la clave de SerpAPI en Configuración → Claves de API.', 400);
  return new SerpApiClient(decryptSecret(key.keyEnc));
}

/** Keyword ideas for the form: Search Console queries where the site is weak, and tracked SERP keywords. */
export async function gapKeywordSuggestions(siteId: string) {
  const imp = await latestGscImport(siteId);
  const gsc = imp
    ? await prisma.gscQueryStat.groupBy({ by: ['query'], where: { importId: imp.id }, _sum: { impressions: true, clicks: true }, _min: { position: true }, orderBy: { _sum: { impressions: 'desc' } }, take: 400 })
    : [];
  const weak = gsc.filter(r => (r._min.position ?? 0) > 8 && r.query.split(' ').length >= 2).slice(0, 40).map(r => ({ keyword: r.query, impressions: r._sum.impressions ?? 0, position: Math.round((r._min.position ?? 0) * 10) / 10 }));
  const tracked = (await prisma.serpKeyword.findMany({ where: { siteId, active: true }, select: { keyword: true } })).map(k => k.keyword);
  const last = await prisma.contentGap.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' }, select: { competitors: true } });
  // Domains that appear most in the stored SERP snapshots (likely competitors).
  const snaps = await prisma.serpSnapshot.findMany({ where: { keyword: { siteId } }, orderBy: { date: 'desc' }, take: 300, select: { topDomains: true } });
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const host = domainOf(site.canonicalUrl);
  const freq = new Map<string, number>();
  for (const s of snaps) for (const d of (s.topDomains as Array<{ domain: string }>) ?? []) if (!owns(d.domain, host) && !/(wikipedia|youtube|facebook|instagram|reddit|quora|linkedin|amazon|mercadolibre|google)\./.test(d.domain)) freq.set(d.domain, (freq.get(d.domain) ?? 0) + 1);
  return {
    gsc: weak,
    tracked,
    competitors: (last?.competitors as string[] | undefined) ?? [...freq].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d),
    max: GAP_MAX_SEARCHES
  };
}

export async function startContentGap(siteId: string, input: { competitors: string[]; keywords: string[]; expand?: boolean; maxSearches?: number }) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  await serpClient(site.workspaceId);
  const host = domainOf(site.canonicalUrl);
  const competitors = [...new Set(input.competitors.map(domainOf).filter(d => d && !owns(d, host)))];
  if (!competitors.length) throw new WorkflowError('NO_COMPETITORS', 'Agrega al menos un competidor (su dominio).', 400);
  const keywords = [...new Map(input.keywords.map(k => [norm(k), k.replace(/\s+/g, ' ').trim().toLowerCase()])).values()].filter(k => k.length >= 2 && k.length <= 120);
  if (!keywords.length) throw new WorkflowError('NO_KEYWORDS', 'Agrega keywords para revisar.', 400);
  const max = Math.min(input.maxSearches ?? 30, GAP_MAX_SEARCHES);
  if (keywords.length > max) throw new WorkflowError('TOO_MANY_KEYWORDS', `Son ${keywords.length} keywords y el límite de búsquedas es ${max}. Quita algunas o sube el límite.`, 400);
  const running = await prisma.contentGap.findFirst({ where: { siteId, status: 'running', createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } } });
  if (running) throw new WorkflowError('GAP_RUNNING', 'Ya hay un análisis de brechas en curso para este sitio.', 409);
  return prisma.contentGap.create({ data: { siteId, competitors: json(competitors), keywords: json({ list: keywords, expand: input.expand ?? true, max }) } });
}

export async function runContentGapJob(id: string, opts: { log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const log = opts.log ?? (() => undefined);
  const g = await prisma.contentGap.findUniqueOrThrow({ where: { id }, include: { site: true } });
  try {
    const client = await serpClient(g.site.workspaceId);
    const m = await prisma.siteMonitor.upsert({ where: { siteId: g.siteId }, create: { siteId: g.siteId }, update: {} });
    const host = domainOf(g.site.canonicalUrl);
    const competitors = g.competitors as string[];
    const cfg = g.keywords as { list: string[]; expand: boolean; max: number };
    const tracked = new Set((await prisma.serpKeyword.findMany({ where: { siteId: g.siteId }, select: { keyword: true } })).map(k => norm(k.keyword)));
    const imp = await latestGscImport(g.siteId);
    const gscRows = imp ? await prisma.gscQueryStat.groupBy({ by: ['query'], where: { importId: imp.id }, _sum: { impressions: true }, _min: { position: true } }) : [];
    const gsc = new Map(gscRows.map(r => [norm(r.query), { position: r._min.position, impressions: r._sum.impressions ?? 0 }]));

    const queue: Array<{ keyword: string; source: GapKeyword['source'] }> = cfg.list.map(k => ({ keyword: k, source: gsc.has(norm(k)) ? 'gsc' : tracked.has(norm(k)) ? 'tracked' : 'manual' }));
    const seen = new Set(queue.map(q => norm(q.keyword)));
    const out: GapKeyword[] = [];
    let failed = 0;
    for (let i = 0; i < queue.length && out.length + failed < cfg.max; i++) {
      if (opts.signal?.aborted) throw new Error('Cancelado');
      const { keyword, source } = queue[i];
      try {
        const r = await client.search(keyword, { gl: m.serpGl, hl: m.serpHl });
        const top = r.organic.slice(0, 10);
        const own = top.find(o => owns(o.domain, host));
        const comp: GapKeyword['competitors'] = {};
        for (const c of competitors) {
          const hit = top.find(o => owns(o.domain, c));
          if (hit) comp[c] = { position: hit.position, url: hit.url, title: hit.title };
        }
        const gs = gsc.get(norm(keyword));
        const base = { ownPosition: own?.position ?? null, gscPosition: gs?.position ?? null, competitors: comp };
        out.push({ keyword, source, ...base, ownUrl: own?.url ?? null, gscImpressions: gs?.impressions ?? null, top: top.map(o => ({ position: o.position, domain: o.domain, url: o.url, title: o.title, ...(o.snippet ? { snippet: o.snippet } : {}) })), questions: r.questions ?? [], features: r.features, ...classifyGap(base) });
        // One level of expansion: related searches of keywords where a competitor ranks.
        if (cfg.expand && source !== 'related' && Object.keys(comp).length)
          for (const rel of (r.related ?? []).slice(0, 4))
            if (!seen.has(norm(rel))) {
              seen.add(norm(rel));
              queue.push({ keyword: rel.toLowerCase(), source: 'related' });
            }
      } catch (e) {
        if (e instanceof SerpError && e.code !== 'PROVIDER_ERROR') throw new WorkflowError(`SERPAPI_${e.code}`, e.message, e.code === 'AUTH' ? 400 : 429);
        failed++;
        log(`"${keyword}": ${(e as Error).message}`);
      }
      log(`${out.length + failed} búsquedas`);
    }
    const result: GapResult = {
      searched: out.length,
      failed,
      keywords: out.sort((a, b) => b.score - a.score),
      clusters: clusterGaps(out),
      competitors: competitors.map(c => {
        const pos = out.map(k => k.competitors[c]?.position).filter((p): p is number => p !== undefined);
        return { domain: c, top10: pos.length, gaps: out.filter(k => (k.kind === 'missing' || k.kind === 'weak') && k.competitors[c]).length, avgPosition: pos.length ? Math.round((pos.reduce((s, p) => s + p, 0) / pos.length) * 10) / 10 : null };
      }),
      briefs: {}
    };
    const done = await prisma.contentGap.update({ where: { id }, data: { status: 'completed', result: json(result), completedAt: new Date() } });
    await recordAuditEvent({ workspaceId: g.site.workspaceId, userId: null, action: 'content_gap.completed', entity: 'ContentGap', entityId: id, details: { searched: out.length, clusters: result.clusters.length } });
    return done;
  } catch (e) {
    await prisma.contentGap.update({ where: { id }, data: { status: 'failed', error: (e as Error).message.slice(0, 1000), completedAt: new Date() } });
    throw e;
  }
}

export async function latestContentGap(siteId: string) {
  return prisma.contentGap.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } });
}

/** An outline built from the competitors' titles and the "People also ask" questions (no AI). */
function manualBrief(c: GapCluster, siteName: string): GapBrief {
  const md = [
    `# ${c.lead.charAt(0).toUpperCase()}${c.lead.slice(1)}`,
    '',
    c.ownUrl ? `**Acción:** mejorar la página que ya tienes (${c.ownUrl}) para cubrir este tema.` : `**Acción:** crear una página nueva en ${siteName}.`,
    '',
    `**Keyword principal:** ${c.lead}`,
    c.keywords.length > 1 ? `**Keywords relacionadas (misma intención):** ${c.keywords.slice(1).join(', ')}` : '',
    '',
    '## Preguntas que debe responder',
    ...(c.questions.length ? c.questions.map(q => `- ${q}`) : ['- (Google no mostró "Más preguntas" para estas búsquedas)']),
    '',
    '## Lo que publica la competencia',
    ...c.competitorPages.map(p => `- #${p.position} ${p.domain}: [${p.title}](${p.url})`),
    '',
    '## Estructura sugerida',
    '- Primer párrafo que responda directo a la keyword principal.',
    ...c.questions.slice(0, 6).map(q => `- H2: ${q}`),
    '- Algo que la competencia no tenga: datos propios, precios, casos, fotos o una tabla comparativa.',
    '- Llamada a la acción clara y enlaces internos a tus páginas de servicio relacionadas.'
  ].filter(l => l !== undefined);
  return { source: 'manual', title: c.lead, markdown: md.join('\n').replace(/\n{3,}/g, '\n\n'), createdAt: new Date().toISOString() };
}

export async function createGapBrief(id: string, clusterId: string, opts: { useAi: boolean }, actorUserId: string | null) {
  const g = await prisma.contentGap.findUniqueOrThrow({ where: { id }, include: { site: true } });
  const result = g.result as GapResult | null;
  const c = result?.clusters.find(x => x.id === clusterId);
  if (!result || !c) throw new WorkflowError('CLUSTER_NOT_FOUND', 'Ese grupo de keywords no existe en este análisis.', 404);
  let brief: GapBrief;
  if (!opts.useAi) brief = manualBrief(c, g.site.name);
  else {
    const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId: g.site.workspaceId, provider: 'anthropic' } } });
    if (!key) throw new WorkflowError('AI_KEY_MISSING', 'Agrega una clave de Anthropic en Configuración para generar briefs con IA, o usa el brief sin IA.', 400);
    const kws = result.keywords.filter(k => c.keywords.includes(k.keyword));
    const system =
      'Eres estratega de contenido SEO senior. Escribes briefs de contenido accionables para un redactor, en el idioma de las keywords. ' +
      'Usa solo la información dada (resultados de Google, preguntas, datos del sitio); no inventes cifras ni datos del negocio: donde haga falta un dato propio escribe [DATO DEL CLIENTE]. ' +
      'Formato Markdown: # Título SEO propuesto (máx. 60 caracteres), luego secciones: **Intención de búsqueda**, **Acción** (página nueva o mejorar la existente), **Keywords** (principal y secundarias), ' +
      '**Meta description** propuesta (máx. 155 caracteres), **Estructura** (H2/H3 con 1-2 líneas de qué va en cada uno), **Preguntas a responder**, **Qué tienen los competidores y cómo superarlos** (ganancia de información: qué aportar que ellos no tengan), ' +
      '**Schema recomendado**, **Enlaces internos sugeridos**, **Extensión orientativa**.';
    const content = [
      `Sitio: ${g.site.name} (${g.site.canonicalUrl})`,
      c.ownUrl ? `Página propia que ya rankea en parte: ${c.ownUrl}` : 'El sitio no tiene una página que rankee para este tema.',
      `Keywords del grupo: ${c.keywords.join(' · ')}`,
      `Preguntas de Google ("Más preguntas"): ${c.questions.join(' · ') || '(ninguna)'}`,
      '',
      'Top 10 de Google por keyword:',
      ...kws.slice(0, 5).flatMap(k => [`- "${k.keyword}"${k.features.length ? ` [bloques: ${k.features.join(', ')}]` : ''}`, ...k.top.map(t => `  ${t.position}. ${t.domain} — ${t.title}${t.snippet ? ` — ${t.snippet}` : ''}`)])
    ].join('\n');
    try {
      const r = await analyzeWithClaude(decryptSecret(key.keyEnc), system, content);
      const title = /^#\s+(.+)$/m.exec(r.text)?.[1]?.trim() ?? c.lead;
      brief = { source: 'ai', model: r.model, title, markdown: r.text.trim(), createdAt: new Date().toISOString() };
    } catch (e) {
      if (e instanceof AiError) throw new WorkflowError(`AI_${e.code}`, e.message, e.code === 'AUTH' ? 400 : e.code === 'RATE_LIMIT' ? 429 : 502);
      throw e;
    }
  }
  // Re-read so a brief written meanwhile for another group is not lost.
  const fresh = (await prisma.contentGap.findUniqueOrThrow({ where: { id } })).result as unknown as GapResult;
  await prisma.contentGap.update({ where: { id }, data: { result: json({ ...fresh, briefs: { ...fresh.briefs, [clusterId]: brief } }) } });
  await recordAuditEvent({ workspaceId: g.site.workspaceId, userId: actorUserId, action: 'content_gap.brief', entity: 'ContentGap', entityId: id, details: { cluster: c.lead, source: brief.source } });
  return brief;
}
