import zlib from 'zlib';
import * as cheerio from 'cheerio';
import { buildEntityGraph, graphWarnings, type AuthorProfile, type EntityRef, type OrgProfile, type PageEntityInput } from '@glitch/schema-engine';
import { anchorCandidates } from '@glitch/crawler';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscKey, latestGscImport } from './gsc-service';

/**
 * Entity profile of a site (Organization + authors) and per-page entity data (type, author, Wikidata
 * entities), turned into one connected JSON-LD graph per page; plus an E-E-A-T audit over the crawl.
 */

const PAGE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'WebPage', 'AboutPage', 'ContactPage', 'ProfilePage', 'CollectionPage', 'FAQPage'] as const;
export type EntityPageType = (typeof PAGE_TYPES)[number];
export const ENTITY_PAGE_TYPES = PAGE_TYPES;

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'autor';
const toAuthor = (a: { id: string; name: string; slug: string; url: string | null; jobTitle: string | null; description: string | null; image: string | null; sameAs: unknown; knowsAbout: unknown }): AuthorProfile => ({
  id: a.id,
  name: a.name,
  slug: a.slug,
  url: a.url ?? undefined,
  jobTitle: a.jobTitle ?? undefined,
  description: a.description ?? undefined,
  image: a.image ?? undefined,
  sameAs: (a.sameAs as string[]) ?? [],
  knowsAbout: (a.knowsAbout as string[]) ?? []
});

async function latestRun(siteId: string) {
  return prisma.crawlRun.findFirst({ where: { siteId, status: 'completed', mode: 'site' }, orderBy: { startedAt: 'desc' } });
}
const isArticlePath = (u: string) => /\/(blog|noticias|news|articulos?|articles?|posts?|guia|guias|recursos)\//i.test(u);

export async function getEntityOrg(siteId: string): Promise<OrgProfile> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const p = await prisma.entityProfile.findUnique({ where: { siteId } });
  return (p?.org as unknown as OrgProfile) ?? { name: site.name, url: site.canonicalUrl.replace(/\/?$/, '/'), sameAs: [] };
}

export async function saveEntityOrg(siteId: string, org: OrgProfile, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const clean = { ...org, sameAs: [...new Set((org.sameAs ?? []).map(s => s.trim()).filter(Boolean))] };
  await prisma.entityProfile.upsert({ where: { siteId }, create: { siteId, org: clean as object }, update: { org: clean as object } });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'entity.org_saved', entity: 'Site', entityId: siteId });
  return clean;
}

export async function listEntityAuthors(siteId: string) {
  return (await prisma.entityAuthor.findMany({ where: { siteId }, orderBy: { name: 'asc' } })).map(toAuthor);
}
export async function saveEntityAuthor(siteId: string, input: { id?: string; name: string; url?: string | null; jobTitle?: string | null; description?: string | null; image?: string | null; sameAs?: string[]; knowsAbout?: string[] }) {
  const data = {
    name: input.name.trim(),
    url: input.url || null,
    jobTitle: input.jobTitle || null,
    description: input.description || null,
    image: input.image || null,
    sameAs: [...new Set((input.sameAs ?? []).map(s => s.trim()).filter(Boolean))],
    knowsAbout: [...new Set((input.knowsAbout ?? []).map(s => s.trim()).filter(Boolean))]
  };
  if (input.id) {
    const a = await prisma.entityAuthor.findFirst({ where: { id: input.id, siteId } });
    if (!a) throw new WorkflowError('AUTHOR_NOT_FOUND', 'Ese autor no existe en este sitio.', 404);
    return toAuthor(await prisma.entityAuthor.update({ where: { id: a.id }, data }));
  }
  let slug = slugify(data.name);
  for (let i = 2; await prisma.entityAuthor.findUnique({ where: { siteId_slug: { siteId, slug } } }); i++) slug = `${slugify(data.name)}-${i}`;
  return toAuthor(await prisma.entityAuthor.create({ data: { siteId, slug, ...data } }));
}
export async function deleteEntityAuthor(siteId: string, id: string) {
  const r = await prisma.entityAuthor.deleteMany({ where: { id, siteId } });
  if (!r.count) throw new WorkflowError('AUTHOR_NOT_FOUND', 'Ese autor no existe en este sitio.', 404);
  return { deleted: true };
}

// ---------------------------------------------------------------- Wikidata

const wikidataApi = () => (process.env.WIKIDATA_API_URL ?? 'https://www.wikidata.org/w/api.php').replace(/\/$/, '');

/** Wikidata entities for a text, with their Spanish (or English) Wikipedia article when there is one. */
export async function searchWikidata(query: string, lang = 'es'): Promise<Array<EntityRef & { description: string | null }>> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const get = async (params: Record<string, string>) => {
    const res = await fetch(`${wikidataApi()}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'user-agent': 'G.SEO entity profile (contact: site owner)' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new WorkflowError('WIKIDATA_ERROR', `Wikidata respondió ${res.status}.`, 502);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const s = (await get({ action: 'wbsearchentities', search: q, language: lang, uselang: lang, limit: '5', type: 'item' })) as { search?: Array<{ id: string; label?: string; description?: string }> };
  const hits = s.search ?? [];
  if (!hits.length) return [];
  const e = (await get({ action: 'wbgetentities', ids: hits.map(h => h.id).join('|'), props: 'sitelinks/urls', sitefilter: `${lang}wiki|enwiki` })) as { entities?: Record<string, { sitelinks?: Record<string, { url?: string }> }> };
  return hits.map(h => {
    const links = e.entities?.[h.id]?.sitelinks ?? {};
    return { qid: h.id, label: h.label ?? q, description: h.description ?? null, wikipedia: links[`${lang}wiki`]?.url ?? links.enwiki?.url ?? undefined };
  });
}

// ---------------------------------------------------------------- pages

/** Crawled pages with their saved entity data (articles first, then by clicks). */
export async function listEntityPages(siteId: string) {
  const run = await latestRun(siteId);
  const saved = await prisma.entityPage.findMany({ where: { siteId } });
  const byUrl = new Map(saved.map(p => [gscKey(p.url), p]));
  if (!run) return { crawl: null, pages: [] };
  const pages = await prisma.crawledPage.findMany({ where: { crawlRunId: run.id, statusCode: 200, isIndexable: true, mimeType: { contains: 'html' } }, select: { url: true, title: true, schemaTypes: true }, take: 5000 });
  const imp = await latestGscImport(siteId);
  const clicks = new Map((imp ? await prisma.gscPageStat.findMany({ where: { importId: imp.id }, select: { page: true, clicks: true } }) : []).map(p => [gscKey(p.page), p.clicks]));
  const rows = pages.map(p => {
    const s = byUrl.get(gscKey(p.url));
    const types = (p.schemaTypes as string[] | null) ?? [];
    const guess: EntityPageType = types.some(t => /Article|BlogPosting|NewsArticle/.test(t)) || isArticlePath(p.url) ? 'BlogPosting' : /\/(nosotros|about|quienes|acerca)/i.test(p.url) ? 'AboutPage' : /\/(contacto|contact)/i.test(p.url) ? 'ContactPage' : 'WebPage';
    return { url: p.url, title: p.title, clicks: clicks.get(gscKey(p.url)) ?? null, schemaTypes: types, configured: !!s, type: (s?.type as EntityPageType) ?? guess, authorId: s?.authorId ?? null, about: (s?.about as unknown as EntityRef[]) ?? [], mentions: (s?.mentions as unknown as EntityRef[]) ?? [], datePublished: s?.datePublished ?? null };
  });
  const rank = (t: string) => (/Article|BlogPosting|NewsArticle/.test(t) ? 0 : 1);
  rows.sort((a, b) => rank(a.type) - rank(b.type) || (b.clicks ?? 0) - (a.clicks ?? 0));
  return { crawl: { id: run.id, startedAt: run.startedAt }, pages: rows.slice(0, 2000) };
}

export async function saveEntityPage(siteId: string, input: { url: string; type: EntityPageType; authorId?: string | null; about?: EntityRef[]; mentions?: EntityRef[]; datePublished?: string | null }) {
  if (input.authorId && !(await prisma.entityAuthor.findFirst({ where: { id: input.authorId, siteId } }))) throw new WorkflowError('AUTHOR_NOT_FOUND', 'Ese autor no existe en este sitio.', 404);
  const data = { type: input.type, authorId: input.authorId ?? null, about: (input.about ?? []) as object, mentions: (input.mentions ?? []) as object, datePublished: input.datePublished || null };
  return prisma.entityPage.upsert({ where: { siteId_url: { siteId, url: input.url } }, create: { siteId, url: input.url, ...data }, update: data });
}

/** Search phrases for a page (title parts, H1, H2, main queries) with their Wikidata candidates. */
export async function suggestPageEntities(siteId: string, url: string) {
  const run = await latestRun(siteId);
  const p = run ? await prisma.crawledPage.findFirst({ where: { crawlRunId: run.id, url }, select: { title: true, h1: true, h2: true } }) : null;
  const imp = await latestGscImport(siteId);
  const queries = imp ? (await prisma.gscQueryStat.findMany({ where: { importId: imp.id, page: { in: [url, url.replace(/\/$/, ''), `${url.replace(/\/$/, '')}/`] } }, orderBy: { impressions: 'desc' }, take: 5, select: { query: true } })).map(q => q.query) : [];
  const phrases = [...new Set([...anchorCandidates({ title: p?.title, h1: p?.h1, queries }), ...(((p?.h2 as string[] | null) ?? []).slice(0, 4))])].slice(0, 6);
  const out = [];
  for (const phrase of phrases) out.push({ phrase, results: await searchWikidata(phrase).catch(() => []) });
  return out;
}

/** The connected JSON-LD graph for one page, with what is missing for E-E-A-T. */
export async function entityGraphFor(siteId: string, url: string) {
  const org = await getEntityOrg(siteId);
  const run = await latestRun(siteId);
  const crawled = run ? await prisma.crawledPage.findFirst({ where: { crawlRunId: run.id, url }, select: { title: true, metaDescription: true, og: true, lang: true } }) : null;
  const saved = await prisma.entityPage.findUnique({ where: { siteId_url: { siteId, url } }, include: { author: true } });
  const authors = await listEntityAuthors(siteId);
  const page: PageEntityInput = {
    url,
    type: (saved?.type as EntityPageType) ?? (isArticlePath(url) ? 'BlogPosting' : 'WebPage'),
    title: crawled?.title,
    description: crawled?.metaDescription,
    image: (crawled?.og as { image?: string } | null)?.image ?? null,
    datePublished: saved?.datePublished,
    author: saved?.author ? toAuthor(saved.author) : null,
    about: (saved?.about as unknown as EntityRef[]) ?? [],
    mentions: (saved?.mentions as unknown as EntityRef[]) ?? [],
    inLanguage: crawled?.lang ?? undefined
  };
  const graph = buildEntityGraph(org, page, { authors });
  return { graph, json: JSON.stringify(graph, null, 2), warnings: graphWarnings(org, page) };
}

// ---------------------------------------------------------------- E-E-A-T audit

export interface EeatCheck {
  id: string;
  area: 'Organización' | 'Autores' | 'Contenido' | 'Confianza';
  label: string;
  status: 'ok' | 'partial' | 'fail';
  weight: number;
  detail: string;
  fix: string;
}

export async function eeatAudit(siteId: string) {
  const org = await getEntityOrg(siteId);
  const hasProfile = !!(await prisma.entityProfile.findUnique({ where: { siteId } }));
  const authors = await listEntityAuthors(siteId);
  const run = await latestRun(siteId);
  const pages = run ? await prisma.crawledPage.findMany({ where: { crawlRunId: run.id }, select: { url: true, statusCode: true, isIndexable: true, depth: true, htmlGz: true, schemaTypes: true, mimeType: true } }) : [];
  const ok200 = pages.filter(p => p.statusCode === 200 && p.mimeType.includes('html'));
  const has = (re: RegExp) => ok200.some(p => {
    try {
      return re.test(new URL(p.url).pathname);
    } catch {
      return false;
    }
  });
  const checks: EeatCheck[] = [];
  const add = (c: EeatCheck) => checks.push(c);

  // Organization
  const orgFields = [org.logo, org.description, org.email || org.telephone || org.address?.streetAddress].filter(Boolean).length;
  add({ id: 'org-profile', area: 'Organización', label: 'Perfil de la organización completo', weight: 15, status: hasProfile && orgFields === 3 ? 'ok' : hasProfile && orgFields ? 'partial' : 'fail', detail: hasProfile ? `${orgFields}/3: logo, descripción y un dato de contacto.` : 'Todavía no llenas el perfil de la organización.', fix: 'Completa nombre, logo, descripción y contacto en "Perfil de entidad".' });
  const sameAs = org.sameAs?.length ?? 0;
  add({ id: 'org-sameas', area: 'Organización', label: 'Perfiles oficiales en sameAs', weight: 10, status: sameAs >= 3 ? 'ok' : sameAs ? 'partial' : 'fail', detail: `${sameAs} perfil(es).`, fix: 'Agrega los perfiles oficiales: Google Business Profile, LinkedIn, Facebook, Instagram, Wikipedia o Wikidata si existen, directorios del sector.' });
  const home = ok200.find(p => p.depth === 0) ?? ok200[0];
  let homeOrg: { found: boolean; sameAs: number } = { found: false, sameAs: 0 };
  if (home?.htmlGz) {
    const $ = cheerio.load(zlib.gunzipSync(Buffer.from(home.htmlGz)).toString('utf8'));
    const nodes: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const walk = (v: unknown): void => {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') {
            nodes.push(v as Record<string, unknown>);
            Object.values(v).forEach(walk);
          }
        };
        walk(JSON.parse($(el).text()));
      } catch {
        /* invalid JSON-LD */
      }
    });
    const o = nodes.find(n => [n['@type']].flat().some(t => typeof t === 'string' && /Organization|Business|Corporation|Store|Restaurant|School|University/.test(t)));
    homeOrg = { found: !!o, sameAs: o ? [o.sameAs].flat().filter(Boolean).length : 0 };
  }
  add({ id: 'org-schema', area: 'Organización', label: 'Schema de la organización publicado en la portada', weight: 10, status: homeOrg.found && homeOrg.sameAs ? 'ok' : homeOrg.found ? 'partial' : 'fail', detail: !run ? 'Haz un crawl para revisarlo.' : homeOrg.found ? `Encontrado, con ${homeOrg.sameAs} sameAs.` : 'La portada no tiene Organization en JSON-LD.', fix: 'Publica el grafo de la portada (pestaña Páginas → portada → Copiar JSON-LD o Proponer en WordPress).' });

  // Trust pages
  add({ id: 'about', area: 'Confianza', label: 'Página "Nosotros"', weight: 7, status: has(/(nosotros|about|quienes-somos|acerca|equipo|team)/i) ? 'ok' : 'fail', detail: has(/(nosotros|about|quienes-somos|acerca|equipo|team)/i) ? 'Existe.' : 'No se encontró en el crawl.', fix: 'Crea una página que explique quiénes son, su experiencia y su equipo, y enlázala desde el menú o el pie.' });
  add({ id: 'contact', area: 'Confianza', label: 'Página de contacto', weight: 7, status: has(/(contacto|contact)/i) ? 'ok' : 'fail', detail: has(/(contacto|contact)/i) ? 'Existe.' : 'No se encontró en el crawl.', fix: 'Publica una página de contacto con dirección, teléfono o correo reales.' });
  add({ id: 'legal', area: 'Confianza', label: 'Aviso de privacidad o términos', weight: 4, status: has(/(privacidad|privacy|aviso-legal|terminos|terms|legal)/i) ? 'ok' : 'fail', detail: has(/(privacidad|privacy|aviso-legal|terminos|terms|legal)/i) ? 'Existe.' : 'No se encontró en el crawl.', fix: 'Publica el aviso de privacidad y los términos, enlazados desde el pie.' });

  // Authors
  add({ id: 'authors', area: 'Autores', label: 'Autores registrados', weight: 8, status: authors.length ? 'ok' : 'fail', detail: `${authors.length} autor(es).`, fix: 'Agrega a las personas que escriben o revisan el contenido en "Perfil de entidad".' });
  if (authors.length) {
    const good = authors.filter(a => (a.description?.length ?? 0) >= 80 && (a.sameAs?.length ?? 0) >= 1 && a.url && a.image);
    add({ id: 'author-profiles', area: 'Autores', label: 'Autores con biografía, foto, página y perfiles verificables', weight: 12, status: good.length === authors.length ? 'ok' : good.length ? 'partial' : 'fail', detail: `${good.length} de ${authors.length} completos.${authors.filter(a => !a.sameAs?.length).length ? ` Sin sameAs: ${authors.filter(a => !a.sameAs?.length).map(a => a.name).join(', ')}.` : ''}`, fix: 'Para cada autor: biografía de al menos 80 caracteres con su experiencia, foto, página de autor en el sitio y perfiles como LinkedIn, X u ORCID.' });
    const urls = new Set(ok200.map(p => p.url.replace(/\/$/, '')));
    const linked = authors.filter(a => a.url && urls.has(a.url.replace(/\/$/, '')));
    add({ id: 'author-pages', area: 'Autores', label: 'Páginas de autor que funcionan', weight: 5, status: !run ? 'partial' : linked.length === authors.filter(a => a.url).length && linked.length ? 'ok' : linked.length ? 'partial' : 'fail', detail: run ? `${linked.length} de ${authors.filter(a => a.url).length} páginas de autor responden en el crawl.` : 'Haz un crawl para revisarlo.', fix: 'Crea una página por autor y enlázala desde sus artículos.' });
  }

  // Content (articles)
  const articles = ok200.filter(p => p.isIndexable && (isArticlePath(p.url) || ((p.schemaTypes as string[] | null) ?? []).some(t => /Article|BlogPosting|NewsArticle/.test(t)))).slice(0, 500);
  let withAuthor = 0;
  let withDate = 0;
  for (const p of articles) {
    if (!p.htmlGz) continue;
    const $ = cheerio.load(zlib.gunzipSync(Buffer.from(p.htmlGz)).toString('utf8'));
    const ld = $('script[type="application/ld+json"]').text();
    if ($('meta[name="author"]').attr('content') || $('[rel="author"], [itemprop="author"], .author, .byline').length || /"author"\s*:/.test(ld)) withAuthor++;
    if ($('meta[property="article:published_time"], meta[property="article:modified_time"], time[datetime]').length || /"date(Published|Modified)"\s*:/.test(ld)) withDate++;
  }
  const pct = (n: number) => (articles.length ? Math.round((n / articles.length) * 100) : 0);
  if (articles.length) {
    add({ id: 'article-author', area: 'Contenido', label: 'Artículos con autor visible', weight: 10, status: pct(withAuthor) >= 90 ? 'ok' : pct(withAuthor) >= 40 ? 'partial' : 'fail', detail: `${withAuthor} de ${articles.length} (${pct(withAuthor)} %).`, fix: 'Muestra el autor en cada artículo, enlazado a su página, y márcalo en el schema (author).' });
    add({ id: 'article-date', area: 'Contenido', label: 'Artículos con fecha', weight: 6, status: pct(withDate) >= 90 ? 'ok' : pct(withDate) >= 40 ? 'partial' : 'fail', detail: `${withDate} de ${articles.length} (${pct(withDate)} %).`, fix: 'Muestra la fecha de publicación y de actualización, y márcalas en el schema.' });
    const configured = await prisma.entityPage.count({ where: { siteId, authorId: { not: null } } });
    add({ id: 'article-entities', area: 'Contenido', label: 'Artículos conectados al grafo (autor y entidades)', weight: 6, status: configured >= articles.length * 0.8 ? 'ok' : configured ? 'partial' : 'fail', detail: `${configured} página(s) con autor asignado en G.SEO.`, fix: 'En la pestaña Páginas asigna autor y entidades de Wikidata (about / mentions) a tus artículos principales.' });
  } else add({ id: 'article-author', area: 'Contenido', label: 'Artículos con autor visible', weight: 10, status: run ? 'partial' : 'fail', detail: run ? 'No se detectaron artículos (rutas /blog/ o schema Article).' : 'Haz un crawl para revisarlo.', fix: 'Si publicas artículos, muéstrales autor y fecha.' });

  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + c.weight * (c.status === 'ok' ? 1 : c.status === 'partial' ? 0.5 : 0), 0);
  return { score: Math.round((got / total) * 100), checks, articles: articles.length, crawl: run ? { id: run.id, startedAt: run.startedAt } : null };
}
