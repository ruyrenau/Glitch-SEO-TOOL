import * as cheerio from 'cheerio';
import { parseRobotsTxt, isAllowedByRobots } from './robots';

/**
 * "Listo para IA": how easy it is for ChatGPT, Gemini, Perplexity or Google's AI Overviews to read a page,
 * extract an answer and cite it. Fixed, explainable rules over the HTML (no AI involved); each check has a
 * weight, a result and the fix in plain Spanish.
 */

export type AiCheckId =
  | 'direct_answer'
  | 'question_headings'
  | 'structure'
  | 'headings'
  | 'schema'
  | 'author_date'
  | 'no_js'
  | 'depth'
  | 'facts'
  | 'sources'
  | 'snippet';

export const AI_CHECKS: Record<AiCheckId, { label: string; weight: number; why: string; fix: string }> = {
  direct_answer: { label: 'Respuesta directa al inicio', weight: 15, why: 'Las IAs toman el primer párrafo claro que responde la pregunta.', fix: 'Abre con un párrafo de 20 a 90 palabras que responda en una o dos frases, justo después del H1.' },
  question_headings: { label: 'Encabezados en forma de pregunta', weight: 10, why: 'Coinciden con cómo la gente le pregunta a la IA.', fix: 'Convierte algunos H2 o H3 en preguntas reales ("¿Cuánto cuesta…?", "¿Cómo funciona…?") y respóndelas debajo.' },
  structure: { label: 'Listas o tablas', weight: 5, why: 'Las IAs copian pasos, listas y comparaciones casi literalmente.', fix: 'Agrega una lista (pasos, ventajas, requisitos) de 3 o más puntos, o una tabla comparativa.' },
  headings: { label: 'Jerarquía de encabezados', weight: 5, why: 'Un H1 y varios H2 dejan claro de qué trata cada parte.', fix: 'Usa un solo H1 y al menos dos H2 que dividan el contenido por temas.' },
  schema: { label: 'Datos estructurados', weight: 15, why: 'Schema.org le dice a la máquina qué es la página (artículo, producto, negocio, preguntas).', fix: 'Agrega JSON-LD del tipo adecuado (Article, FAQPage, HowTo, Product, LocalBusiness…) con el generador Schema.org.' },
  author_date: { label: 'Autor y fecha', weight: 10, why: 'Las IAs prefieren fuentes con autoría y contenido actualizado.', fix: 'Muestra el autor y la fecha de publicación o actualización, y márcalos en el schema (author, datePublished, dateModified).' },
  no_js: { label: 'Contenido visible sin JavaScript', weight: 15, why: 'La mayoría de los bots de IA no ejecutan JavaScript: si el texto se genera en el navegador, no lo ven.', fix: 'Sirve el contenido principal en el HTML (renderizado en servidor o estático).' },
  depth: { label: 'Profundidad del contenido', weight: 10, why: 'Con muy poco texto no hay nada que citar.', fix: 'Desarrolla el tema: al menos 300 palabras útiles.' },
  facts: { label: 'Datos concretos', weight: 5, why: 'Cifras, precios, fechas y porcentajes hacen la respuesta citable.', fix: 'Incluye datos verificables: precios, medidas, plazos, porcentajes, años.' },
  sources: { label: 'Fuentes citadas', weight: 5, why: 'Enlazar a fuentes confiables refuerza la credibilidad.', fix: 'Enlaza a fuentes externas de autoridad (estudios, normas, sitios oficiales).' },
  snippet: { label: 'Permite fragmentos', weight: 5, why: '"nosnippet" o "max-snippet:0" impide que Google use el texto en AI Overviews.', fix: 'Quita nosnippet / max-snippet:0 del meta robots o de X-Robots-Tag.' }
};

export interface AiCheckResult {
  id: AiCheckId;
  /** 0 to 1 (partial credit allowed). */
  score: number;
  detail: string;
}
export interface AiReadiness {
  score: number;
  grade: 'excelente' | 'bien' | 'mejorable' | 'bajo';
  checks: AiCheckResult[];
}

const QUESTION_START = /^(¿|qu[eé]|c[oó]mo|cu[aá]l(es)?|cu[aá]nto|cu[aá]ndo|d[oó]nde|por qu[eé]|para qu[eé]|qui[eé]n|what|how|why|when|where|which|who|can|is|are|do|does)\b/i;
const words = (t: string) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
const clean = (t: string) => t.replace(/\s+/g, ' ').trim();

export function gradeOf(score: number): AiReadiness['grade'] {
  return score >= 80 ? 'excelente' : score >= 60 ? 'bien' : score >= 40 ? 'mejorable' : 'bajo';
}

/**
 * @param html the HTML the server sent (or the rendered DOM when the crawl ran JavaScript)
 * @param opts.rawWordCount words in the server HTML when the crawl ran JavaScript (to detect JS-only content)
 */
export function scoreAiReadiness(html: string, pageUrl: string, opts: { rawWordCount?: number | null; xRobotsTag?: string | null } = {}): AiReadiness {
  const $ = cheerio.load(html);
  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const v = JSON.parse($(el).text());
      jsonLd.push(...(Array.isArray(v) ? v : [v]));
    } catch {
      /* invalid JSON-LD counts as absent */
    }
  });
  const ldNodes: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      ldNodes.push(v as Record<string, unknown>);
      Object.values(v).forEach(walk);
    }
  };
  walk(jsonLd);
  const types = new Set(ldNodes.flatMap(n => [n['@type']].flat()).filter((t): t is string => typeof t === 'string'));
  const robotsMeta = ($('meta[name="robots"]').attr('content') ?? '') + ',' + ($('meta[name="googlebot"]').attr('content') ?? '') + ',' + (opts.xRobotsTag ?? '');

  $('script, style, noscript, template, svg').remove();
  const main = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const content = main.clone();
  content.find('nav, header, footer, aside, form, [role="navigation"]').remove();
  const text = clean(content.text());
  const wc = words(text);
  const checks: AiCheckResult[] = [];
  const add = (id: AiCheckId, score: number, detail: string) => checks.push({ id, score: Math.max(0, Math.min(1, score)), detail });

  // 1. Direct answer: first substantial paragraph near the top.
  const paras = content.find('p').toArray().map(p => clean($(p).text())).filter(p => words(p) >= 8);
  const first = paras[0];
  const fw = first ? words(first) : 0;
  if (!first) add('direct_answer', 0, 'No hay párrafos de texto en el contenido principal.');
  else if (fw >= 20 && fw <= 90) add('direct_answer', 1, `El primer párrafo tiene ${fw} palabras: buen tamaño para una respuesta.`);
  else if (fw > 90) add('direct_answer', 0.5, `El primer párrafo tiene ${fw} palabras; una respuesta corta (20–90) se cita mejor.`);
  else add('direct_answer', 0.5, `El primer párrafo tiene solo ${fw} palabras.`);

  // 2. Question headings.
  const subs = content.find('h2, h3').toArray().map(h => clean($(h).text())).filter(Boolean);
  const qs = subs.filter(h => h.endsWith('?') || QUESTION_START.test(h));
  add('question_headings', qs.length >= 2 ? 1 : qs.length ? 0.5 : 0, qs.length ? `${qs.length} encabezado(s) en forma de pregunta, por ejemplo "${qs[0].slice(0, 80)}".` : `Ninguno de los ${subs.length} H2/H3 es una pregunta.`);

  // 3. Lists or tables.
  const lists = content.find('ul, ol').toArray().filter(l => $(l).children('li').length >= 3).length;
  const tables = content.find('table').length;
  add('structure', lists || tables ? 1 : 0, lists || tables ? `${lists} lista(s) y ${tables} tabla(s).` : 'No hay listas de 3+ puntos ni tablas.');

  // 4. Heading hierarchy.
  const h1 = $('h1').length;
  const h2 = $('h2').length;
  add('headings', (h1 === 1 ? 0.5 : 0) + (h2 >= 2 ? 0.5 : 0), `${h1} H1 y ${h2} H2.`);

  // 5. Structured data.
  const useful = ['Article', 'NewsArticle', 'BlogPosting', 'FAQPage', 'HowTo', 'QAPage', 'Product', 'LocalBusiness', 'Organization', 'Service', 'Recipe', 'Event', 'Course', 'SoftwareApplication', 'Person', 'WebPage'];
  const hasUseful = [...types].some(t => useful.includes(t) || /Business|Store|Restaurant|Dentist|Physician|Attorney|Agency/.test(t));
  add('schema', !types.size ? 0 : hasUseful ? 1 : 0.5, types.size ? `Tipos: ${[...types].slice(0, 6).join(', ')}.` : 'Sin JSON-LD.');

  // 6. Author and date.
  const author = !!($('meta[name="author"]').attr('content') || $('[rel="author"]').length || $('[itemprop="author"], .author, .byline').length || ldNodes.some(n => n.author));
  const dated = !!($('meta[property="article:published_time"], meta[property="article:modified_time"]').length || $('time[datetime]').length || ldNodes.some(n => n.datePublished || n.dateModified));
  add('author_date', (author ? 0.5 : 0) + (dated ? 0.5 : 0), `${author ? 'Con autor' : 'Sin autor'} · ${dated ? 'con fecha' : 'sin fecha'}.`);

  // 7. Content without JavaScript.
  if (opts.rawWordCount !== undefined && opts.rawWordCount !== null) {
    const ratio = wc ? opts.rawWordCount / wc : 1;
    add('no_js', ratio >= 0.7 ? 1 : ratio >= 0.3 ? 0.5 : 0, ratio >= 0.7 ? 'El texto ya viene en el HTML del servidor.' : `Solo ${Math.round(ratio * 100)} % del texto está en el HTML; el resto lo genera JavaScript.`);
  } else add('no_js', wc >= 150 ? 1 : wc >= 50 ? 0.5 : 0, wc >= 150 ? 'El texto viene en el HTML del servidor.' : `Solo ${wc} palabras en el HTML: puede que el contenido dependa de JavaScript (haz un crawl con "Ejecutar JavaScript" para confirmarlo).`);

  // 8. Depth.
  add('depth', wc >= 300 ? 1 : wc >= 150 ? 0.5 : 0, `${wc} palabras en el contenido principal.`);

  // 9. Concrete facts.
  const facts = (text.match(/\b\d+([.,]\d+)?\s?(%|€|\$|usd|mxn|km|kg|cm|mm|m²|años?|meses|días|horas|minutos)|\$\s?\d[\d.,]*|\b(19|20)\d{2}\b/giu) ?? []).length;
  add('facts', facts >= 3 ? 1 : facts ? 0.5 : 0, `${facts} dato(s) con cifras.`);

  // 10. Outbound sources.
  let host = '';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  const ext = new Set(content.find('a[href^="http"]').toArray().map(a => {
    try {
      return new URL($(a).attr('href')!).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }).filter(h => h && h !== host && !/(facebook|twitter|x|instagram|linkedin|youtube|tiktok|pinterest|whatsapp|wa)\.(com|me)$/.test(h)));
  add('sources', ext.size >= 2 ? 1 : ext.size ? 0.5 : 0, ext.size ? `Enlaza a ${ext.size} sitio(s) externo(s).` : 'No enlaza a fuentes externas.');

  // 11. Snippets allowed.
  const blocked = /nosnippet|max-snippet\s*:\s*0\b/i.test(robotsMeta);
  add('snippet', blocked ? 0 : 1, blocked ? 'La página pide no mostrar fragmentos (nosnippet o max-snippet:0).' : 'Permite fragmentos.');

  const score = Math.round(checks.reduce((n, c) => n + c.score * AI_CHECKS[c.id].weight, 0));
  return { score, grade: gradeOf(score), checks };
}

/** AI crawlers worth knowing about: who runs them and what blocking them costs. */
export const AI_BOTS: Array<{ agent: string; owner: string; use: string }> = [
  { agent: 'OAI-SearchBot', owner: 'OpenAI', use: 'Búsqueda de ChatGPT (citas con enlace)' },
  { agent: 'ChatGPT-User', owner: 'OpenAI', use: 'Cuando un usuario de ChatGPT abre tu página' },
  { agent: 'GPTBot', owner: 'OpenAI', use: 'Entrenamiento de modelos' },
  { agent: 'ClaudeBot', owner: 'Anthropic', use: 'Entrenamiento de modelos' },
  { agent: 'Claude-User', owner: 'Anthropic', use: 'Cuando un usuario de Claude abre tu página' },
  { agent: 'Claude-SearchBot', owner: 'Anthropic', use: 'Búsqueda de Claude' },
  { agent: 'PerplexityBot', owner: 'Perplexity', use: 'Búsqueda de Perplexity' },
  { agent: 'Google-Extended', owner: 'Google', use: 'Gemini (no afecta a Google Search ni AI Overviews)' },
  { agent: 'Googlebot', owner: 'Google', use: 'Google Search y AI Overviews' },
  { agent: 'Bingbot', owner: 'Microsoft', use: 'Bing y Copilot' },
  { agent: 'CCBot', owner: 'Common Crawl', use: 'Datos abiertos que usan muchos modelos' }
];

/** Which AI bots robots.txt lets into the home page (null text = no robots.txt, everything allowed). */
export function aiBotAccess(robotsText: string | null): Array<{ agent: string; owner: string; use: string; allowed: boolean }> {
  const robots = robotsText ? parseRobotsTxt(robotsText) : null;
  return AI_BOTS.map(b => ({ ...b, allowed: robots ? isAllowedByRobots(robots, b.agent, '/') : true }));
}
