import { CATALOG, FieldDef, TypeDef, findTypeDef } from './catalog';

/**
 * Validates JSON-LD (generated here or pasted): syntax, @context/@type, the fields Google needs for rich
 * results (errors) or suggests (warnings), and value formats (absolute URLs, ISO dates and durations, numbers,
 * currency codes). Messages are in Spanish and name the field as the generator labels it.
 */

export interface NodeReport {
  type: string;
  label: string;
  path: string;
  errors: string[];
  warnings: string[];
  richResult: string | null;
}

export interface SchemaReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  nodes: NodeReport[];
}

type J = unknown;
const URL_KEYS = new Set(['url', 'logo', 'image', 'item', 'sameAs', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'menu', 'mainEntityOfPage', 'primaryImageOfPage', 'urlTemplate']);
const DATE_KEYS = new Set(['datePublished', 'dateModified', 'startDate', 'endDate', 'uploadDate', 'datePosted', 'validThrough', 'priceValidUntil', 'foundingDate', 'validFrom', 'dateCreated']);
const DURATION_KEYS = new Set(['prepTime', 'cookTime', 'totalTime', 'duration', 'timeRequired', 'courseWorkload']);
const NUMBER_KEYS = new Set(['price', 'ratingValue', 'bestRating', 'worstRating', 'ratingCount', 'reviewCount', 'latitude', 'longitude', 'minValue', 'maxValue', 'lowPrice', 'highPrice']);
const CURRENCY_KEYS = new Set(['priceCurrency', 'currency']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

function labelOf(def: TypeDef | undefined, path: string): string {
  if (!def) return path;
  const parts = path.split('.');
  let fields: FieldDef[] | undefined = def.fields;
  const labels: string[] = [];
  for (const p of parts) {
    const f: FieldDef | undefined = fields?.find(x => x.key === p);
    if (!f) {
      labels.push(p === 'text' ? 'texto' : p === 'name' ? 'nombre' : p);
      fields = undefined;
      continue;
    }
    labels.push(f.label);
    fields = f.fields;
  }
  return labels.join(' › ');
}

/** True when the path has a non-empty value (in any element of arrays along the way). */
function has(node: J, path: string): boolean {
  const [head, ...rest] = path.split('.');
  const vals = Array.isArray(node) ? node : [node];
  return vals.some(v => {
    if (!v || typeof v !== 'object') return false;
    const x = (v as Record<string, J>)[head];
    if (x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length)) return false;
    return rest.length ? has(x, rest.join('.')) : true;
  });
}

function checkFormats(v: J, key: string, where: string, errors: string[], warnings: string[]) {
  if (Array.isArray(v)) return v.forEach((x, i) => checkFormats(x, key, `${where}[${i + 1}]`, errors, warnings));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, J>)) if (!k.startsWith('@')) checkFormats(x, k, where ? `${where}.${k}` : k, errors, warnings);
    return;
  }
  if (typeof v === 'string' && !v.trim()) return warnings.push(`"${where}" está vacío.`);
  if (URL_KEYS.has(key) && typeof v === 'string' && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(v) && !/\{search_term_string\}/.test(v)) errors.push(`"${where}" debe ser una URL completa que empiece con https:// (se recibió "${String(v).slice(0, 60)}").`);
  if (DATE_KEYS.has(key)) {
    if (typeof v !== 'string' || !ISO_DATE.test(v)) errors.push(`"${where}" debe ser una fecha ISO 8601, por ejemplo 2026-10-14 o 2026-10-14T18:30:00-06:00.`);
    else if (/T\d{2}:\d{2}/.test(v) && !/(Z|[+-]\d{2}:?\d{2})$/.test(v)) warnings.push(`"${where}" tiene hora pero no zona horaria; Google recomienda incluirla (por ejemplo -06:00).`);
  }
  if (DURATION_KEYS.has(key) && (typeof v !== 'string' || !ISO_DURATION.test(v))) errors.push(`"${where}" debe ser una duración ISO 8601, por ejemplo PT1H30M (1 h 30 min).`);
  if (NUMBER_KEYS.has(key) && (typeof v === 'string' ? !/^-?\d+(\.\d+)?$/.test(v.trim()) : typeof v !== 'number')) errors.push(`"${where}" debe ser un número (sin símbolos ni texto), por ejemplo 1499.00.`);
  if (CURRENCY_KEYS.has(key) && (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v))) errors.push(`"${where}" debe ser un código de moneda de 3 letras (MXN, USD, EUR…).`);
}

function checkNode(node: Record<string, J>, path: string): NodeReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawType = node['@type'];
  const type = Array.isArray(rawType) ? String(rawType[0]) : rawType ? String(rawType) : '';
  if (!type) errors.push('Falta "@type": indica qué es (Organization, Product, Article…).');
  const def = type ? findTypeDef(type) : undefined;
  if (type && !def) warnings.push(`"${type}" no está en el catálogo del generador; se revisan solo formatos. Comprueba el nombre exacto en schema.org.`);
  if (def) {
    for (const req of def.google.required) {
      const options = req.split('|');
      if (!options.some(p => has(node, p))) errors.push(options.length > 1 ? `Google exige al menos uno de: ${options.map(p => `"${labelOf(def, p)}"`).join(', ')}.` : `Google exige "${labelOf(def, req)}".`);
    }
    for (const rec of def.google.recommended) {
      const options = rec.split('|');
      if (!options.some(p => has(node, p))) warnings.push(`Recomendado: "${options.map(p => labelOf(def, p)).join('" o "')}".`);
    }
    if (def.id === 'Product' && has(node, 'offers') && !has(node, 'offers.price') && !has(node, 'offers.lowPrice')) errors.push('La oferta necesita "Precio".');
    if (def.id === 'Product' && has(node, 'offers.price') && !has(node, 'offers.priceCurrency')) errors.push('La oferta necesita "Moneda".');
    if (def.id === 'Event' && !has(node, 'location.address') && !has(node, 'location.url')) warnings.push('El lugar del evento necesita dirección (presencial) o URL (en línea).');
  }
  checkFormats(node, '', '', errors, warnings);
  return { type: type || 'Desconocido', label: def ? def.subtypes.find(([s]) => s === type)?.[1] ?? def.label : type || 'Desconocido', path, errors: [...new Set(errors)], warnings: [...new Set(warnings)], richResult: def?.google.richResult ?? null };
}

export function validateSchema(input: string | object): SchemaReport {
  let data: J = input;
  if (typeof input === 'string') {
    const s = input.trim().replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '').trim();
    try {
      data = JSON.parse(s);
    } catch (e) {
      return { ok: false, errors: [`El JSON no es válido: ${(e as Error).message}`], warnings: [], nodes: [] };
    }
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const tops = Array.isArray(data) ? data : [data];
  const nodes: NodeReport[] = [];
  tops.forEach((top, i) => {
    if (!top || typeof top !== 'object') return errors.push('El contenido debe ser un objeto JSON.');
    const t = top as Record<string, J>;
    const ctx = t['@context'];
    if (!ctx) errors.push(`Falta "@context": "https://schema.org"${tops.length > 1 ? ` en el bloque ${i + 1}` : ''}.`);
    else if (!/schema\.org/i.test(JSON.stringify(ctx))) warnings.push('"@context" no apunta a https://schema.org.');
    const graph = t['@graph'];
    if (Array.isArray(graph)) graph.forEach((n, k) => n && typeof n === 'object' && nodes.push(checkNode(n as Record<string, J>, `@graph[${k + 1}]`)));
    else nodes.push(checkNode(t, tops.length > 1 ? `[${i + 1}]` : ''));
  });
  return { ok: !errors.length && nodes.every(n => !n.errors.length), errors, warnings, nodes };
}

/** Types the generator knows, for the picker. */
export const CATALOG_SUMMARY = CATALOG.map(t => ({ id: t.id, label: t.label, examples: t.examples }));
