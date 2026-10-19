/**
 * Internal linking and redirect helpers (pure functions):
 * - Internal PageRank ("Link Score" 0–100) over the crawl's link graph.
 * - TF-IDF vectors and cosine similarity: a local, free "embedding" of each page's main text.
 * - Finding a phrase in plain text, and inserting a link around it in WordPress post HTML without touching
 *   anything else (no re-serialization: the HTML string is edited in place).
 * - Matching a broken URL to the most similar live page (for 301 maps).
 */

// ---------------------------------------------------------------- PageRank
export function internalPageRank(nodes: string[], edges: Array<[string, string]>, opts: { damping?: number; iterations?: number } = {}) {
  const d = opts.damping ?? 0.85;
  const n = nodes.length;
  const idx = new Map(nodes.map((u, i) => [u, i]));
  const out = nodes.map(() => new Set<number>());
  for (const [a, b] of edges) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i !== undefined && j !== undefined && i !== j) out[i].add(j);
  }
  const inn = nodes.map(() => [] as number[]);
  out.forEach((s, i) => s.forEach(j => inn[j].push(i)));
  let pr = new Array(n).fill(1 / Math.max(1, n));
  for (let it = 0; it < (opts.iterations ?? 40); it++) {
    const dangling = pr.reduce((s, v, i) => (out[i].size ? s : s + v), 0);
    const next = new Array(n).fill((1 - d) / n + (d * dangling) / n);
    for (let j = 0; j < n; j++) for (const i of inn[j]) next[j] += (d * pr[i]) / out[i].size;
    pr = next;
  }
  const max = Math.max(...pr, 0);
  // 0–100 on a log scale, like Screaming Frog's Link Score.
  const score = (v: number) => (max ? Math.round((100 * Math.log1p(v * n)) / Math.log1p(max * n)) : 0);
  return new Map(nodes.map((u, i) => [u, { pagerank: pr[i], score: score(pr[i]), inlinks: inn[i].length, outlinks: out[i].size }]));
}

// ---------------------------------------------------------------- text vectors
const STOP = new Set(
  'a al algo algun alguna algunas alguno algunos ante antes como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque que quien se ser si sin sobre son su sus tambien te tiene tienen todo todos tu tus un una uno unos y ya the of and for to in on with what how is are a an or by from at as it be this that your you our we can will not more'.split(' ')
);
export const normText = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = (w: string) => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
export const terms = (t: string) => (normText(t).match(/[a-z0-9ñ]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);

export type Vec = Map<string, number>;
/** TF-IDF unit vectors for a set of documents. */
export function tfidf(docs: string[][]): Vec[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  return docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * Math.log((N + 1) / ((df.get(t) ?? 0) + 1));
      if (w > 0) {
        v.set(t, w);
        norm += w * w;
      }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
}
export function cosine(a: Vec, b: Vec) {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of s) dot += w * (l.get(t) ?? 0);
  return dot;
}

// ---------------------------------------------------------------- phrases
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Accent- and case-insensitive regex for a phrase, on word boundaries. */
export function phraseRegex(phrase: string) {
  const letters: Record<string, string> = { a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]' };
  const body = normText(phrase.trim())
    .split(/\s+/)
    .map(w => [...w].map(ch => letters[ch] ?? esc(ch)).join(''))
    .join('\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?=$|[^\\p{L}\\p{N}])`, 'iu');
}
/** Anchor candidates for a target page: its title parts, H1 and main search queries (2–6 words). */
export function anchorCandidates(input: { title?: string | null; h1?: string | null; queries?: string[] }) {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    const w = t.split(' ').length;
    if (t && w >= 2 && w <= 6 && t.length <= 60 && !out.some(o => normText(o) === normText(t))) out.push(t);
  };
  for (const q of input.queries ?? []) add(q);
  add(input.h1);
  for (const part of (input.title ?? '').split(/\s+[|\-–—:·]\s+/)) add(part);
  return out;
}
/** First occurrence of any phrase in the paragraphs; returns the phrase as written and a short context. */
export function findPhrase(paragraphs: string[], phrases: string[]) {
  for (const phrase of phrases) {
    const re = phraseRegex(phrase);
    for (const p of paragraphs) {
      const m = re.exec(p);
      if (m) {
        const start = m.index + m[1].length;
        const found = m[2];
        const ctx = `${start > 60 ? '…' : ''}${p.slice(Math.max(0, start - 60), start)}[[${found}]]${p.slice(start + found.length, start + found.length + 60)}${start + found.length + 60 < p.length ? '…' : ''}`;
        return { phrase, found, context: ctx };
      }
    }
  }
  return null;
}

/**
 * Wraps the first occurrence of `anchor` in post HTML with a link to `href`, only in plain text: never inside
 * an existing link, a heading, code, a script/style, an HTML comment (Gutenberg block markers) or a shortcode.
 * Returns null when there is no such occurrence. Everything else in the string is left byte for byte.
 */
export function injectLink(html: string, anchor: string, href: string): string | null {
  const re = phraseRegex(anchor);
  const token = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b[^>]*>|\[[^\]]+\]/g;
  const blocked = ['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'script', 'style', 'code', 'pre', 'button', 'figcaption', 'textarea'];
  const depth = new Map<string, number>();
  let last = 0;
  let m: RegExpExecArray | null;
  const tryText = (start: number, end: number) => {
    if ([...depth.values()].some(v => v > 0)) return null;
    const text = html.slice(start, end);
    const hit = re.exec(text);
    if (!hit) return null;
    const s = start + hit.index + hit[1].length;
    const e = s + hit[2].length;
    const safeHref = href.replace(/"/g, '&quot;');
    return `${html.slice(0, s)}<a href="${safeHref}">${html.slice(s, e)}</a>${html.slice(e)}`;
  };
  while ((m = token.exec(html))) {
    const r = tryText(last, m.index);
    if (r) return r;
    const tag = m[1]?.toLowerCase();
    if (tag && blocked.includes(tag) && !m[0].endsWith('/>')) {
      const closing = m[0].startsWith('</');
      depth.set(tag, Math.max(0, (depth.get(tag) ?? 0) + (closing ? -1 : 1)));
    }
    last = token.lastIndex;
  }
  return tryText(last, html.length);
}

// ---------------------------------------------------------------- redirects
const NOISE = new Set(['html', 'htm', 'php', 'aspx', 'asp', 'index', 'www', 'amp', 'page', 'pagina']);
export function urlTerms(u: string) {
  let path = u;
  try {
    path = decodeURIComponent(new URL(u).pathname);
  } catch {
    /* already a path */
  }
  return [...new Set(terms(path.replace(/[-_./+]+/g, ' ')).filter(t => !NOISE.has(t) && !/^\d{1,4}$/.test(t)))];
}
const jac = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const s = new Set(b);
  const i = a.filter(x => s.has(x)).length;
  return i / (a.length + b.length - i);
};
const parentPath = (u: string) => {
  try {
    const p = new URL(u).pathname.replace(/\/+$/, '');
    return p.slice(0, p.lastIndexOf('/') + 1) || '/';
  } catch {
    return '/';
  }
};

export interface RedirectCandidate {
  url: string;
  title: string | null;
  /** Main-text vector (optional), compared with the old page's vector when the old content is known. */
  vec?: Vec;
}
/**
 * Best live page for a broken URL: words of the old URL (and its old title / text when an earlier crawl had it)
 * against each candidate's URL, title and text. Falls back to the parent folder, then the home page.
 */
export function matchRedirect(broken: { url: string; oldTitle?: string | null; oldVec?: Vec | null }, candidates: RedirectCandidate[], home: string) {
  // Words of the last segment only: the folder ("blog") is shared by every sibling and counts apart.
  const leaf = (() => {
    try {
      return new URL(broken.url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
    } catch {
      return '';
    }
  })();
  const bt = leaf ? urlTerms(`https://x.invalid/${leaf}`) : urlTerms(broken.url);
  const tt = terms(broken.oldTitle ?? '');
  let best: { url: string; score: number; reason: string } | null = null;
  for (const c of candidates) {
    if (c.url === broken.url) continue;
    const ct = urlTerms(c.url);
    const titleT = terms(c.title ?? '');
    let score = 0.55 * jac(bt, ct) + 0.35 * jac([...new Set([...bt, ...tt])], titleT);
    if (parentPath(c.url) === parentPath(broken.url)) score += 0.1;
    let reason = 'Palabras de la URL y del título';
    if (broken.oldVec && c.vec) {
      const sim = cosine(broken.oldVec, c.vec);
      if (sim > score) reason = 'Contenido parecido al que tenía la página';
      score = Math.max(score, sim);
    }
    if (!best || score > best.score) best = { url: c.url, score, reason };
  }
  if (best && best.score >= 0.2) return { target: best.url, score: Math.round(best.score * 100), confidence: best.score >= 0.5 ? 'alta' : best.score >= 0.3 ? 'media' : 'baja', reason: best.reason } as const;
  const parent = parentPath(broken.url);
  const folder = candidates.find(c => {
    try {
      return new URL(c.url).pathname.replace(/\/+$/, '/') === parent && parent !== '/';
    } catch {
      return false;
    }
  });
  if (folder) return { target: folder.url, score: 15, confidence: 'baja', reason: 'No hay una página parecida: se propone la carpeta superior' } as const;
  return { target: home, score: 0, confidence: 'baja', reason: 'No hay una página parecida: se propone la página principal (revísalo; para Google puede contar como soft 404)' } as const;
}
