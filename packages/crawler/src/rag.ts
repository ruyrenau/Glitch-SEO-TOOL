import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * "Vista de bot de IA": how a retrieval (RAG) pipeline sees a page. The main content is converted to clean
 * Markdown blocks and split into chunks the way common splitters do (by headings, then by size). Chunks get
 * flags when a table, list or paragraph is cut in half, when they lose their heading context, or when their
 * content only exists after JavaScript (AI crawlers such as GPTBot or ClaudeBot rarely run it).
 */

export type BlockType = 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'quote' | 'image';
export interface Block {
  id: number;
  type: BlockType;
  level?: number;
  /** Markdown of the block. */
  md: string;
  /** Plain text (for comparisons). */
  text: string;
  /** List items or table rows (Markdown), for splitting. */
  parts?: string[];
  /** Only present after JavaScript (filled by markJsOnly). */
  jsOnly?: boolean;
}

export type ChunkFlag = 'split-table' | 'split-list' | 'split-paragraph' | 'no-context' | 'tiny' | 'js-only' | 'key-data-js';
export interface Chunk {
  index: number;
  headings: string[];
  md: string;
  tokens: number;
  flags: ChunkFlag[];
}

/** Rough token count (≈ 4 characters per token, the usual rule of thumb for OpenAI and Anthropic tokenizers). */
export const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre', 'blockquote', 'figure', 'hr', 'dl']);
const SKIP = 'script, style, noscript, template, svg, iframe, canvas, form, button, select, input, textarea';

export interface MarkdownResult {
  blocks: Block[];
  markdown: string;
  title: string | null;
  words: number;
  imagesWithoutAlt: number;
}

export function htmlToMarkdown(html: string, baseUrl: string): MarkdownResult {
  const $ = cheerio.load(html);
  const title = clean($('title').first().text()) || null;
  $(SKIP).remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const c = root.clone();
  c.find('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .menu, .breadcrumb, .breadcrumbs, .sidebar, .cookie, #cookie-banner').remove();

  const abs = (href: string) => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  };
  let imagesWithoutAlt = 0;
  const inline = (nodes: AnyNode[]): string =>
    nodes
      .map(n => {
        if (n.type === 'text') return (n as unknown as { data: string }).data;
        if (n.type !== 'tag') return '';
        const el = n as Element;
        const inner = () => inline(el.children as AnyNode[]);
        switch (el.name) {
          case 'a': {
            const t = clean(inner());
            const href = el.attribs.href;
            return t && href && !href.startsWith('#') && !href.startsWith('javascript:') ? `[${t}](${abs(href)})` : t;
          }
          case 'strong':
          case 'b':
            return clean(inner()) ? `**${clean(inner())}**` : '';
          case 'em':
          case 'i':
            return clean(inner()) ? `*${clean(inner())}*` : '';
          case 'code':
            return `\`${clean(inner())}\``;
          case 'br':
            return ' ';
          case 'img': {
            const alt = clean(el.attribs.alt ?? '');
            if (!alt) {
              imagesWithoutAlt++;
              return '';
            }
            return `![${alt}]`;
          }
          default:
            return ` ${inner()} `;
        }
      })
      .join('');

  const blocks: Block[] = [];
  const push = (b: Omit<Block, 'id'>) => {
    if (!b.text) return;
    blocks.push({ id: blocks.length, ...b });
  };
  const listItems = (el: Element, depth = 0): string[] => {
    const out: string[] = [];
    let n = 1;
    for (const li of (el.children as AnyNode[]).filter(x => x.type === 'tag' && (x as Element).name === 'li') as Element[]) {
      const own = (li.children as AnyNode[]).filter(x => !(x.type === 'tag' && ['ul', 'ol'].includes((x as Element).name)));
      const t = clean(inline(own));
      if (t) out.push(`${'  '.repeat(depth)}${el.name === 'ol' ? `${n++}.` : '-'} ${t}`);
      for (const sub of (li.children as AnyNode[]).filter(x => x.type === 'tag' && ['ul', 'ol'].includes((x as Element).name)) as Element[]) out.push(...listItems(sub, depth + 1));
    }
    return out;
  };

  const walk = (nodes: AnyNode[]) => {
    let run: AnyNode[] = [];
    const flush = () => {
      const t = clean(inline(run));
      run = [];
      if (t) push({ type: 'paragraph', md: t, text: clean(t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '')) });
    };
    for (const n of nodes) {
      if (n.type === 'text') {
        run.push(n);
        continue;
      }
      if (n.type !== 'tag') continue;
      const el = n as Element;
      const name = el.name;
      if (!BLOCK_TAGS.has(name) && !['div', 'section', 'article', 'main', 'li', 'span', 'header', 'figcaption', 'details', 'summary', 'center'].includes(name)) {
        run.push(n);
        continue;
      }
      if (name === 'span' || name === 'summary') {
        // Inline wrappers that sometimes contain blocks.
        if ($(el).find('p, div, h1, h2, h3, ul, ol, table').length) {
          flush();
          walk(el.children as AnyNode[]);
        } else run.push(n);
        continue;
      }
      flush();
      if (/^h[1-6]$/.test(name)) {
        const t = clean(inline(el.children as AnyNode[]).replace(/[*`]/g, ''));
        const level = Number(name[1]);
        push({ type: 'heading', level, md: `${'#'.repeat(level)} ${t}`, text: t });
      } else if (name === 'p') {
        const t = clean(inline(el.children as AnyNode[]));
        push({ type: 'paragraph', md: t, text: clean($(el).text()) });
      } else if (name === 'ul' || name === 'ol') {
        const items = listItems(el);
        push({ type: 'list', md: items.join('\n'), text: clean($(el).text()), parts: items });
      } else if (name === 'table') {
        const rows = $(el).find('tr').toArray().map(tr => $(tr).children('th, td').toArray().map(td => clean(inline((td as Element).children as AnyNode[])).replace(/\|/g, '\\|')));
        const width = Math.max(0, ...rows.map(r => r.length));
        if (!width) continue;
        const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
        const parts = rows.map(line);
        const md = [parts[0], `|${' --- |'.repeat(width)}`, ...parts.slice(1)].join('\n');
        push({ type: 'table', md, text: clean($(el).text()), parts });
      } else if (name === 'pre') {
        const t = $(el).text().trim();
        push({ type: 'code', md: '```\n' + t + '\n```', text: clean(t) });
      } else if (name === 'blockquote') {
        const t = clean(inline(el.children as AnyNode[]));
        push({ type: 'quote', md: `> ${t}`, text: clean($(el).text()) });
      } else if (name === 'hr') {
        // ignore
      } else if (name === 'figure') {
        const img = $(el).find('img').first();
        const alt = clean(img.attr('alt') ?? '');
        const cap = clean($(el).find('figcaption').text());
        if (img.length && !alt) imagesWithoutAlt++;
        const t = clean([alt && `![${alt}]`, cap].filter(Boolean).join(' '));
        if (t) push({ type: 'image', md: t, text: clean(`${alt} ${cap}`) });
      } else if (name === 'dl') {
        const items = $(el).children('dt, dd').toArray().map(x => ((x as Element).name === 'dt' ? `- **${clean($(x).text())}**` : `  ${clean($(x).text())}`));
        push({ type: 'list', md: items.join('\n'), text: clean($(el).text()), parts: items });
      } else walk(el.children as AnyNode[]);
    }
    flush();
  };
  walk(c.contents().toArray());

  const markdown = blocks.map(b => b.md).join('\n\n');
  const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g) ?? []).length, 0);
  return { blocks, markdown, title, words, imagesWithoutAlt };
}

/** Marks the blocks of `rendered` whose text does not exist in `raw` (content created by JavaScript). */
export function markJsOnly(rendered: Block[], raw: Block[]) {
  const rawText = norm(raw.map(b => b.text).join(' '));
  const rawSet = new Set(raw.map(b => norm(b.text)));
  let n = 0;
  for (const b of rendered) {
    const t = norm(b.text);
    b.jsOnly = t.length > 0 && !rawSet.has(t) && !rawText.includes(t.slice(0, 120));
    if (b.jsOnly) n++;
  }
  return n;
}

const KEY_DATA = /(\$|€|£|mxn|usd|eur)\s?\d|\d[\d.,]*\s?(%|€|\$|mxn|usd|kg|km|cm|mm|m²|gb|mb)|\b\d{1,3}([.,]\d{3})+\b/i;

/**
 * Heading-aware chunking: a new chunk starts at H1/H2 (when the current one already has some content) or when
 * the size limit would be passed. Blocks larger than the limit are split by sentences, list items or table rows.
 */
export function chunkBlocks(blocks: Block[], maxTokens = 512): Chunk[] {
  const minForBreak = Math.round(maxTokens * 0.25);
  const chunks: Chunk[] = [];
  const path: string[] = [];
  type Cur = { headings: string[]; parts: string[]; tokens: number; flags: Set<ChunkFlag>; split: Set<number> };
  let cur = null as Cur | null;
  const splitOwners = new Map<number, number[]>(); // block id → chunk indexes holding a piece

  const open = () => (cur = { headings: [...path], parts: [], tokens: 0, flags: new Set(), split: new Set() });
  const close = () => {
    if (cur && cur.parts.length) {
      const md = cur.parts.join('\n\n');
      chunks.push({ index: chunks.length, headings: cur.headings, md, tokens: estimateTokens(md), flags: [...cur.flags] });
      for (const id of cur.split) splitOwners.set(id, [...(splitOwners.get(id) ?? []), chunks.length - 1]);
    }
    cur = null;
  };
  const add = (md: string, b: Block, piece = false) => {
    if (!cur) open();
    cur!.parts.push(md);
    cur!.tokens += estimateTokens(md);
    if (b.jsOnly) {
      cur!.flags.add('js-only');
      if (KEY_DATA.test(b.text)) cur!.flags.add('key-data-js');
    }
    if (piece) cur!.split.add(b.id);
  };

  for (const b of blocks) {
    if (b.type === 'heading') {
      const lvl = b.level ?? 2;
      if (lvl <= 2 && cur && cur.tokens >= minForBreak) close();
      path.splice(Math.max(0, lvl - 1));
      path[lvl - 1] = b.text;
      for (let i = 0; i < path.length; i++) if (path[i] === undefined) path[i] = '';
      if (cur && cur.tokens + estimateTokens(b.md) > maxTokens) close();
      if (!cur) open();
      cur!.headings = path.filter(Boolean);
      add(b.md, b);
      continue;
    }
    const t = estimateTokens(b.md);
    if (cur && cur.tokens + t <= maxTokens) {
      add(b.md, b);
      continue;
    }
    if (t <= maxTokens) {
      close();
      add(b.md, b);
      continue;
    }
    // Bigger than a chunk: split it like a naive splitter would.
    const rough = b.parts?.length ? (b.type === 'table' ? b.md.split('\n') : b.parts) : b.md.split(/(?<=[.!?])\s+/);
    // A single sentence or row longer than a chunk is cut by words, as character splitters do.
    const pieces = rough.flatMap(p => {
      if (estimateTokens(p) <= maxTokens * 0.9) return [p];
      const out: string[] = [];
      let acc = '';
      for (const w of p.split(/\s+/)) {
        if (estimateTokens(`${acc} ${w}`) > maxTokens * 0.9 && acc) {
          out.push(acc);
          acc = w;
        } else acc = acc ? `${acc} ${w}` : w;
      }
      if (acc) out.push(acc);
      return out;
    });
    let buf: string[] = [];
    let bufT = 0;
    const room = () => maxTokens - (cur?.tokens ?? 0);
    for (const p of pieces) {
      const pt = estimateTokens(p) + 1;
      if (bufT + pt > room() && buf.length) {
        add(buf.join(b.type === 'paragraph' ? ' ' : '\n'), b, true);
        close();
        buf = [];
        bufT = 0;
      }
      buf.push(p);
      bufT += pt;
    }
    if (buf.length) add(buf.join(b.type === 'paragraph' ? ' ' : '\n'), b, true);
  }
  close();

  // Flags that need the whole picture.
  for (const [id, idx] of splitOwners) {
    if (idx.length < 2) continue;
    const type = blocks[id].type;
    const flag: ChunkFlag = type === 'table' ? 'split-table' : type === 'list' ? 'split-list' : 'split-paragraph';
    for (const i of idx) if (!chunks[i].flags.includes(flag)) chunks[i].flags.push(flag);
  }
  for (const ch of chunks) {
    if (ch.index > 0 && !ch.headings.length) ch.flags.push('no-context');
    if (ch.tokens < 25) ch.flags.push('tiny');
  }
  return chunks;
}

export const CHUNK_FLAGS: Record<ChunkFlag, { label: string; tone: 'bad' | 'warn' | 'info'; fix: string }> = {
  'split-table': { label: 'Tabla partida', tone: 'bad', fix: 'La tabla queda en varios fragmentos y las filas pierden sus encabezados. Divídela en tablas más pequeñas bajo su propio H2/H3, o resume los datos clave en una lista antes de la tabla.' },
  'key-data-js': { label: 'Dato clave solo con JavaScript', tone: 'bad', fix: 'Precios, cifras o medidas que aparecen solo después de ejecutar JavaScript: los bots de IA no los ven. Sírvelos en el HTML.' },
  'js-only': { label: 'Solo con JavaScript', tone: 'bad', fix: 'Este contenido no está en el HTML que reciben los bots de IA. Renderízalo en el servidor o en el HTML estático.' },
  'split-list': { label: 'Lista partida', tone: 'warn', fix: 'La lista queda en dos fragmentos. Divídela en grupos con subtítulo o acórtala.' },
  'split-paragraph': { label: 'Párrafo partido', tone: 'warn', fix: 'Un párrafo demasiado largo se corta a la mitad. Divídelo en párrafos de una sola idea.' },
  'no-context': { label: 'Sin encabezado', tone: 'warn', fix: 'El fragmento no tiene un H2/H3 que diga de qué trata; al recuperarlo solo, pierde contexto. Agrega subtítulos descriptivos.' },
  tiny: { label: 'Muy corto', tone: 'info', fix: 'Fragmento con muy poco texto: aporta poco al responder. Júntalo con el contenido relacionado.' }
};
