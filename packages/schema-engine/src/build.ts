import { CUSTOM_TYPE_ID, ENUM_URL_KEYS, FieldDef, findTypeDef } from './catalog';

/**
 * Form state → JSON-LD. Empty values are dropped; Google-specific shapes (FAQ answers, breadcrumb
 * positions, search box, remote jobs, salaries, durations…) are produced here so the form stays simple.
 */

export type FormValue = string | boolean | string[] | FormObject | FormObject[] | undefined;
export interface FormObject {
  '@type'?: string;
  [key: string]: FormValue;
}

export interface SchemaForm {
  /** Catalog id (Organization, Product…) or "Custom". */
  typeId: string;
  /** The @type written (a subtype of the catalog entry, or any schema.org type for Custom). */
  type: string;
  values: Record<string, FormValue>;
  /** Extra properties for anything the form does not cover: [schema.org property, value or JSON]. */
  extra?: Array<{ key: string; value: string }>;
}

export interface BuildOptions {
  /** URL of the page the schema describes; used for @id. */
  pageUrl?: string;
  /** Offset added to date-times without one, e.g. "-06:00". */
  tzOffset?: string;
}

type Json = string | number | boolean | Json[] | { [k: string]: Json };

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).filter(k => k !== '@type').length === 0);

/** "1 h 30 min", "45 min", "2 horas", "1:30", "90" (minutes) or ISO "PT1H30M" → ISO 8601 duration. */
export function toIsoDuration(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^p(\d+[ymwd])*(t(\d+(\.\d+)?[hms])+)?$/i.test(s) && s !== 'p') return s.toUpperCase();
  const hm = /^(\d+):(\d{1,2})$/.exec(s);
  if (hm) return `PT${Number(hm[1]) ? `${Number(hm[1])}H` : ''}${Number(hm[2]) ? `${Number(hm[2])}M` : ''}` || 'PT0M';
  if (/^\d+$/.test(s)) return `PT${Number(s)}M`;
  let d = 0;
  let h = 0;
  let m = 0;
  let sec = 0;
  let matched = false;
  for (const [, num, unit] of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(d[ií]as?|days?|d\b|horas?|hrs?|hours?|h\b|minutos?|mins?|minutes?|m\b|segundos?|secs?|seconds?|s\b)/g)) {
    matched = true;
    const n = Number(num.replace(',', '.'));
    if (/^d/.test(unit)) d += n;
    else if (/^h/.test(unit)) h += n;
    else if (/^m/.test(unit)) m += n;
    else sec += n;
  }
  if (!matched) return null;
  const date = d ? `P${d}D` : 'P';
  const time = h || m || sec ? `T${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec ? `${sec}S` : ''}` : '';
  return date + time === 'P' ? null : date + time;
}

const num = (v: string): number | string => {
  const n = Number(v.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) ? n : v;
};

function convertScalar(f: FieldDef, raw: string, o: BuildOptions): Json | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  switch (f.kind) {
    case 'number':
      return num(v);
    case 'integer': {
      const n = num(v);
      return typeof n === 'number' ? Math.round(n) : n;
    }
    case 'currency':
      return v.toUpperCase();
    case 'duration':
      return toIsoDuration(v) ?? v;
    case 'datetime':
      // <input type="datetime-local"> gives "2026-10-14T18:30"; add seconds and the offset when missing.
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00${o.tzOffset ?? ''}`;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) return `${v}${o.tzOffset ?? ''}`;
      return v;
    case 'enum':
      return ENUM_URL_KEYS.has(f.key) && !/^https?:/.test(v) ? `https://schema.org/${v}` : v;
    default:
      return v;
  }
}

function convertField(f: FieldDef, value: FormValue, o: BuildOptions): Json | undefined {
  if (value === undefined) return undefined;
  if (f.kind === 'boolean') return value === true ? true : undefined;
  if (f.kind === 'object') {
    const one = (v: FormObject): Json | undefined => {
      const out: Record<string, Json> = { '@type': v['@type'] || f.itemType || f.itemTypes?.[0] || 'Thing' };
      for (const sub of f.fields ?? []) {
        const c = convertField(sub, v[sub.key], o);
        if (!isEmpty(c)) out[sub.key] = c!;
      }
      return isEmpty(out) ? undefined : out;
    };
    const list = (Array.isArray(value) ? value : [value]).filter((x): x is FormObject => !!x && typeof x === 'object').map(one).filter((x): x is Json => x !== undefined);
    if (!list.length) return undefined;
    return f.multiple ? list : list[0];
  }
  if (f.multiple || Array.isArray(value)) {
    const arr = (Array.isArray(value) ? value : [value]).map(x => (typeof x === 'string' ? convertScalar(f, x, o) : undefined)).filter((x): x is Json => x !== undefined);
    return arr.length ? arr : undefined;
  }
  return typeof value === 'string' ? convertScalar(f, value, o) : undefined;
}

/** Google-specific shapes, applied after the generic conversion. */
function shape(type: string, typeId: string, obj: Record<string, Json>) {
  const arr = (v: Json | undefined): Json[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  if (typeId === 'FAQPage' && obj.mainEntity) {
    obj.mainEntity = arr(obj.mainEntity).map(q => {
      const qq = { ...(q as Record<string, Json>) };
      if (typeof qq.acceptedAnswer === 'string') qq.acceptedAnswer = { '@type': 'Answer', text: qq.acceptedAnswer };
      return qq;
    });
  }
  if (typeId === 'BreadcrumbList' && obj.itemListElement) obj.itemListElement = arr(obj.itemListElement).map((li, i) => ({ ...(li as Record<string, Json>), position: i + 1 }));
  if (typeId === 'HowTo') {
    if (obj.supply) obj.supply = arr(obj.supply).map(s => ({ '@type': 'HowToSupply', name: s }));
    if (obj.tool) obj.tool = arr(obj.tool).map(s => ({ '@type': 'HowToTool', name: s }));
    if (obj.step) obj.step = arr(obj.step);
  }
  if (typeId === 'Recipe' && obj.recipeInstructions) obj.recipeInstructions = arr(obj.recipeInstructions).map(t => ({ '@type': 'HowToStep', text: t }));
  if (typeId === 'WebSite' && typeof obj.searchUrl === 'string') {
    obj.potentialAction = { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: obj.searchUrl }, 'query-input': 'required name=search_term_string' };
    delete obj.searchUrl;
  }
  if (typeId === 'Event') {
    const online = typeof obj.onlineUrl === 'string' ? { '@type': 'VirtualLocation', url: obj.onlineUrl } : null;
    delete obj.onlineUrl;
    if (online) obj.location = obj.location ? [obj.location as Json, online] : online;
  }
  if (typeId === 'JobPosting') {
    if (obj.remote === true) obj.jobLocationType = 'TELECOMMUTE';
    if (typeof obj.applicantCountry === 'string') obj.applicantLocationRequirements = { '@type': 'Country', name: obj.applicantCountry };
    delete obj.remote;
    delete obj.applicantCountry;
    const sal = obj.baseSalary as Record<string, Json> | undefined;
    if (sal) {
      const value: Record<string, Json> = { '@type': 'QuantitativeValue' };
      for (const k of ['minValue', 'maxValue', 'unitText']) if (sal[k] !== undefined) value[k] = sal[k];
      obj.baseSalary = { '@type': 'MonetaryAmount', ...(sal.currency ? { currency: sal.currency } : {}), value };
    }
  }
  return obj;
}

/** Parses an extra property's value: JSON objects/arrays/numbers as such, everything else as text. */
function parseExtra(v: string): Json {
  const t = v.trim();
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t) as Json;
    } catch {
      return t;
    }
  }
  return t;
}

export function buildNode(form: SchemaForm, o: BuildOptions = {}): Record<string, Json> {
  const def = form.typeId === CUSTOM_TYPE_ID ? undefined : findTypeDef(form.typeId);
  let obj: Record<string, Json> = { '@type': (form.type || def?.subtypes[0][0] || 'Thing').trim() };
  if (o.pageUrl) obj['@id'] = `${o.pageUrl.split('#')[0]}#${obj['@type'].toString().toLowerCase()}`;
  for (const f of def?.fields ?? []) {
    const c = convertField(f, form.values[f.key], o);
    if (!isEmpty(c)) obj[f.key] = c!;
  }
  if (def) obj = shape(String(obj['@type']), def.id, obj);
  for (const { key, value } of form.extra ?? []) {
    const k = key.trim();
    if (k && value.trim() && !k.startsWith('@')) obj[k] = parseExtra(value);
  }
  return obj;
}

/** One schema → a JSON-LD object; several → a single @graph (one script tag for the page). */
export function buildJsonLd(forms: SchemaForm[], o: BuildOptions = {}): Record<string, Json> {
  const nodes = forms.map(f => buildNode(f, o));
  if (nodes.length === 1) return { '@context': 'https://schema.org', ...nodes[0] };
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** The tag to paste in the page's <head>. "<" is escaped so text inside the JSON can never close the script. */
export function toScriptTag(jsonLd: object): string {
  return `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c')}\n</script>`;
}

/** Replaces {{column}} placeholders in every string of a form (bulk generation from a CSV row). */
export function fillTemplate(form: SchemaForm, row: Record<string, string>): SchemaForm {
  const fill = (s: string) => s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k: string) => row[k] ?? '');
  const walk = (v: FormValue): FormValue => {
    if (typeof v === 'string') return fill(v);
    if (Array.isArray(v)) return (v as Array<string | FormObject>).map(x => walk(x as FormValue)) as FormValue;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) as FormObject;
    return v;
  };
  return { ...form, type: fill(form.type), values: Object.fromEntries(Object.entries(form.values).map(([k, v]) => [k, walk(v)])), extra: form.extra?.map(e => ({ key: e.key, value: fill(e.value) })) };
}

/** Placeholders used by a template, to check them against the CSV columns. */
export function templatePlaceholders(form: SchemaForm): string[] {
  const found = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) found.add(m[1]);
  };
  const walk = (v: unknown) => {
    if (typeof v === 'string') scan(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  scan(form.type);
  walk(form.values);
  form.extra?.forEach(e => scan(e.value));
  return [...found];
}
