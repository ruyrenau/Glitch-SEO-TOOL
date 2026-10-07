import zlib from 'zlib';
import { prisma } from './client';
import { WorkflowError } from './errors';

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
}

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
    redirectChain: Array.isArray(r.redirectChain) && r.redirectChain.length ? (r.redirectChain as ExplorerPage['redirectChain']) : null
  }));
  cache.set(crawlRunId, { at: Date.now(), pages });
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
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

export async function explorerSummary(crawlRunId: string) {
  const pages = await loadPages(crawlRunId);
  const ctx = context(pages);
  const images = imageRows(pages);
  return {
    totals: { urls: pages.length, html: pages.filter(isHtml200).length, images: images.length },
    tabs: TABS.map(t => ({
      id: t.id,
      label: t.label,
      filters:
        t.id === 'images'
          ? IMAGE_FILTERS.map(f => ({ id: f.id, label: f.label, count: images.filter(r => f.test(r._img)).length }))
          : t.filters.map(f => {
              const base = pages.filter(t.base ?? isHtml200);
              return { id: f.id, label: f.label, count: base.filter(p => f.test(p, ctx)).length };
            })
    }))
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
  const tab = TABS.find(t => t.id === query.tab);
  if (!tab) throw new WorkflowError('UNKNOWN_TAB', `Unknown tab ${query.tab}`, 400);
  const pages = await loadPages(crawlRunId);
  const ctx = context(pages);
  let rows: Array<Record<string, unknown>>;
  if (tab.id === 'images') {
    const f = IMAGE_FILTERS.find(x => x.id === (query.filter ?? 'all')) ?? IMAGE_FILTERS[0];
    rows = imageRows(pages)
      .filter(r => f.test(r._img))
      .map(({ _img, ...r }) => (void _img, r));
  } else {
    const f = tab.filters.find(x => x.id === (query.filter ?? 'all')) ?? tab.filters[0];
    rows = pages
      .filter(tab.base ?? isHtml200)
      .filter(p => f.test(p, ctx))
      .map(p => ({ pageId: p.id, url: p.url, ...tab.row(p, ctx) }));
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
