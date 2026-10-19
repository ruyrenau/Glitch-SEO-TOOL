/**
 * llms.txt (https://llmstxt.org): a Markdown file at the site root that gives language models a clean map of
 * the site: an H1 with the name, a blockquote summary, optional notes, and H2 sections with link lists
 * ("- [Title](url): description"). An "## Optional" section holds links that can be skipped for a short context.
 * llms-full.txt is the same idea with the full content of the pages inlined.
 */

export interface LlmsPage {
  url: string;
  title: string | null;
  description: string | null;
  /** Higher first (clicks, internal links…). */
  priority: number;
}

export interface LlmsOptions {
  siteName: string;
  summary: string | null;
  details?: string | null;
  perSection?: number;
  maxLinks?: number;
}

const OPTIONAL = /(^|\/)(legal|privacidad|privacy|aviso|terminos|terms|cookies|politica|policy|tag|tags|etiqueta|author|autor|page\/\d+|feed|wp-json|login|cart|carrito|checkout|account|mi-cuenta)(\/|$)/i;
const SECTION_NAMES: Record<string, string> = {
  blog: 'Blog', noticias: 'Noticias', news: 'Noticias', servicios: 'Servicios', services: 'Servicios', productos: 'Productos', products: 'Productos', product: 'Productos',
  tienda: 'Tienda', shop: 'Tienda', docs: 'Documentación', documentacion: 'Documentación', ayuda: 'Ayuda', help: 'Ayuda', faq: 'Preguntas frecuentes', preguntas: 'Preguntas frecuentes',
  nosotros: 'Nosotros', about: 'Nosotros', contacto: 'Contacto', contact: 'Contacto', casos: 'Casos de éxito', 'casos-de-exito': 'Casos de éxito', recursos: 'Recursos', resources: 'Recursos',
  categoria: 'Categorías', category: 'Categorías', precios: 'Precios', pricing: 'Precios'
};
const pretty = (seg: string) => SECTION_NAMES[seg.toLowerCase()] ?? seg.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const escTitle = (s: string) => s.replace(/[[\]]/g, '');

export function generateLlmsTxt(pages: LlmsPage[], o: LlmsOptions) {
  const perSection = o.perSection ?? 25;
  const maxLinks = o.maxLinks ?? 200;
  const groups = new Map<string, LlmsPage[]>();
  const optional: LlmsPage[] = [];
  let home: LlmsPage | null = null;
  for (const p of [...pages].sort((a, b) => b.priority - a.priority)) {
    let path = '/';
    try {
      path = new URL(p.url).pathname;
    } catch {
      continue;
    }
    if (path === '/' || path === '') {
      home ??= p;
      continue;
    }
    if (OPTIONAL.test(path)) {
      optional.push(p);
      continue;
    }
    const segs = path.split('/').filter(Boolean);
    const key = segs.length > 1 ? pretty(segs[0]) : 'Páginas principales';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  // Small folders join "Páginas principales"; biggest sections first.
  const main = groups.get('Páginas principales') ?? [];
  for (const [k, v] of [...groups]) if (k !== 'Páginas principales' && v.length < 2) {
    main.push(...v);
    groups.delete(k);
  }
  if (main.length) groups.set('Páginas principales', main.sort((a, b) => b.priority - a.priority));
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === 'Páginas principales' ? -1 : b[0] === 'Páginas principales' ? 1 : b[1].length - a[1].length));

  const line = (p: LlmsPage) => {
    const t = escTitle(oneLine(p.title) || p.url);
    const d = oneLine(p.description);
    return `- [${t}](${p.url})${d ? `: ${d}` : ''}`;
  };
  const out: string[] = [`# ${oneLine(o.siteName)}`, ''];
  const summary = oneLine(o.summary) || oneLine(home?.description);
  if (summary) out.push(`> ${summary}`, '');
  if (o.details) out.push(oneLine(o.details), '');
  let links = 0;
  let sections = 0;
  for (const [name, list] of ordered) {
    const take = list.slice(0, Math.max(0, Math.min(perSection, maxLinks - links)));
    if (!take.length) continue;
    out.push(`## ${name}`, '', ...take.map(line), '');
    links += take.length;
    sections++;
  }
  const opt = optional.slice(0, Math.max(0, Math.min(perSection, maxLinks - links)));
  if (opt.length) {
    out.push('## Optional', '', ...opt.map(line), '');
    links += opt.length;
  }
  return { text: out.join('\n').trimEnd() + '\n', links, sections, skipped: Math.max(0, pages.length - links - (home ? 1 : 0)) };
}

export interface LlmsCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: 'error' | 'warn' | 'info';
  detail: string;
}
export interface LlmsLink {
  text: string;
  url: string;
  section: string;
  status: 'ok' | 'not-crawled' | 'broken' | 'non-indexable' | 'external' | 'invalid';
  detail?: string;
}

/**
 * Validates an llms.txt against the format and against what the crawl knows about each link.
 * `known` maps normalized URLs to their crawl status.
 */
export function validateLlmsTxt(text: string, opts: { host: string; contentType?: string | null; known: (url: string) => { status: number; indexable: boolean } | null }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const checks: LlmsCheck[] = [];
  const add = (id: string, label: string, ok: boolean, severity: LlmsCheck['severity'], detail: string) => checks.push({ id, label, ok, severity, detail });
  const firstContent = lines.find(l => l.trim());
  const h1s = lines.filter(l => /^#\s+\S/.test(l));
  add('h1', 'Empieza con un H1 con el nombre', !!firstContent && /^#\s+\S/.test(firstContent) && h1s.length === 1, 'error', h1s.length === 1 ? `"${h1s[0].slice(2).trim()}"` : h1s.length ? `Hay ${h1s.length} H1; debe haber uno solo, al inicio.` : 'No hay una línea "# Nombre del sitio" al inicio.');
  const quote = lines.find(l => /^>\s*\S/.test(l));
  add('summary', 'Resumen en blockquote (> …)', !!quote, 'warn', quote ? quote.replace(/^>\s*/, '').slice(0, 160) : 'Agrega debajo del H1 una línea "> Qué es el sitio y para quién" en una o dos frases.');
  const h2 = lines.filter(l => /^##\s+\S/.test(l)).map(l => l.replace(/^##\s+/, '').trim());
  add('sections', 'Secciones H2 con enlaces', h2.length > 0, 'error', h2.length ? h2.join(', ') : 'No hay secciones "## Nombre" con listas de enlaces.');
  add('h3plus', 'Sin encabezados de más nivel que H2', !lines.some(l => /^#{3,}\s/.test(l)), 'info', 'El formato usa solo H1 y H2; los H3 no rompen nada, pero algunos lectores los ignoran.');

  const links: LlmsLink[] = [];
  let section = '';
  let badLines = 0;
  for (const l of lines) {
    if (/^##\s+/.test(l)) section = l.replace(/^##\s+/, '').trim();
    if (!/^\s*[-*]\s+/.test(l)) continue;
    const m = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)(:\s*.*)?$/.exec(l);
    if (!m) {
      badLines++;
      continue;
    }
    const [, t, href] = m;
    let u: URL | null = null;
    try {
      u = new URL(href);
    } catch {
      links.push({ text: t, url: href, section, status: 'invalid', detail: 'URL incompleta: usa direcciones absolutas (https://…).' });
      continue;
    }
    if (u.hostname.replace(/^www\./, '') !== opts.host.replace(/^www\./, '')) {
      links.push({ text: t, url: href, section, status: 'external' });
      continue;
    }
    const k = opts.known(u.toString());
    if (!k) links.push({ text: t, url: href, section, status: 'not-crawled', detail: 'No apareció en el crawl.' });
    else if (k.status >= 400 || k.status === 0) links.push({ text: t, url: href, section, status: 'broken', detail: `Responde ${k.status || 'error'}.` });
    else if (!k.indexable || (k.status >= 300 && k.status < 400)) links.push({ text: t, url: href, section, status: 'non-indexable', detail: k.status >= 300 && k.status < 400 ? `Redirige (${k.status}).` : 'No es indexable.' });
    else links.push({ text: t, url: href, section, status: 'ok' });
  }
  add('format', 'Enlaces con el formato "- [Título](url): descripción"', badLines === 0 && links.length > 0, links.length ? 'warn' : 'error', badLines ? `${badLines} línea(s) de lista no tienen el formato de enlace.` : `${links.length} enlaces.`);
  const broken = links.filter(l => l.status === 'broken' || l.status === 'invalid').length;
  add('broken', 'Sin enlaces rotos', broken === 0, 'error', broken ? `${broken} enlace(s) rotos o inválidos.` : 'Todos los enlaces responden.');
  const nonIdx = links.filter(l => l.status === 'non-indexable').length;
  add('indexable', 'Enlaces a páginas indexables', nonIdx === 0, 'warn', nonIdx ? `${nonIdx} enlace(s) a páginas que redirigen o no son indexables.` : 'Bien.');
  const kb = Math.round(Buffer.byteLength(text, 'utf8') / 1024);
  add('size', 'Tamaño razonable', kb <= 100, 'warn', kb > 100 ? `${kb} KB: un llms.txt debe ser un índice corto; el contenido completo va en llms-full.txt.` : `${kb} KB.`);
  if (opts.contentType !== undefined) {
    const ct = (opts.contentType ?? '').toLowerCase();
    add('content-type', 'Se sirve como texto', /text\/(plain|markdown)/.test(ct), 'warn', ct ? `Content-Type: ${ct}` : 'Sin Content-Type.');
  }
  const errors = checks.filter(c => !c.ok && c.severity === 'error').length;
  const warns = checks.filter(c => !c.ok && c.severity === 'warn').length;
  return { checks, links, sections: h2, errors, warnings: warns };
}
