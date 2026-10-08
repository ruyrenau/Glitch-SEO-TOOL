import zlib from 'zlib';
import { prisma } from './client';
import { WorkflowError } from './errors';
import { gscKey, gscPageMap } from './gsc-service';

/**
 * Screaming Frog-style explorer over one crawl: tabs, filters with counts,
 * per-URL details (inlinks, outlinks, images, headers, source) and CSV export.
 * All computed from stored crawl data; nothing is fetched again.
 */

type Img = { src: string; alt: string | null; width: string | null; height: string | null; loading: string | null };

export interface ExplorerPage {
  id: string;
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  mimeType: string;
  sizeBytes: number;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  metaKeywords: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  h1: string | null;
  h1Count: number;
  h1All: string[];
  h2: string[];
  lang: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  schemaTypes: string[];
  schemaErrors: number;
  og: { title: string | null; description: string | null; image: string | null } | null;
  twitter: { card: string | null } | null;
  relNext: string | null;
  relPrev: string | null;
  images: Img[];
  inlinks: number;
  outlinks: number;
  externalLinks: number;
  isIndexable: boolean;
  indexabilityReason: string | null;
  blockedByRobots: boolean;
  wordCount: number;
  depth: number;
  inSitemap: boolean;
  inLogs: boolean;
  redirectChain: Array<{ url: string; status: number }> | null;
  js: JsInfo | null;
  /** Search Console metrics from the site's latest import (null = no impressions or no import). */
  gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
}

type JsInfo = {
  rendered: boolean;
  renderMs: number;
  error: string | null;
  errors: string[];
  blockedRequests: number;
  raw: { title: string | null; h1: string | null; canonical: string | null; robotsMeta: string | null; wordCount: number; internalLinks: number };
  jsOnlyLinks: string[];
};
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const jsChanged = (raw: string | null | undefined, now: string | null | undefined) => norm(raw) !== norm(now);

interface Column {
  key: string;
  label: string;
  type?: 'number' | 'text' | 'url';
}

interface Filter {
  id: string;
  label: string;
  test: (p: ExplorerPage, ctx: Ctx) => boolean;
}

interface Tab {
  id: string;
  label: string;
  columns: Column[];
  filters: Filter[];
  /** Base set of rows (default: HTML pages that returned 200). */
  base?: (p: ExplorerPage) => boolean;
  row: (p: ExplorerPage, ctx: Ctx) => Record<string, unknown>;
}

interface Ctx {
  dupTitles: Map<string, number>;
  dupDescs: Map<string, number>;
  dupH1: Map<string, number>;
  dupH2: Map<string, number>;
  statusByUrl: Map<string, number>;
}

const isHtml200 = (p: ExplorerPage) => p.statusCode === 200 && p.redirectChain === null && /html/i.test(p.mimeType || 'text/html');
const len = (s: string | null | undefined) => (s ? [...s].length : 0);
const key = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : '');
const status = (p: ExplorerPage) => (p.blockedByRobots ? 'Bloqueada por robots' : p.statusCode || 'Sin respuesta');
const indexability = (p: ExplorerPage) => (p.isIndexable ? 'Indexable' : `No indexable: ${p.indexabilityReason ?? ''}`);
const VALID_HREFLANG = /^(x-default|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/i;

export const TABS: Tab[] = [
  {
    id: 'internal',
    label: 'Internas',
    base: () => true,
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'contentType', label: 'Tipo de contenido' },
      { key: 'status', label: 'Estado' },
      { key: 'indexability', label: 'Indexabilidad' },
      { key: 'title', label: 'Título' },
      { key: 'words', label: 'Palabras', type: 'number' },
      { key: 'depth', label: 'Profundidad', type: 'number' },
      { key: 'inlinks', label: 'Enlaces entrantes', type: 'number' },
      { key: 'outlinks', label: 'Enlaces salientes', type: 'number' },
      { key: 'responseMs', label: 'Respuesta (ms)', type: 'number' },
      { key: 'sizeKb', label: 'Tamaño (KB)', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'html', label: 'HTML', test: p => /html/i.test(p.mimeType) },
      { id: 'other', label: 'Otros tipos', test: p => !!p.mimeType && !/html/i.test(p.mimeType) },
      { id: 'indexable', label: 'Indexables', test: p => p.isIndexable },
      { id: 'non-indexable', label: 'No indexables', test: p => !p.isIndexable }
    ],
    row: p => ({ contentType: p.mimeType || '—', status: status(p), indexability: indexability(p), title: p.title, words: p.wordCount, depth: p.depth, inlinks: p.inlinks, outlinks: p.outlinks, responseMs: p.responseTimeMs, sizeKb: Math.round(p.sizeBytes / 102.4) / 10 })
  },
  {
    id: 'response',
    label: 'Códigos de respuesta',
    base: () => true,
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'status', label: 'Código' },
      { key: 'finalUrl', label: 'Redirige a', type: 'url' },
      { key: 'hops', label: 'Saltos', type: 'number' },
      { key: 'inlinks', label: 'Enlaces entrantes', type: 'number' },
      { key: 'responseMs', label: 'Respuesta (ms)', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'blocked', label: 'Bloqueadas por robots.txt', test: p => p.blockedByRobots },
      { id: 'no-response', label: 'Sin respuesta', test: p => p.statusCode === 0 && !p.blockedByRobots },
      { id: '2xx', label: 'Éxito (2xx)', test: p => p.statusCode >= 200 && p.statusCode < 300 && !p.redirectChain },
      { id: '3xx', label: 'Redirección (3xx)', test: p => !!p.redirectChain },
      { id: '4xx', label: 'Error de cliente (4xx)', test: p => p.statusCode >= 400 && p.statusCode < 500 },
      { id: '5xx', label: 'Error de servidor (5xx)', test: p => p.statusCode >= 500 }
    ],
    row: p => ({ status: p.redirectChain ? `${p.redirectChain[0].status} → ${p.statusCode || 'error'}` : status(p), finalUrl: p.finalUrl !== p.url ? p.finalUrl : '', hops: p.redirectChain?.length ?? 0, inlinks: p.inlinks, responseMs: p.responseTimeMs })
  },
  {
    id: 'uri',
    label: 'URI',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'length', label: 'Longitud', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'non-ascii', label: 'Caracteres no ASCII', test: p => /[^\x00-\x7F]/.test(decodeURI(p.url)) },
      { id: 'underscores', label: 'Guiones bajos', test: p => new URL(p.url).pathname.includes('_') },
      { id: 'uppercase', label: 'Mayúsculas', test: p => /[A-Z]/.test(new URL(p.url).pathname) },
      { id: 'parameters', label: 'Parámetros', test: p => !!new URL(p.url).search },
      { id: 'over-115', label: 'Más de 115 caracteres', test: p => p.url.length > 115 },
      { id: 'multiple-slashes', label: 'Barras repetidas', test: p => /\/\//.test(new URL(p.url).pathname) }
    ],
    row: p => ({ length: p.url.length })
  },
  {
    id: 'titles',
    label: 'Títulos',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'title', label: 'Título 1' },
      { key: 'length', label: 'Longitud', type: 'number' },
      { key: 'h1', label: 'H1' },
      { key: 'indexability', label: 'Indexabilidad' }
    ],
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      { id: 'missing', label: 'Faltante', test: p => !p.title },
      { id: 'duplicate', label: 'Duplicado', test: (p, c) => !!p.title && (c.dupTitles.get(key(p.title)) ?? 0) > 1 },
      { id: 'over-60', label: 'Más de 60 caracteres', test: p => len(p.title) > 60 },
      { id: 'below-30', label: 'Menos de 30 caracteres', test: p => !!p.title && len(p.title) < 30 },
      { id: 'same-as-h1', label: 'Igual que el H1', test: p => !!p.title && key(p.title) === key(p.h1) },
      { id: 'multiple', label: 'Múltiples', test: p => p.titleCount > 1 }
    ],
    row: p => ({ title: p.title, length: len(p.title), h1: p.h1, indexability: indexability(p) })
  },
  {
    id: 'meta',
    label: 'Meta description',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'metaDescription', label: 'Meta description 1' },
      { key: 'length', label: 'Longitud', type: 'number' },
      { key: 'indexability', label: 'Indexabilidad' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'missing', label: 'Faltante', test: p => !p.metaDescription },
      { id: 'duplicate', label: 'Duplicada', test: (p, c) => !!p.metaDescription && (c.dupDescs.get(key(p.metaDescription)) ?? 0) > 1 },
      { id: 'over-155', label: 'Más de 155 caracteres', test: p => len(p.metaDescription) > 155 },
      { id: 'below-70', label: 'Menos de 70 caracteres', test: p => !!p.metaDescription && len(p.metaDescription) < 70 },
      { id: 'multiple', label: 'Múltiples', test: p => p.metaDescriptionCount > 1 }
    ],
    row: p => ({ metaDescription: p.metaDescription, length: len(p.metaDescription), indexability: indexability(p) })
  },
  {
    id: 'keywords',
    label: 'Meta keywords',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'metaKeywords', label: 'Meta keywords' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'present', label: 'Con meta keywords (Google la ignora)', test: p => !!p.metaKeywords }
    ],
    row: p => ({ metaKeywords: p.metaKeywords })
  },
  {
    id: 'h1',
    label: 'H1',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'h1', label: 'H1-1' },
      { key: 'h1b', label: 'H1-2' },
      { key: 'length', label: 'Longitud', type: 'number' },
      { key: 'count', label: 'Cantidad', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      { id: 'missing', label: 'Faltante', test: p => p.h1Count === 0 },
      { id: 'duplicate', label: 'Duplicado', test: (p, c) => !!p.h1 && (c.dupH1.get(key(p.h1)) ?? 0) > 1 },
      { id: 'over-70', label: 'Más de 70 caracteres', test: p => len(p.h1) > 70 },
      { id: 'multiple', label: 'Múltiples', test: p => p.h1Count > 1 }
    ],
    row: p => ({ h1: p.h1All[0] ?? p.h1, h1b: p.h1All[1] ?? '', length: len(p.h1), count: p.h1Count })
  },
  {
    id: 'h2',
    label: 'H2',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'h2', label: 'H2-1' },
      { key: 'h2b', label: 'H2-2' },
      { key: 'count', label: 'Cantidad', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      { id: 'missing', label: 'Faltante', test: p => p.h2.length === 0 },
      { id: 'duplicate', label: 'Duplicado', test: (p, c) => !!p.h2[0] && (c.dupH2.get(key(p.h2[0])) ?? 0) > 1 },
      { id: 'over-70', label: 'Más de 70 caracteres', test: p => p.h2.some(h => len(h) > 70) },
      { id: 'multiple', label: 'Múltiples', test: p => p.h2.length > 1 }
    ],
    row: p => ({ h2: p.h2[0] ?? '', h2b: p.h2[1] ?? '', count: p.h2.length })
  },
  {
    id: 'images',
    label: 'Imágenes',
    columns: [
      { key: 'src', label: 'Imagen', type: 'url' },
      { key: 'url', label: 'Página', type: 'url' },
      { key: 'alt', label: 'Texto alternativo' },
      { key: 'altLength', label: 'Longitud alt', type: 'number' },
      { key: 'dimensions', label: 'Dimensiones (atributos)' },
      { key: 'loading', label: 'loading' }
    ],
    filters: [], // image tab has its own filters (see IMAGE_FILTERS)
    row: () => ({})
  },
  {
    id: 'canonicals',
    label: 'Canonicals',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'canonical', label: 'Canonical', type: 'url' },
      { key: 'canonicalStatus', label: 'Estado del canonical' },
      { key: 'indexability', label: 'Indexabilidad' }
    ],
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      { id: 'self', label: 'Autorreferenciado', test: p => p.canonical === p.url },
      { id: 'canonicalised', label: 'Canonicalizada a otra URL', test: p => !!p.canonical && p.canonical !== p.url },
      { id: 'missing', label: 'Faltante', test: p => !p.canonical },
      { id: 'non-200', label: 'Apunta a URL que no responde 200', test: (p, c) => !!p.canonical && c.statusByUrl.has(p.canonical) && c.statusByUrl.get(p.canonical) !== 200 },
      { id: 'cross-host', label: 'Apunta a otro host', test: p => !!p.canonical && new URL(p.canonical).hostname !== new URL(p.url).hostname }
    ],
    row: (p, c) => ({ canonical: p.canonical, canonicalStatus: p.canonical ? (c.statusByUrl.get(p.canonical) ?? 'no rastreada') : '', indexability: indexability(p) })
  },
  {
    id: 'directives',
    label: 'Directivas',
    base: () => true,
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'robotsMeta', label: 'Meta robots' },
      { key: 'xRobotsTag', label: 'X-Robots-Tag' },
      { key: 'indexability', label: 'Indexabilidad' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'noindex', label: 'noindex', test: p => /noindex|none/i.test(`${p.robotsMeta ?? ''} ${p.xRobotsTag ?? ''}`) },
      { id: 'nofollow', label: 'nofollow', test: p => /nofollow|none/i.test(`${p.robotsMeta ?? ''} ${p.xRobotsTag ?? ''}`) },
      { id: 'x-robots', label: 'Con X-Robots-Tag', test: p => !!p.xRobotsTag },
      { id: 'blocked', label: 'Bloqueadas por robots.txt', test: p => p.blockedByRobots }
    ],
    row: p => ({ robotsMeta: p.robotsMeta, xRobotsTag: p.xRobotsTag, indexability: indexability(p) })
  },
  {
    id: 'hreflang',
    label: 'Hreflang',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'lang', label: 'html lang' },
      { key: 'hreflang', label: 'Hreflang' },
      { key: 'count', label: 'Alternativas', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'contains', label: 'Con hreflang', test: p => p.hreflang.length > 0 },
      { id: 'missing-self', label: 'Sin autorreferencia', test: p => p.hreflang.length > 0 && !p.hreflang.some(h => h.href === p.url) },
      { id: 'invalid', label: 'Código inválido', test: p => p.hreflang.some(h => !VALID_HREFLANG.test(h.lang)) },
      { id: 'missing-lang', label: 'Sin html lang', test: p => !p.lang }
    ],
    row: p => ({ lang: p.lang, hreflang: p.hreflang.map(h => h.lang).join(', '), count: p.hreflang.length })
  },
  {
    id: 'structured',
    label: 'Datos estructurados',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'types', label: 'Tipos' },
      { key: 'errors', label: 'Bloques con error', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'contains', label: 'Con JSON-LD', test: p => p.schemaTypes.length > 0 },
      { id: 'missing', label: 'Sin JSON-LD', test: p => p.schemaTypes.length === 0 && p.schemaErrors === 0 },
      { id: 'errors', label: 'JSON-LD con errores de sintaxis', test: p => p.schemaErrors > 0 }
    ],
    row: p => ({ types: p.schemaTypes.join(', '), errors: p.schemaErrors })
  },
  {
    id: 'social',
    label: 'Open Graph / Twitter',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'ogTitle', label: 'og:title' },
      { key: 'ogDescription', label: 'og:description' },
      { key: 'ogImage', label: 'og:image', type: 'url' },
      { key: 'twitterCard', label: 'twitter:card' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'missing-og-title', label: 'Sin og:title', test: p => !p.og?.title },
      { id: 'missing-og-image', label: 'Sin og:image', test: p => !p.og?.image },
      { id: 'missing-twitter', label: 'Sin twitter:card', test: p => !p.twitter?.card }
    ],
    row: p => ({ ogTitle: p.og?.title, ogDescription: p.og?.description, ogImage: p.og?.image, twitterCard: p.twitter?.card })
  },
  {
    id: 'links',
    label: 'Enlaces',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'inlinks', label: 'Entrantes', type: 'number' },
      { key: 'outlinks', label: 'Salientes internos', type: 'number' },
      { key: 'external', label: 'Salientes externos', type: 'number' },
      { key: 'depth', label: 'Profundidad', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'no-inlinks', label: 'Sin enlaces entrantes', test: p => p.inlinks === 0 && p.depth > 0 },
      { id: 'no-outlinks', label: 'Sin enlaces internos salientes', test: p => p.outlinks === 0 },
      { id: 'many-outlinks', label: 'Más de 100 salientes', test: p => p.outlinks + p.externalLinks > 100 },
      { id: 'deep', label: 'Profundidad mayor a 4', test: p => p.depth > 4 }
    ],
    row: p => ({ inlinks: p.inlinks, outlinks: p.outlinks, external: p.externalLinks, depth: p.depth })
  },
  {
    id: 'pagination',
    label: 'Paginación',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'relPrev', label: 'rel="prev"', type: 'url' },
      { key: 'relNext', label: 'rel="next"', type: 'url' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'contains', label: 'Con paginación', test: p => !!(p.relNext || p.relPrev) },
      { id: 'broken', label: 'Apunta a URL con error', test: (p, c) => [p.relNext, p.relPrev].some(u => !!u && c.statusByUrl.has(u) && c.statusByUrl.get(u) !== 200) }
    ],
    row: p => ({ relPrev: p.relPrev, relNext: p.relNext })
  },
  {
    id: 'gsc',
    label: 'Search Console',
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'title', label: 'Título' },
      { key: 'clicks', label: 'Clics', type: 'number' },
      { key: 'impressions', label: 'Impresiones', type: 'number' },
      { key: 'ctr', label: 'CTR (%)', type: 'number' },
      { key: 'position', label: 'Posición media', type: 'number' },
      { key: 'indexability', label: 'Indexabilidad' },
      { key: 'inlinks', label: 'Enlaces entrantes', type: 'number' },
      { key: 'googlebot', label: 'Visitada por Googlebot' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'with-impressions', label: 'Con impresiones', test: p => (p.gsc?.impressions ?? 0) > 0 },
      { id: 'with-clicks', label: 'Con clics', test: p => (p.gsc?.clicks ?? 0) > 0 },
      { id: 'no-impressions', label: 'Indexables sin impresiones', test: p => p.isIndexable && !p.gsc },
      { id: 'non-indexable-with-impressions', label: 'No indexables con impresiones', test: p => !p.isIndexable && (p.gsc?.impressions ?? 0) > 0 },
      { id: 'low-ctr', label: 'CTR bajo para su posición', test: p => !!p.gsc && p.gsc.impressions >= 100 && p.gsc.position <= 10 && p.gsc.ctr < (p.gsc.position <= 1.5 ? 0.15 : p.gsc.position <= 3 ? 0.07 : p.gsc.position <= 5 ? 0.03 : 0.01) },
      { id: 'striking-distance', label: 'Posición 4 a 15 (cerca de la primera página)', test: p => !!p.gsc && p.gsc.position >= 4 && p.gsc.position <= 15 && p.gsc.impressions >= 50 },
      { id: 'not-in-logs', label: 'Con impresiones pero sin visitas de Googlebot en el log', test: p => !p.inLogs && (p.gsc?.impressions ?? 0) > 0 }
    ],
    row: p => ({
      title: p.title,
      clicks: p.gsc?.clicks ?? 0,
      impressions: p.gsc?.impressions ?? 0,
      ctr: p.gsc ? Math.round(p.gsc.ctr * 1000) / 10 : 0,
      position: p.gsc ? Math.round(p.gsc.position * 10) / 10 : null,
      indexability: indexability(p),
      inlinks: p.inlinks,
      googlebot: p.inLogs ? 'Sí' : 'No'
    })
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    base: p => isHtml200(p) && !!p.js,
    columns: [
      { key: 'url', label: 'Dirección', type: 'url' },
      { key: 'rendered', label: 'Renderizado' },
      { key: 'rawWords', label: 'Palabras sin JS', type: 'number' },
      { key: 'words', label: 'Palabras con JS', type: 'number' },
      { key: 'jsWordsPct', label: '% contenido por JS', type: 'number' },
      { key: 'rawLinks', label: 'Enlaces sin JS', type: 'number' },
      { key: 'jsOnlyLinks', label: 'Enlaces solo con JS', type: 'number' },
      { key: 'rawTitle', label: 'Título sin JS' },
      { key: 'title', label: 'Título con JS' },
      { key: 'jsErrors', label: 'Errores JS', type: 'number' },
      { key: 'renderMs', label: 'Render (ms)', type: 'number' }
    ],
    filters: [
      { id: 'all', label: 'Todas', test: () => true },
      { id: 'js-content', label: 'Contenido que depende de JS (>25 %)', test: p => !!p.js && p.wordCount > 0 && (p.wordCount - p.js.raw.wordCount) / p.wordCount > 0.25 },
      { id: 'js-links', label: 'Con enlaces que solo existen con JS', test: p => !!p.js?.jsOnlyLinks.length },
      { id: 'title-changed', label: 'Título cambiado por JS', test: p => !!p.js && jsChanged(p.js.raw.title, p.title) },
      { id: 'h1-changed', label: 'H1 cambiado por JS', test: p => !!p.js && jsChanged(p.js.raw.h1, p.h1) },
      { id: 'canonical-changed', label: 'Canonical cambiado por JS', test: p => !!p.js && jsChanged(p.js.raw.canonical, p.canonical) },
      { id: 'robots-changed', label: 'Meta robots cambiado por JS', test: p => !!p.js && jsChanged(p.js.raw.robotsMeta, p.robotsMeta) },
      { id: 'errors', label: 'Con errores de JavaScript', test: p => !!p.js?.errors.length },
      { id: 'render-failed', label: 'No se pudo renderizar', test: p => !!p.js && !p.js.rendered }
    ],
    row: p => ({
      rendered: p.js!.rendered ? 'Sí' : `No: ${p.js!.error ?? ''}`,
      rawWords: p.js!.raw.wordCount,
      words: p.wordCount,
      jsWordsPct: p.wordCount ? Math.max(0, Math.round(((p.wordCount - p.js!.raw.wordCount) / p.wordCount) * 100)) : 0,
      rawLinks: p.js!.raw.internalLinks,
      jsOnlyLinks: p.js!.jsOnlyLinks.length,
      rawTitle: p.js!.raw.title,
      title: p.title,
      jsErrors: p.js!.errors.length,
      renderMs: p.js!.renderMs
    })
  }
];

const IMAGE_FILTERS: Array<{ id: string; label: string; test: (i: Img) => boolean }> = [
  { id: 'all', label: 'Todas', test: () => true },
  { id: 'missing-alt', label: 'Sin atributo alt', test: i => i.alt === null },
  { id: 'empty-alt', label: 'Alt vacío (decorativa)', test: i => i.alt === '' },
  { id: 'alt-over-100', label: 'Alt de más de 100 caracteres', test: i => len(i.alt) > 100 },
  { id: 'missing-dimensions', label: 'Sin width/height', test: i => !i.width || !i.height }
];

// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; pages: ExplorerPage[] }>();

async function loadPages(crawlRunId: string): Promise<ExplorerPage[]> {
  const hit = cache.get(crawlRunId);
  if (hit && Date.now() - hit.at < 60_000) return hit.pages;
  const rows = await prisma.crawledPage.findMany({ where: { crawlRunId }, omit: { htmlGz: true } });
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const pages: ExplorerPage[] = rows.map(r => ({
    id: r.id,
    url: r.url,
    finalUrl: r.finalUrl,
    statusCode: r.statusCode,
    responseTimeMs: r.responseTimeMs,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    title: r.title,
    titleCount: r.titleCount,
    metaDescription: r.metaDescription,
    metaDescriptionCount: r.metaDescriptionCount,
    metaKeywords: r.metaKeywords,
    canonical: r.canonical,
    robotsMeta: r.robotsMeta,
    xRobotsTag: r.xRobotsTag,
    h1: r.h1,
    h1Count: r.h1Count,
    h1All: arr<string>(r.h1All),
    h2: arr<string>(r.h2),
    lang: r.lang,
    hreflang: arr(r.hreflang),
    schemaTypes: arr<string>(r.schemaTypes),
    schemaErrors: r.schemaErrors,
    og: (r.og as ExplorerPage['og']) ?? null,
    twitter: (r.twitter as ExplorerPage['twitter']) ?? null,
    relNext: r.relNext,
    relPrev: r.relPrev,
    images: arr<Img>(r.images),
    inlinks: r.inlinks,
    outlinks: r.outlinks,
    externalLinks: r.externalLinks,
    isIndexable: r.isIndexable,
    indexabilityReason: r.indexabilityReason,
    blockedByRobots: r.blockedByRobots,
    wordCount: r.wordCount,
    depth: r.depth,
    inSitemap: r.inSitemap,
    inLogs: r.inLogs,
    redirectChain: Array.isArray(r.redirectChain) && r.redirectChain.length ? (r.redirectChain as ExplorerPage['redirectChain']) : null,
    js: (r.js as JsInfo | null) ?? null,
    gsc: null as ExplorerPage['gsc']
  }));
  const run = await prisma.crawlRun.findUnique({ where: { id: crawlRunId }, select: { siteId: true } });
  const gsc = run ? await gscPageMap(run.siteId) : null;
  if (gsc) for (const p of pages) p.gsc = gsc.byUrl.get(gscKey(p.url)) ?? null;
  cache.set(crawlRunId, { at: Date.now(), pages });
  if (cache.size > 3) cache.delete(cache.keys().next().value!); // a 100k-URL crawl takes hundreds of MB
  return pages;
}

function context(pages: ExplorerPage[]): Ctx {
  const count = (vals: string[]) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const html = pages.filter(isHtml200);
  return {
    dupTitles: count(html.map(p => key(p.title))),
    dupDescs: count(html.map(p => key(p.metaDescription))),
    dupH1: count(html.map(p => key(p.h1))),
    dupH2: count(html.map(p => key(p.h2[0]))),
    statusByUrl: new Map(pages.map(p => [p.url, p.redirectChain ? p.redirectChain[0].status : p.statusCode]))
  };
}

function imageRows(pages: ExplorerPage[]) {
  return pages.filter(isHtml200).flatMap(p => p.images.map(i => ({ pageId: p.id, url: p.url, src: i.src, alt: i.alt, altLength: len(i.alt), dimensions: i.width && i.height ? `${i.width}×${i.height}` : 'faltan', loading: i.loading ?? '', _img: i })));
}

// ---- Resources (CSS, JS, images, fonts, PDFs…) and external links ----
interface Res {
  url: string;
  kind: string;
  internal: boolean;
  isLink: boolean;
  statusCode: number;
  finalUrl: string;
  redirected: boolean;
  contentType: string;
  sizeBytes: number | null;
  responseTimeMs: number;
  error: string | null;
  foundOn: string[];
  foundOnCount: number;
}
const KIND_LABEL: Record<string, string> = { html: 'Página', css: 'CSS', js: 'JavaScript', image: 'Imagen', font: 'Fuente', pdf: 'PDF', media: 'Audio/vídeo', document: 'Documento', other: 'Otro' };
const resStatus = (r: Res) => (r.statusCode ? (r.redirected ? `${r.statusCode} (tras redirección)` : r.statusCode) : `Sin respuesta${r.error ? `: ${r.error}` : ''}`);
const bad = (r: Res) => r.statusCode === 0 || r.statusCode >= 400;
const statusFilters: Array<{ id: string; label: string; test: (r: Res) => boolean }> = [
  { id: '2xx', label: 'Éxito (2xx)', test: r => r.statusCode >= 200 && r.statusCode < 300 && !r.redirected },
  { id: '3xx', label: 'Redirigen', test: r => r.redirected },
  { id: '4xx', label: 'Error de cliente (4xx)', test: r => r.statusCode >= 400 && r.statusCode < 500 },
  { id: '5xx', label: 'Error de servidor (5xx)', test: r => r.statusCode >= 500 },
  { id: 'no-response', label: 'Sin respuesta', test: r => r.statusCode === 0 }
];
const RES_COLUMNS: Column[] = [
  { key: 'url', label: 'Dirección', type: 'url' },
  { key: 'type', label: 'Tipo' },
  { key: 'contentType', label: 'Tipo de contenido' },
  { key: 'status', label: 'Estado' },
  { key: 'sizeKb', label: 'Tamaño (KB)', type: 'number' },
  { key: 'responseMs', label: 'Respuesta (ms)', type: 'number' },
  { key: 'foundOnCount', label: 'Usado en (páginas)', type: 'number' },
  { key: 'foundOn', label: 'Ejemplo de página', type: 'url' }
];
const RESOURCE_TABS: Array<{ id: string; label: string; columns: Column[]; base: (r: Res) => boolean; filters: Array<{ id: string; label: string; test: (r: Res) => boolean }> }> = [
  {
    id: 'resources',
    label: 'Recursos y archivos',
    columns: RES_COLUMNS,
    base: r => r.internal && !(r.isLink && r.kind === 'html'),
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      ...['css', 'js', 'image', 'font', 'pdf', 'media', 'document', 'other'].map(k => ({ id: k, label: KIND_LABEL[k], test: (r: Res) => r.kind === k })),
      { id: 'broken', label: 'Rotos (4xx, 5xx o sin respuesta)', test: bad },
      { id: 'heavy-image', label: 'Imágenes de más de 200 KB', test: r => r.kind === 'image' && (r.sizeBytes ?? 0) > 200 * 1024 },
      { id: 'heavy', label: 'Archivos de más de 1 MB', test: r => (r.sizeBytes ?? 0) > 1024 * 1024 },
      { id: 'type-mismatch', label: 'Tipo de contenido inesperado', test: r => !!r.contentType && r.statusCode === 200 && ((r.kind === 'css' && !/css/i.test(r.contentType)) || (r.kind === 'js' && !/javascript|ecmascript/i.test(r.contentType)) || (r.kind === 'image' && !/^image\//i.test(r.contentType))) },
      ...statusFilters
    ]
  },
  {
    id: 'external',
    label: 'Externos',
    columns: RES_COLUMNS,
    base: r => !r.internal,
    filters: [
      { id: 'all', label: 'Todos', test: () => true },
      { id: 'links', label: 'Enlaces a otros sitios', test: r => r.isLink },
      { id: 'files', label: 'Recursos de terceros (CDN, scripts…)', test: r => !r.isLink },
      { id: 'broken', label: 'Rotos (4xx, 5xx o sin respuesta)', test: bad },
      { id: 'http', label: 'Enlaces a http:// (no seguro)', test: r => r.url.startsWith('http://') },
      ...statusFilters
    ]
  }
];
const resCache = new Map<string, { at: number; rows: Res[] }>();
async function loadResources(crawlRunId: string): Promise<Res[]> {
  const hit = resCache.get(crawlRunId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = (await prisma.crawledResource.findMany({ where: { crawlRunId } })).map(r => ({ ...r, foundOn: (r.foundOn as string[]) ?? [] }));
  resCache.set(crawlRunId, { at: Date.now(), rows });
  if (resCache.size > 3) resCache.delete(resCache.keys().next().value!);
  return rows;
}
const resRow = (r: Res) => ({ url: r.url, type: KIND_LABEL[r.kind] ?? r.kind, contentType: r.contentType || '—', status: resStatus(r), sizeKb: r.sizeBytes === null ? null : Math.round(r.sizeBytes / 102.4) / 10, responseMs: r.responseTimeMs, foundOnCount: r.foundOnCount, foundOn: r.foundOn[0] ?? '', finalUrl: r.finalUrl !== r.url ? r.finalUrl : '' });

const summaryCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeSummary>> }>();
/** Tab and filter counts. Cached for 10 minutes: a finished crawl does not change. */
export async function explorerSummary(crawlRunId: string) {
  const hit = summaryCache.get(crawlRunId);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const value = await computeSummary(crawlRunId);
  summaryCache.set(crawlRunId, { at: Date.now(), value });
  if (summaryCache.size > 20) summaryCache.delete(summaryCache.keys().next().value!);
  return value;
}

async function computeSummary(crawlRunId: string) {
  const pages = await loadPages(crawlRunId);
  const ctx = context(pages);
  const images = imageRows(pages);
  const res = await loadResources(crawlRunId);
  const byKind: Record<string, number> = { html: pages.filter(p => /html/i.test(p.mimeType)).length };
  for (const r of res) if (r.internal && !(r.isLink && r.kind === 'html')) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return {
    totals: { urls: pages.length, html: pages.filter(isHtml200).length, images: images.length, resources: res.filter(r => r.internal).length, external: res.filter(r => !r.internal).length },
    /** Internal URLs by file type, like Screaming Frog's Overview. */
    fileTypes: Object.entries(byKind).map(([kind, count]) => ({ kind, label: KIND_LABEL[kind] ?? kind, count })).sort((a, b) => b.count - a.count),
    tabs: [
      ...TABS.map(t => ({
      id: t.id,
      label: t.label,
      filters:
        t.id === 'images'
          ? IMAGE_FILTERS.map(f => ({ id: f.id, label: f.label, count: images.filter(r => f.test(r._img)).length }))
          : t.filters.map(f => {
              const base = pages.filter(t.base ?? isHtml200);
              return { id: f.id, label: f.label, count: base.filter(p => f.test(p, ctx)).length };
            })
      })),
      ...RESOURCE_TABS.map(t => {
        const base = res.filter(t.base);
        return { id: t.id, label: t.label, filters: t.filters.map(f => ({ id: f.id, label: f.label, count: base.filter(f.test).length })) };
      })
    ]
  };
}

export interface ExplorerQuery {
  tab: string;
  filter?: string;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function explorerRows(crawlRunId: string, query: ExplorerQuery, opts: { all?: boolean } = {}) {
  const rtab = RESOURCE_TABS.find(t => t.id === query.tab);
  const tab = TABS.find(t => t.id === query.tab) ?? (rtab && { id: rtab.id, label: rtab.label, columns: rtab.columns, filters: [] as Filter[] });
  if (!tab) throw new WorkflowError('UNKNOWN_TAB', `Unknown tab ${query.tab}`, 400);
  const pages = rtab ? [] : await loadPages(crawlRunId);
  const ctx = context(pages);
  let rows: Array<Record<string, unknown>>;
  if (rtab) {
    const f = rtab.filters.find(x => x.id === (query.filter ?? 'all')) ?? rtab.filters[0];
    rows = (await loadResources(crawlRunId)).filter(rtab.base).filter(f.test).map(resRow);
  } else if (tab.id === 'images') {
    const f = IMAGE_FILTERS.find(x => x.id === (query.filter ?? 'all')) ?? IMAGE_FILTERS[0];
    rows = imageRows(pages)
      .filter(r => f.test(r._img))
      .map(({ _img, ...r }) => (void _img, r));
  } else {
    const f = tab.filters.find(x => x.id === (query.filter ?? 'all')) ?? tab.filters[0];
    rows = pages
      .filter((tab as Tab).base ?? isHtml200)
      .filter(p => f.test(p, ctx))
      .map(p => ({ pageId: p.id, url: p.url, ...(tab as Tab).row(p, ctx) }));
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter(r => Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(q)));
  }
  const sortKey = query.sort && tab.columns.some(c => c.key === query.sort) ? query.sort : 'url';
  const dir = query.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const x = a[sortKey];
    const y = b[sortKey];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x ?? '').localeCompare(String(y ?? ''), 'es') * dir;
  });
  const total = rows.length;
  const pageSize = Math.min(query.pageSize ?? 100, 500);
  const page = Math.max(1, query.page ?? 1);
  return { tab: { id: tab.id, label: tab.label, columns: tab.columns }, total, page, pageSize, rows: opts.all ? rows : rows.slice((page - 1) * pageSize, page * pageSize) };
}

/** Everything about one URL: fields, inlinks with anchors, outlinks, images, headers, source and issues. */
export async function explorerPageDetail(crawlRunId: string, pageId: string) {
  const page = await prisma.crawledPage.findFirst({ where: { id: pageId, crawlRunId } });
  if (!page) throw new WorkflowError('PAGE_NOT_FOUND', 'Page not found in this crawl', 404);
  const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } });
  const [inlinks, outlinks, issues] = await Promise.all([
    prisma.crawledLink.findMany({ where: { crawlRunId, targetUrl: { in: [...new Set([page.url, page.finalUrl])] } }, take: 500, select: { sourceUrl: true, anchor: true, nofollow: true } }),
    prisma.crawledLink.findMany({ where: { crawlRunId, sourceUrl: page.finalUrl }, take: 500, select: { targetUrl: true, anchor: true, internal: true, nofollow: true } }),
    prisma.issue.findMany({ where: { siteId: run.siteId, status: { in: ['open', 'in_progress'] } }, select: { code: true, title: true, severity: true, affectedUrls: true } })
  ]);
  const statusByUrl = new Map((await loadPages(crawlRunId)).map(p => [p.url, p.redirectChain ? p.redirectChain[0].status : p.statusCode]));
  let source: string | null = null;
  if (page.htmlGz) {
    const raw = zlib.gunzipSync(Buffer.from(page.htmlGz)).toString('utf8');
    source = raw.length > 500_000 ? `${raw.slice(0, 500_000)}\n<!-- … truncated -->` : raw;
  }
  const { htmlGz: _h, ...fields } = page;
  void _h;
  return {
    page: fields,
    inlinks,
    outlinks: outlinks.map(o => ({ ...o, status: o.internal ? statusByUrl.get(o.targetUrl) ?? null : null })),
    issues: issues.filter(i => Array.isArray(i.affectedUrls) && (i.affectedUrls as string[]).includes(page.url)).map(({ affectedUrls: _a, ...i }) => (void _a, i)),
    source
  };
}

/** CSV of a whole tab + filter (spreadsheet formula injection neutralized). */
export async function explorerCsv(crawlRunId: string, query: ExplorerQuery) {
  const r = await explorerRows(crawlRunId, query, { all: true });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [r.tab.columns.map(c => esc(c.label)).join(','), ...r.rows.map(row => r.tab.columns.map(c => esc(row[c.key])).join(','))].join('\n');
}

// ---------------------------------------------------------------------------
// Custom search and extraction over the stored HTML (no re-crawl needed).

export interface CustomSearchRule {
  name: string;
  /** contains / not_contains: plain text (case-insensitive). regex / not_regex: JavaScript regular expression. */
  mode: 'contains' | 'not_contains' | 'regex' | 'not_regex';
  pattern: string;
  /** html = the whole source; text = visible text only. */
  scope: 'html' | 'text';
}
export interface CustomExtractRule {
  name: string;
  kind: 'css' | 'regex';
  /** CSS selector, or a regex whose first group (or whole match) is extracted. */
  selector: string;
  /** For CSS: 'text' (default), 'html', or an attribute name such as href or content. */
  attr?: string;
}

const MAX_CUSTOM_PAGES = 100_000;
const MAX_HTML_FOR_REGEX = 2 * 1024 * 1024;

function compile(pattern: string): RegExp {
  if (pattern.length > 300) throw new WorkflowError('PATTERN_TOO_LONG', 'La expresión es demasiado larga (máximo 300 caracteres).', 400);
  // Nested quantifiers such as (a+)+ can hang the server on long pages.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) throw new WorkflowError('UNSAFE_PATTERN', 'La expresión tiene cuantificadores anidados, como (a+)+, que pueden bloquear el servidor. Simplifícala.', 400);
  try {
    return new RegExp(pattern, 'gi');
  } catch (e) {
    throw new WorkflowError('INVALID_PATTERN', `Expresión regular inválida: ${(e as Error).message}`, 400);
  }
}

export async function explorerCustom(crawlRunId: string, input: { search?: CustomSearchRule[]; extract?: CustomExtractRule[] }) {
  const search = (input.search ?? []).slice(0, 10);
  const extract = (input.extract ?? []).slice(0, 10);
  if (!search.length && !extract.length) throw new WorkflowError('NO_RULES', 'Agrega al menos una búsqueda o una extracción.', 400);
  const names = new Set<string>();
  for (const r of [...search, ...extract]) {
    if (!r.name?.trim()) throw new WorkflowError('NAME_REQUIRED', 'Cada regla necesita un nombre.', 400);
    if (names.has(r.name)) throw new WorkflowError('DUPLICATE_NAME', `Nombre repetido: ${r.name}`, 400);
    names.add(r.name);
    const body = 'pattern' in r ? r.pattern : r.selector;
    if (!(body ?? '').trim()) throw new WorkflowError('PATTERN_REQUIRED', `La regla "${r.name}" está vacía.`, 400);
  }
  const searchRe = search.map(r => (r.mode === 'regex' || r.mode === 'not_regex' ? compile(r.pattern) : null));
  const extractRe = extract.map(r => (r.kind === 'regex' ? compile(r.selector) : null));
  const cheerio = await import('cheerio');
  for (const r of extract) {
    if (r.kind !== 'css') continue;
    try {
      cheerio.load('<p></p>')(r.selector);
    } catch {
      throw new WorkflowError('INVALID_SELECTOR', `Selector CSS inválido: ${r.selector}`, 400);
    }
  }

  const out: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let cursor: string | undefined;
  // Read the stored HTML in batches so memory stays flat on large crawls.
  for (;;) {
    const batch = await prisma.crawledPage.findMany({ where: { crawlRunId, htmlGz: { not: null } }, select: { id: true, url: true, htmlGz: true }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!batch.length || scanned >= MAX_CUSTOM_PAGES) break;
    cursor = batch[batch.length - 1].id;
  for (const r of batch) {
    scanned++;
    const html = zlib.gunzipSync(r.htmlGz!).toString('utf8').slice(0, MAX_HTML_FOR_REGEX);
    const $ = cheerio.load(html);
    let text: string | null = null;
    const textOf = (): string => {
      if (text === null) {
        const c = cheerio.load(html);
        c('script, style, noscript, template').remove();
        text = c('body').text().replace(/\s+/g, ' ');
      }
      return text;
    };
    const row: Record<string, unknown> = { pageId: r.id, url: r.url };
    let match = false;
    search.forEach((s, i) => {
      const hay = s.scope === 'text' ? textOf() : html;
      let n = 0;
      const re = searchRe[i];
      if (re) n = (hay.match(re) ?? []).length;
      else {
        const needle = s.pattern.toLowerCase();
        const h = hay.toLowerCase();
        for (let at = h.indexOf(needle); at !== -1 && n < 10_000; at = h.indexOf(needle, at + needle.length)) n++;
      }
      const negative = s.mode === 'not_contains' || s.mode === 'not_regex';
      row[s.name] = negative ? (n === 0 ? 'No contiene' : '') : n;
      if (negative ? n === 0 : n > 0) match = true;
    });
    extract.forEach((e, i) => {
      let values: string[] = [];
      const re = extractRe[i];
      if (re) {
        for (const m of html.matchAll(re)) {
          values.push((m[1] ?? m[0]).trim());
          if (values.length >= 20) break;
        }
      } else {
        const attr = (e.attr ?? 'text').trim() || 'text';
        values = $(e.selector)
          .slice(0, 20)
          .map((_, el) => (attr === 'text' ? $(el).text() : attr === 'html' ? $(el).html() ?? '' : $(el).attr(attr) ?? ''))
          .get()
          .map((v: string) => v.replace(/\s+/g, ' ').trim().slice(0, 500))
          .filter(Boolean);
      }
      row[e.name] = values.join(' | ');
      row[`${e.name} (n)`] = values.length;
      if (values.length) match = true;
    });
    row._match = match;
    out.push(row);
  }
  }
  const columns: Column[] = [
    { key: 'url', label: 'Dirección', type: 'url' },
    ...search.map((s): Column => ({ key: s.name, label: s.name, ...(s.mode === 'contains' || s.mode === 'regex' ? { type: 'number' as const } : {}) })),
    ...extract.flatMap((e): Column[] => [
      { key: e.name, label: e.name },
      { key: `${e.name} (n)`, label: `${e.name} (nº)`, type: 'number' }
    ])
  ];
  return { columns, scanned, matched: out.filter(r => r._match).length, rows: out };
}

// ---------------------------------------------------------------------------
// Site structure: folder tree and crawl depth.

export interface StructureNode {
  path: string;
  name: string;
  /** URLs at or below this folder. */
  total: number;
  indexable: number;
  errors: number;
  redirects: number;
  /** The URL that is exactly this folder, if crawled. */
  page: { id: string; url: string; statusCode: number; isIndexable: boolean; title: string | null; inlinks: number; depth: number } | null;
  children: StructureNode[];
}

export async function explorerStructure(crawlRunId: string) {
  const pages = await loadPages(crawlRunId);
  const root: StructureNode = { path: '/', name: '/', total: 0, indexable: 0, errors: 0, redirects: 0, page: null, children: [] };
  for (const p of pages) {
    let u: URL;
    try {
      u = new URL(p.url);
    } catch {
      continue;
    }
    const segs = u.pathname.split('/').filter(Boolean);
    if (u.search) segs.push(u.search);
    const bump = (n: StructureNode) => {
      n.total++;
      if (p.isIndexable) n.indexable++;
      if (p.statusCode >= 400 || p.statusCode === 0) n.errors++;
      if (p.redirectChain) n.redirects++;
    };
    let node = root;
    bump(node);
    let path = '';
    for (const seg of segs) {
      path += seg.startsWith('?') ? seg : `/${seg}`;
      let child = node.children.find(c => c.name === seg);
      if (!child) {
        child = { path, name: seg, total: 0, indexable: 0, errors: 0, redirects: 0, page: null, children: [] };
        node.children.push(child);
      }
      node = child;
      bump(node);
    }
    const info = { id: p.id, url: p.url, statusCode: p.statusCode, isIndexable: p.isIndexable, title: p.title, inlinks: p.inlinks, depth: p.depth };
    if (!node.page || p.url.length < node.page.url.length) node.page = info;
  }
  const sortTree = (n: StructureNode) => {
    n.children.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    n.children.forEach(sortTree);
  };
  sortTree(root);
  const depthMap = new Map<number, { depth: number; total: number; indexable: number; errors: number }>();
  for (const p of pages) {
    const d = depthMap.get(p.depth) ?? { depth: p.depth, total: 0, indexable: 0, errors: 0 };
    d.total++;
    if (p.isIndexable) d.indexable++;
    if (p.statusCode >= 400 || p.statusCode === 0) d.errors++;
    depthMap.set(p.depth, d);
  }
  const html = pages.filter(isHtml200);
  return {
    tree: root,
    depth: [...depthMap.values()].sort((a, b) => a.depth - b.depth),
    stats: {
      urls: pages.length,
      maxDepth: Math.max(0, ...pages.map(p => p.depth)),
      deepPages: html.filter(p => p.depth > 3).length,
      noInlinks: html.filter(p => p.inlinks === 0 && p.depth > 0).length
    }
  };
}
