import zlib from 'zlib';
import * as cheerio from 'cheerio';
import { decryptSecret } from '@glitch/core';
import { WordPressSeoClient } from '@glitch/connectors';
import { AGENT_CHECKS, agentTasks, assertSafeUrl, auditAgentPages, type AgentPageResult } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';
import { getEntityOrg } from './entity-service';

/**
 * Agentic Web Optimization:
 * 1) "Navegación de agentes": Chrome opens the key pages and checks whether an autonomous agent can find prices,
 *    fill the contact form and use the main call to action (see packages/crawler/src/agent-audit.ts).
 * 2) "Catálogo para agentes": services/products/prices/contact as structured data, published in WordPress
 *    (docs/wordpress/glitch-agents.php) as /.well-known/agent.json, a JSON catalog and an MCP server.
 */

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
};
const KEY_PAGE = /(contacto|contact|precio|pricing|tarifa|planes|servicio|service|tienda|shop|producto|product|cotiz|presupuesto|reserv|agenda|cita|carrito|cart|checkout)/i;

// ---------------------------------------------------------------- 1) agent navigation audit

/** Home + pages an agent would need (contact, prices, services, shop), plus the most visited ones. */
export async function suggestAgentAuditUrls(siteId: string, max = 8) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const urls = [site.canonicalUrl.replace(/\/?$/, '/')];
  if (run) {
    const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true, mimeType: { contains: 'html' } }, select: { url: true, depth: true }, orderBy: { depth: 'asc' }, take: 3000 });
    const imp = await latestGscImport(siteId);
    const clicks = new Map((imp ? await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true } }) : []).map(p => [gscKey(p.page), p.clicks]));
    const key = pages.filter(p => KEY_PAGE.test(p.url)).sort((a, b) => (clicks.get(gscKey(b.url)) ?? 0) - (clicks.get(gscKey(a.url)) ?? 0) || a.depth - b.depth);
    const popular = [...pages].sort((a, b) => (clicks.get(gscKey(b.url)) ?? 0) - (clicks.get(gscKey(a.url)) ?? 0));
    for (const p of [...key, ...popular]) if (!urls.some(u => gscKey(u) === gscKey(p.url)) && urls.length < max) urls.push(p.url);
  }
  return urls;
}

export async function startAgentAudit(siteId: string, urls?: string[]) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const host = new URL(site.canonicalUrl).hostname.replace(/^www\./, '');
  const list = (urls?.length ? urls : await suggestAgentAuditUrls(siteId)).slice(0, 15);
  for (const u of list) {
    let h = '';
    try {
      h = new URL(u).hostname.replace(/^www\./, '');
    } catch {
      /* invalid */
    }
    if (h !== host) throw new WorkflowError('FOREIGN_URL', `Solo se revisan páginas de ${host}.`, 400);
  }
  const running = await prisma.agentAudit.findFirst({ where: { siteId, status: 'running', createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
  if (running) throw new WorkflowError('AGENT_AUDIT_RUNNING', 'Ya hay una revisión de agentes en curso.', 409);
  return prisma.agentAudit.create({ data: { siteId, urls: list } });
}

export async function runAgentAuditJob(auditId: string, log: (m: string) => void = () => undefined) {
  const a = await prisma.agentAudit.findUniqueOrThrow({ where: { id: auditId } });
  try {
    const pages = await auditAgentPages(a.urls as string[], { allowHosts: allowHosts() });
    const summary = summarize(pages);
    log(`${pages.length} páginas revisadas, puntaje ${summary.average}`);
    return await prisma.agentAudit.update({ where: { id: auditId }, data: { status: 'completed', pages: pages as unknown as object, summary: summary as unknown as object, completedAt: new Date() } });
  } catch (e) {
    await prisma.agentAudit.update({ where: { id: auditId }, data: { status: 'failed', error: (e as Error).message.slice(0, 500), completedAt: new Date() } });
    throw e;
  }
}

function summarize(pages: AgentPageResult[]) {
  const ok = pages.filter(p => p.checks.length);
  const byCheck = (Object.keys(AGENT_CHECKS) as Array<keyof typeof AGENT_CHECKS>).map(id => {
    const rows = ok.map(p => p.checks.find(c => c.id === id)).filter(c => c && c.score !== null);
    const failing = rows.filter(c => (c!.score as number) < 1).length;
    return { id, label: AGENT_CHECKS[id].label, weight: AGENT_CHECKS[id].weight, applies: rows.length, failing };
  });
  return { average: ok.length ? Math.round(ok.reduce((n, p) => n + p.score, 0) / ok.length) : 0, pages: pages.length, tasks: agentTasks(ok), byCheck };
}

export async function latestAgentAudit(siteId: string) {
  const a = await prisma.agentAudit.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } });
  return { audit: a, checks: AGENT_CHECKS, suggestedUrls: await suggestAgentAuditUrls(siteId) };
}

// ---------------------------------------------------------------- 2) catalog for agents

export interface CatalogItem {
  id: string;
  kind: 'service' | 'product';
  name: string;
  description?: string;
  url?: string;
  price?: number | null;
  currency?: string;
  priceText?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder' | 'OnRequest' | null;
  category?: string;
}
export interface CatalogBusiness {
  name: string;
  description?: string;
  url: string;
  email?: string;
  phone?: string;
  address?: string;
  hours?: string;
  areaServed?: string;
  languages?: string[];
  quoteUrl?: string;
  bookingUrl?: string;
  contactUrl?: string;
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

/** Products, services and offers found in the JSON-LD of the latest crawl. */
async function catalogFromCrawl(siteId: string): Promise<CatalogItem[]> {
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', detailPurgedAt: null }, orderBy: { startedAt: 'desc' } });
  if (!run) return [];
  const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, htmlGz: { not: null } }, select: { url: true, htmlGz: true }, take: 500 });
  const out = new Map<string, CatalogItem>();
  for (const p of pages) {
    const $ = cheerio.load(zlib.gunzipSync(Buffer.from(p.htmlGz!)).toString('utf8'));
    const nodes: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          nodes.push(v as Record<string, unknown>);
          Object.values(v).forEach(walk);
        }
      };
      try {
        walk(JSON.parse($(el).text()));
      } catch {
        /* invalid JSON-LD */
      }
    });
    for (const n of nodes) {
      const types = [n['@type']].flat().filter((t): t is string => typeof t === 'string');
      const kind = types.some(t => /Product/.test(t)) ? 'product' : types.some(t => /Service|Offer$|Course|Event/.test(t)) && n.name ? 'service' : null;
      if (!kind || typeof n.name !== 'string') continue;
      const offer = [n.offers].flat().find(o => o && typeof o === 'object') as Record<string, unknown> | undefined;
      const price = offer?.price !== undefined ? Number(offer.price) : offer?.lowPrice !== undefined ? Number(offer.lowPrice) : null;
      const item: CatalogItem = {
        id: slug(n.name),
        kind,
        name: n.name.slice(0, 200),
        description: typeof n.description === 'string' ? n.description.slice(0, 500) : undefined,
        url: typeof n.url === 'string' ? n.url : p.url,
        price: Number.isFinite(price) ? price : null,
        currency: typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : undefined,
        availability: typeof offer?.availability === 'string' ? ((offer.availability as string).split('/').pop() as CatalogItem['availability']) : null
      };
      if (!out.has(item.id)) out.set(item.id, item);
    }
  }
  return [...out.values()].slice(0, 200);
}

export async function getAgentCatalog(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const saved = await prisma.agentCatalog.findUnique({ where: { siteId } });
  const org = await getEntityOrg(siteId).catch(() => null);
  const suggestedBusiness: CatalogBusiness = {
    name: org?.name ?? site.name,
    description: org?.description,
    url: site.canonicalUrl.replace(/\/?$/, '/'),
    email: org?.email,
    phone: org?.telephone,
    address: org?.address ? [org.address.streetAddress, org.address.addressLocality, org.address.addressRegion, org.address.addressCountry].filter(Boolean).join(', ') : undefined
  };
  const fromCrawl = await catalogFromCrawl(siteId);
  return {
    saved: !!saved,
    updatedAt: saved?.updatedAt ?? null,
    business: saved ? (saved.business as unknown as CatalogBusiness) : suggestedBusiness,
    items: saved ? (saved.items as unknown as CatalogItem[]) : fromCrawl,
    suggestions: { business: suggestedBusiness, items: fromCrawl }
  };
}

export async function saveAgentCatalog(siteId: string, input: { business: CatalogBusiness; items: CatalogItem[] }, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const ids = new Set<string>();
  const items = input.items.map(i => {
    let id = slug(i.id || i.name);
    for (let n = 2; ids.has(id); n++) id = `${slug(i.id || i.name)}-${n}`;
    ids.add(id);
    return { ...i, id };
  });
  const c = await prisma.agentCatalog.upsert({ where: { siteId }, create: { siteId, business: input.business as object, items: items as object }, update: { business: input.business as object, items: items as object } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'agent_catalog.saved', entity: 'Site', entityId: siteId, details: { items: items.length } });
  return { business: c.business, items: c.items, updatedAt: c.updatedAt };
}

/** What the WordPress plugin publishes, built from the saved catalog (also shown as a preview). */
export function buildAgentDocuments(business: CatalogBusiness, items: CatalogItem[]) {
  const origin = originOf(business.url);
  const catalog = { business, items, updated: new Date().toISOString() };
  const agent = {
    schema_version: 'gseo-agent/0.1',
    name: business.name,
    description: business.description ?? '',
    url: `${origin}/`,
    contact: { email: business.email ?? null, phone: business.phone ?? null, address: business.address ?? null, url: business.contactUrl ?? null },
    capabilities: ['business.info', 'catalog.search', 'catalog.get', 'contact.info'],
    endpoints: {
      catalog: `${origin}/wp-json/gseo/v1/catalog`,
      mcp: { url: `${origin}/wp-json/gseo/v1/mcp`, transport: 'streamable-http', tools: ['get_business_info', 'search_catalog', 'get_item', 'how_to_contact'] },
      llms_txt: `${origin}/llms.txt`
    },
    actions: { quote: business.quoteUrl ?? null, booking: business.bookingUrl ?? null },
    policies: { read_only: true, note: 'Information for AI agents. Purchases, bookings and quotes are completed on the website.' }
  };
  return { agent, catalog };
}

async function wpClient(siteId: string) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Conecta WordPress para este sitio primero.', 400);
  return new WordPressSeoClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() });
}

/** Sends the saved catalog to WordPress (option read by the glitch-agents.php plugin). */
export async function publishAgentCatalog(siteId: string, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const saved = await prisma.agentCatalog.findUnique({ where: { siteId } });
  if (!saved) throw new WorkflowError('NO_CATALOG', 'Guarda el catálogo antes de publicarlo.', 400);
  const client = await wpClient(siteId);
  try {
    await client.updateSetting('gseo_agent_catalog', JSON.stringify({ business: saved.business, items: saved.items, updated: saved.updatedAt.toISOString() }));
  } catch (e) {
    const msg = (e as Error).message;
    if (/rest_invalid_param|gseo_agent_catalog|404/i.test(msg)) throw new WorkflowError('AGENT_PLUGIN_MISSING', 'WordPress no reconoce el catálogo: instala el plugin docs/wordpress/glitch-agents.php en wp-content/mu-plugins/.', 400);
    if (/forbidden|cannot|permission|401|403/i.test(msg)) throw new WorkflowError('WP_PERMISSION', 'El usuario de WordPress conectado necesita permiso de administrador para guardar el catálogo.', 403);
    throw new WorkflowError('WORDPRESS_ERROR', msg, 502);
  }
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'agent_catalog.published', entity: 'Site', entityId: siteId });
  return validateAgentEndpoints(siteId);
}

/** Checks what agents see live: agent.json, the catalog and the MCP server (initialize, tools/list, a search). */
export async function validateAgentEndpoints(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const origin = originOf(site.canonicalUrl);
  const call = async (path: string, init?: { method?: string; body?: unknown }) => {
    // Pretty permalinks first (/wp-json/...), then the plain form (?rest_route=...).
    const urls = path.startsWith('/wp-json/') ? [`${origin}${path}`, `${origin}/?rest_route=${encodeURIComponent(path.slice('/wp-json'.length))}`] : [`${origin}${path}`];
    let last: { status: number; json: unknown; error?: string } = { status: 0, json: null };
    for (const u of urls) {
      try {
        await assertSafeUrl(u, { allowHosts: allowHosts() });
        const res = await fetch(u, { method: init?.method ?? 'GET', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), 'user-agent': 'G.SEO agent check' }, body: init?.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) });
        const text = await res.text();
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        last = { status: res.status, json };
        if (res.ok) return last;
      } catch (e) {
        last = { status: 0, json: null, error: (e as Error).message };
      }
    }
    return last;
  };
  const checks: Array<{ id: string; label: string; ok: boolean; detail: string }> = [];
  const agent = await call('/.well-known/agent.json');
  const a = agent.json as { name?: string; endpoints?: { mcp?: { url?: string } } } | null;
  checks.push({ id: 'agent_json', label: '/.well-known/agent.json', ok: agent.status === 200 && !!a?.name, detail: agent.status === 200 ? (a?.name ? `Publicado: ${a.name}.` : 'Responde, pero no es un manifiesto válido.') : `No disponible (${agent.error ?? `HTTP ${agent.status}`}).` });
  const cat = await call('/wp-json/gseo/v1/catalog');
  const c = cat.json as { items?: unknown[]; business?: { name?: string } } | null;
  checks.push({ id: 'catalog', label: 'Catálogo JSON', ok: cat.status === 200 && Array.isArray(c?.items), detail: cat.status === 200 && Array.isArray(c?.items) ? `${c!.items!.length} elemento(s).` : `No disponible (${cat.error ?? `HTTP ${cat.status}`}).` });
  const init = await call('/wp-json/gseo/v1/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'G.SEO', version: '1' } } } });
  const ir = init.json as { result?: { serverInfo?: { name?: string }; protocolVersion?: string } } | null;
  const tools = await call('/wp-json/gseo/v1/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  const tr = tools.json as { result?: { tools?: Array<{ name: string }> } } | null;
  const search = await call('/wp-json/gseo/v1/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_catalog', arguments: { query: '', limit: 3 } } } });
  const sr = search.json as { result?: { content?: Array<{ text?: string }>; isError?: boolean } } | null;
  checks.push({ id: 'mcp', label: 'Servidor MCP', ok: !!ir?.result?.serverInfo && !!tr?.result?.tools?.length && !!sr?.result?.content?.length && !sr.result.isError, detail: ir?.result?.serverInfo ? `${ir.result.serverInfo.name} (protocolo ${ir.result.protocolVersion}), herramientas: ${(tr?.result?.tools ?? []).map(t => t.name).join(', ') || 'ninguna'}.` : `No responde (${init.error ?? `HTTP ${init.status}`}).` });
  return { origin, checks, ok: checks.every(x => x.ok), mcpUrl: `${origin}/wp-json/gseo/v1/mcp` };
}
