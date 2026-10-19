import zlib from 'zlib';
import { decryptSecret } from '@glitch/core';
import { AiError, WordPressError, WordPressSeoClient, analyzeWithClaude } from '@glitch/connectors';
import { fetchWithRedirects, htmlToMarkdown, type Block } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent, currentActorId } from './audit';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';
import { cannibalizationReport } from './cannibalization-service';
import { duplicateContentReport } from './content-analysis-service';

/**
 * "Consolidación": two pages that compete for the same searches (or say almost the same) become one.
 * draft (AI or manual) → approved → applied (winner body replaced in WordPress, 301 from the other URL) → reverted.
 * The winner's previous title and body are kept to revert; nothing is published without approval.
 */

const allowHosts = () => (process.env.CRAWL_ALLOW_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const wpError = (e: unknown) => (e instanceof WordPressError ? `${e.code}: ${e.message}` : (e as Error).message);

async function wpClient(siteId: string) {
  const c = await prisma.wordPressConnection.findUnique({ where: { siteId } });
  if (!c) throw new WorkflowError('NO_CONNECTION', 'Conecta WordPress para este sitio primero.', 400);
  return new WordPressSeoClient({ baseUrl: c.endpointUrl, username: c.username, appPassword: decryptSecret(c.appPasswordEnc), allowHosts: allowHosts() });
}

/** Pairs worth consolidating: cannibalization (same searches) and near-duplicate content. */
export async function consolidationCandidates(siteId: string) {
  const [cannibal, dup] = await Promise.all([cannibalizationReport(siteId).catch(() => null), duplicateContentReport(siteId).catch(() => null)]);
  const out = new Map<string, { a: string; b: string; reasons: string[]; queries: string[]; impressions: number; similarity: number | null }>();
  const add = (a: string, b: string, reason: string, extra: { queries?: string[]; impressions?: number; similarity?: number } = {}) => {
    const [x, y] = [a, b].sort();
    const k = `${gscKey(x)}|${gscKey(y)}`;
    const e = out.get(k) ?? { a: x, b: y, reasons: [], queries: [], impressions: 0, similarity: null };
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    e.queries = [...new Set([...e.queries, ...(extra.queries ?? [])])].slice(0, 20);
    e.impressions += extra.impressions ?? 0;
    if (extra.similarity !== undefined) e.similarity = extra.similarity;
    out.set(k, e);
  };
  for (const p of cannibal?.pairs ?? []) add(p.a, p.b, `compiten en ${p.count} búsquedas`, { queries: p.queries, impressions: p.impressions });
  for (const c of cannibal?.conflicts ?? []) if (c.severity === 'alta' && c.pages.length >= 2) add(c.pages[0].page, c.pages[1].page, 'canibalización alta', { queries: [c.query], impressions: c.impressions });
  for (const g of [...(dup?.near ?? []), ...(dup?.exact ?? [])]) for (const p of g.pages.filter(x => x.status === 'pendiente')) add(g.keeper.url, p.url, g.similarity === 100 ? 'texto duplicado' : `texto ${g.similarity} % igual`, { similarity: g.similarity });
  return [...out.values()].sort((a, b) => b.reasons.length - a.reasons.length || b.impressions - a.impressions).slice(0, 100);
}

/** Who should win: more clicks, then more internal links, then the shorter URL. */
async function pickWinner(siteId: string, a: string, b: string) {
  const imp = await latestGscImport(siteId);
  const g = imp ? new Map((await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true } })).map(p => [gscKey(p.page), p.clicks])) : new Map<string, number>();
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
  const inl = run ? new Map((await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, url: { in: [a, b] } }, select: { url: true, inlinks: true } })).map(p => [p.url, p.inlinks])) : new Map<string, number>();
  const score = (u: string) => [g.get(gscKey(u)) ?? 0, inl.get(u) ?? 0, -u.length];
  const [sa, sb] = [score(a), score(b)];
  for (let i = 0; i < 3; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i] ? [a, b] : [b, a];
  return [a, b];
}

export async function createConsolidation(siteId: string, input: { a: string; b: string; winnerUrl?: string; queries?: string[] }) {
  if (gscKey(input.a) === gscKey(input.b)) throw new WorkflowError('SAME_URL', 'Elige dos páginas distintas.', 400);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const [winner, loser] = input.winnerUrl ? (gscKey(input.winnerUrl) === gscKey(input.a) ? [input.a, input.b] : [input.b, input.a]) : await pickWinner(siteId, input.a, input.b);
  const open = await prisma.consolidation.findFirst({ where: { siteId, status: { in: ['draft', 'approved'] }, OR: [{ winnerUrl: { in: [winner, loser] } }, { loserUrl: { in: [winner, loser] } }] } });
  if (open) throw new WorkflowError('PENDING_EXISTS', 'Ya hay una consolidación abierta con una de estas páginas.', 409, { consolidationId: open.id });
  const c = await prisma.consolidation.create({ data: { siteId, winnerUrl: winner, loserUrl: loser, queries: (input.queries ?? []) as object, createdById: currentActorId() } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: null, action: 'consolidation.created', entity: 'Consolidation', entityId: c.id, details: { winner, loser } });
  return c;
}

export async function listConsolidations(siteId: string) {
  return prisma.consolidation.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, take: 100, omit: { winnerBackup: true, draftHtml: true } });
}

async function load(id: string) {
  const c = await prisma.consolidation.findUnique({ where: { id }, include: { site: true } });
  if (!c) throw new WorkflowError('CONSOLIDATION_NOT_FOUND', 'Esa consolidación no existe.', 404);
  return c;
}

/** Both pages as clean Markdown (from the latest crawl) and their search queries. */
async function sources(siteId: string, urls: string[]) {
  const run = await prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', detailPurgedAt: null }, orderBy: { startedAt: 'desc' } });
  const pages = run ? await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, url: { in: urls } }, select: { url: true, title: true, htmlGz: true } }) : [];
  const imp = await latestGscImport(siteId);
  const q = imp ? await prisma.gscQueryStat.findMany({ where: { importId: imp.id }, select: { page: true, query: true, clicks: true, impressions: true, position: true }, orderBy: { impressions: 'desc' } }) : [];
  const out = [];
  for (const url of urls) {
    const p = pages.find(x => x.url === url);
    let html = p?.htmlGz ? zlib.gunzipSync(Buffer.from(p.htmlGz)).toString('utf8') : null;
    if (!html) {
      // Not in the latest crawl: read the live page.
      const r = await fetchWithRedirects(url, { userAgent: 'G.SEO (+consolidación)', timeoutMs: 15_000, allowHosts: allowHosts(), maxBodyBytes: 3_000_000 }).catch(() => null);
      if (r && r.status >= 200 && r.status < 300 && r.body) html = r.body;
    }
    const md = html ? htmlToMarkdown(html, url) : null;
    out.push({ url, title: p?.title ?? md?.title ?? null, markdown: md?.markdown ?? '', blocks: md?.blocks ?? [], words: md?.words ?? 0, queries: q.filter(r => gscKey(r.page) === gscKey(url)).slice(0, 15).map(r => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 })) });
  }
  return out;
}

export async function getConsolidation(id: string) {
  const c = await load(id);
  const [winner, loser] = await sources(c.siteId, [c.winnerUrl, c.loserUrl]);
  const { site: _s, winnerBackup: _b, ...rest } = c;
  void _s;
  void _b;
  return { ...rest, hasBackup: !!c.winnerBackup, winner: { ...winner, blocks: undefined }, loser: { ...loser, blocks: undefined } };
}

// ---------------------------------------------------------------- drafts

const inlineHtml = (md: string) =>
  md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${String(u).replace(/"/g, '&quot;')}">${t}</a>`);
function blocksToHtml(blocks: Block[]) {
  return blocks
    .map(b => {
      if (b.type === 'heading') return `<h${Math.max(2, b.level ?? 2)}>${inlineHtml(b.text)}</h${Math.max(2, b.level ?? 2)}>`;
      if (b.type === 'list') return `<ul>${(b.parts ?? [b.md]).map(i => `<li>${inlineHtml(i.replace(/^\s*(?:-|\d+\.)\s*/, ''))}</li>`).join('')}</ul>`;
      if (b.type === 'table') {
        const rows = (b.parts ?? []).map(r => r.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/));
        return `<table>${rows.map((r, i) => `<tr>${r.map(c => (i === 0 ? `<th>${inlineHtml(c)}</th>` : `<td>${inlineHtml(c)}</td>`)).join('')}</tr>`).join('')}</table>`;
      }
      if (b.type === 'quote') return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
      if (b.type === 'code') return `<pre>${b.text.replace(/</g, '&lt;')}</pre>`;
      return `<p>${inlineHtml(b.md)}</p>`;
    })
    .join('\n');
}

/** Starting point to write by hand: the winner's content, then the other page's content to pick from. */
export async function manualDraft(id: string) {
  const c = await load(id);
  if (c.status !== 'draft') throw new WorkflowError('NOT_DRAFT', 'Solo se edita una consolidación en borrador.');
  const [w, l] = await sources(c.siteId, [c.winnerUrl, c.loserUrl]);
  const drop = (bs: Block[]) => bs.filter((b, i) => !(i === 0 && b.type === 'heading' && b.level === 1));
  const html = `${blocksToHtml(drop(w.blocks))}\n<!-- G.SEO: contenido de ${pathOf(c.loserUrl)} para integrar (borra lo que no uses) -->\n${blocksToHtml(drop(l.blocks))}`;
  return prisma.consolidation.update({ where: { id }, data: { draftTitle: c.draftTitle ?? w.title, draftHtml: html, aiModel: null }, omit: { winnerBackup: true } });
}

/** Claude writes the merged page from both sources, without inventing facts. */
export async function aiDraft(id: string, actorUserId: string | null) {
  const c = await load(id);
  if (c.status !== 'draft') throw new WorkflowError('NOT_DRAFT', 'Solo se redacta una consolidación en borrador.');
  const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId: c.site.workspaceId, provider: 'anthropic' } } });
  if (!key) throw new WorkflowError('AI_KEY_MISSING', 'Agrega una clave de Anthropic en Configuración para redactar con IA, o usa "Armar borrador a mano".', 400);
  const [w, l] = await sources(c.siteId, [c.winnerUrl, c.loserUrl]);
  if (!w.words && !l.words) throw new WorkflowError('NO_CONTENT', 'No hay contenido guardado de estas páginas. Haz un crawl nuevo.', 409);
  const queries = [...new Set([...(c.queries as string[]), ...w.queries.map(q => q.query), ...l.queries.map(q => q.query)])].slice(0, 25);
  const system =
    'Eres editor SEO senior. Fusionas dos páginas de un mismo sitio que compiten por las mismas búsquedas en una sola página más completa. Escribe en el idioma de las páginas. ' +
    'Reglas: 1) Usa SOLO información que esté en las dos páginas; no inventes datos, cifras, precios, nombres ni promesas. 2) Conserva lo mejor y más específico de cada una y elimina repeticiones. ' +
    '3) Estructura para responder las búsquedas indicadas: un primer párrafo que responda directo, luego secciones H2/H3 (algunas en forma de pregunta), listas y tablas cuando ayuden. ' +
    '4) Conserva los enlaces que existan, con sus URL exactas. 5) Formato de salida EXACTO:\nTÍTULO: <título de la página, máx. 60 caracteres>\n---\n<cuerpo en HTML simple: h2, h3, p, ul, ol, li, table, tr, th, td, strong, em, a; sin h1, sin estilos, sin scripts>\n---\nNOTAS: <3-6 viñetas de qué tomaste de cada página y qué quitaste>';
  const content = [
    `Búsquedas que debe cubrir: ${queries.join(' · ') || '(sin datos de Search Console)'}`,
    '',
    `PÁGINA GANADORA (${c.winnerUrl}) — título: ${w.title ?? ''}`,
    w.markdown.slice(0, 40_000),
    '',
    `PÁGINA QUE SE REDIRIGE (${c.loserUrl}) — título: ${l.title ?? ''}`,
    l.markdown.slice(0, 40_000)
  ].join('\n');
  let r: { text: string; model: string };
  try {
    r = await analyzeWithClaude(decryptSecret(key.keyEnc), system, content);
  } catch (e) {
    if (e instanceof AiError) throw new WorkflowError(`AI_${e.code}`, e.message, e.code === 'AUTH' ? 400 : e.code === 'RATE_LIMIT' ? 429 : 502);
    throw e;
  }
  const m = /T[IÍ]TULO:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]*?)\n-{3,}\s*\n?\s*NOTAS:\s*([\s\S]*)$/i.exec(r.text.trim());
  const title = (m?.[1] ?? w.title ?? '').trim().slice(0, 200);
  const body = (m?.[2] ?? r.text).trim().replace(/<\/?(script|style|iframe|h1)[^>]*>/gi, '');
  const notes = (m?.[3] ?? '').trim();
  const html = notes ? `${body}\n<!-- G.SEO (notas de la fusión, puedes borrarlas):\n${notes.replace(/--/g, '—')}\n-->` : body;
  const updated = await prisma.consolidation.update({ where: { id }, data: { draftTitle: title, draftHtml: html, aiModel: r.model }, omit: { winnerBackup: true } });
  await recordAuditEvent({ workspaceId: c.site.workspaceId, userId: actorUserId, action: 'consolidation.ai_draft', entity: 'Consolidation', entityId: id, details: { model: r.model } });
  return updated;
}

export async function saveDraft(id: string, input: { title?: string; html?: string; winnerUrl?: string }) {
  const c = await load(id);
  if (c.status !== 'draft') throw new WorkflowError('NOT_DRAFT', 'Solo se edita una consolidación en borrador.');
  const swap = input.winnerUrl && gscKey(input.winnerUrl) === gscKey(c.loserUrl);
  return prisma.consolidation.update({
    where: { id },
    data: { ...(input.title !== undefined ? { draftTitle: input.title } : {}), ...(input.html !== undefined ? { draftHtml: input.html } : {}), ...(swap ? { winnerUrl: c.loserUrl, loserUrl: c.winnerUrl } : {}) },
    omit: { winnerBackup: true }
  });
}

export async function approveConsolidation(id: string) {
  const c = await load(id);
  if (c.status !== 'draft') throw new WorkflowError('NOT_DRAFT', 'Solo se aprueba un borrador.');
  if (!c.draftHtml?.trim()) throw new WorkflowError('EMPTY_DRAFT', 'El borrador está vacío.', 400);
  const u = await prisma.consolidation.update({ where: { id }, data: { status: 'approved' }, omit: { winnerBackup: true } });
  await recordAuditEvent({ workspaceId: c.site.workspaceId, userId: null, action: 'consolidation.approved', entity: 'Consolidation', entityId: id });
  return u;
}

export async function discardConsolidation(id: string) {
  const c = await load(id);
  if (!['draft', 'approved', 'failed'].includes(c.status)) throw new WorkflowError('CANNOT_DISCARD', 'Una consolidación aplicada se revierte, no se descarta.');
  await prisma.consolidation.delete({ where: { id } });
  return { deleted: true };
}

/** Replaces the winner in WordPress (keeping a backup) and redirects the other URL to it. */
export async function applyConsolidation(id: string) {
  const c = await load(id);
  if (c.status !== 'approved') throw new WorkflowError('NOT_APPROVED', 'Primero aprueba el borrador.');
  const client = await wpClient(c.siteId);
  let target: 'post' | 'page';
  let wpId: number;
  let backup: { content: string; title: string };
  try {
    const item = await client.findByUrl(c.winnerUrl);
    if (!item) throw new WorkflowError('WP_ITEM_NOT_FOUND', 'No se encontró en WordPress la entrada o página ganadora.', 404);
    target = item.type as 'post' | 'page';
    wpId = item.id;
    backup = { content: (await client.getContent(target, wpId)).raw, title: item.title };
    await prisma.consolidation.update({ where: { id }, data: { winnerTarget: target, winnerWpId: wpId, winnerBackup: JSON.stringify(backup) } });
    await client.updateContent(target, wpId, c.draftHtml!);
    if (c.draftTitle && c.draftTitle !== item.title) await client.updateSeoFields(target, wpId, { title: c.draftTitle });
  } catch (e) {
    if (e instanceof WorkflowError) throw e;
    await prisma.consolidation.update({ where: { id }, data: { status: 'failed', error: wpError(e) } });
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  }
  // The 301: in WordPress when the Redirection plugin is there; otherwise it is left to export.
  let redirectId: number | null = null;
  let method = 'export';
  let note: string | null = null;
  if (await client.hasRedirectionPlugin()) {
    try {
      redirectId = (await client.createRedirect(pathOf(c.loserUrl), c.winnerUrl)).id;
      method = 'wordpress';
    } catch (e) {
      note = `El contenido se aplicó, pero no se pudo crear la 301: ${wpError(e)}. Créala a mano o expórtala.`;
    }
  } else note = 'El contenido se aplicó. Falta la 301: instala el plugin Redirection o usa la regla para .htaccess / Nginx.';
  const u = await prisma.consolidation.update({ where: { id }, data: { status: 'applied', appliedAt: new Date(), redirectId, redirectMethod: method, error: note }, omit: { winnerBackup: true } });
  await recordAuditEvent({ workspaceId: c.site.workspaceId, userId: null, action: 'consolidation.applied', entity: 'Consolidation', entityId: id, details: { winner: c.winnerUrl, loser: c.loserUrl, redirect: method } });
  return { ...u, redirectRule: { from: pathOf(c.loserUrl), to: c.winnerUrl, htaccess: `Redirect 301 ${pathOf(c.loserUrl)} ${c.winnerUrl}`, nginx: `location = ${pathOf(c.loserUrl).split('?')[0]} { return 301 ${c.winnerUrl}; }` } };
}

/** Restores the winner's previous body and title (only if nobody changed it since) and removes the 301. */
export async function revertConsolidation(id: string) {
  const c = await load(id);
  if (c.status !== 'applied' || !c.winnerBackup || !c.winnerTarget || !c.winnerWpId) throw new WorkflowError('NOT_APPLIED', 'Solo se revierte una consolidación aplicada.');
  const client = await wpClient(c.siteId);
  const t = c.winnerTarget as 'post' | 'page';
  const backup = JSON.parse(c.winnerBackup) as { content: string; title: string };
  const current = await client.getContent(t, c.winnerWpId).catch(e => {
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  });
  if (current.raw !== c.draftHtml) throw new WorkflowError('REMOTE_CHANGED', 'La página cambió en WordPress después de aplicar la fusión; no se revierte para no perder esos cambios.', 409);
  try {
    await client.updateContent(t, c.winnerWpId, backup.content);
    if (c.draftTitle && c.draftTitle !== backup.title) await client.updateSeoFields(t, c.winnerWpId, { title: backup.title });
  } catch (e) {
    throw new WorkflowError('WORDPRESS_ERROR', wpError(e), 502);
  }
  let note: string | null = null;
  if (c.redirectId) {
    try {
      await client.deleteRedirect(c.redirectId);
    } catch (e) {
      note = `El contenido se restauró, pero no se pudo borrar la 301 (${wpError(e)}). Quítala en Herramientas → Redirection.`;
    }
  }
  const u = await prisma.consolidation.update({ where: { id }, data: { status: 'reverted', error: note }, omit: { winnerBackup: true } });
  await recordAuditEvent({ workspaceId: c.site.workspaceId, userId: null, action: 'consolidation.reverted', entity: 'Consolidation', entityId: id });
  return u;
}
