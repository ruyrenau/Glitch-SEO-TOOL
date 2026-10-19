import crypto from 'crypto';
import * as cheerio from 'cheerio';

/**
 * Text fingerprints for duplicate and near-duplicate content. Only the main content counts (menus, header,
 * footer, sidebars and forms are removed) so that pages sharing a template are not flagged.
 * Near duplicates use MinHash over 5-word shingles: the share of equal slots estimates the Jaccard
 * similarity of the two texts; LSH bands find candidate pairs without comparing every page with every other.
 */

export const MINHASH_SIZE = 64;
const BANDS = 16;
const ROWS = MINHASH_SIZE / BANDS;

export function mainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg, iframe').remove();
  const main = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const c = main.clone();
  c.find('nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], .menu, .breadcrumb, .breadcrumbs, .sidebar, .cookie, #cookie-banner').remove();
  c.find('p, div, li, h1, h2, h3, h4, h5, h6, td, th, br, section').each((_, el) => {
    $(el).append(' ');
  });
  return c.text().replace(/\s+/g, ' ').trim();
}

const normalize = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const wordsOf = (t: string) => normalize(t).match(/[a-z0-9ñ]+/g) ?? [];

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function fmix(h: number) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const SEEDS = Array.from({ length: MINHASH_SIZE }, (_, i) => fmix(0x9e3779b9 * (i + 1)));

export interface Fingerprint {
  words: number;
  /** Exact duplicates: hash of the normalized main text. */
  textHash: string;
  minhash: number[];
}

export function fingerprint(text: string): Fingerprint {
  const w = wordsOf(text);
  const shingles = new Set<string>();
  if (w.length < 5) shingles.add(w.join(' '));
  else for (let i = 0; i + 5 <= w.length; i++) shingles.add(w.slice(i, i + 5).join(' '));
  const mh = new Array<number>(MINHASH_SIZE).fill(0xffffffff);
  for (const s of shingles) {
    const h = fnv1a(s);
    for (let i = 0; i < MINHASH_SIZE; i++) {
      const v = fmix(h ^ SEEDS[i]);
      if (v < mh[i]) mh[i] = v;
    }
  }
  return { words: w.length, textHash: crypto.createHash('sha1').update(w.join(' ')).digest('hex'), minhash: mh };
}

export function minhashSimilarity(a: number[], b: number[]) {
  let eq = 0;
  for (let i = 0; i < MINHASH_SIZE; i++) if (a[i] === b[i]) eq++;
  return eq / MINHASH_SIZE;
}

/** Pairs (i, j) of items whose estimated similarity is at least `threshold`. */
export function nearDuplicatePairs(items: number[][], threshold: number, maxPairs = 20_000): Array<{ a: number; b: number; similarity: number }> {
  const buckets = new Map<string, number[]>();
  items.forEach((mh, idx) => {
    for (let b = 0; b < BANDS; b++) {
      const key = `${b}:${mh.slice(b * ROWS, b * ROWS + ROWS).join(',')}`;
      const list = buckets.get(key);
      if (list) list.push(idx);
      else buckets.set(key, [idx]);
    }
  });
  const seen = new Set<string>();
  const out: Array<{ a: number; b: number; similarity: number }> = [];
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 500) continue; // giant buckets = empty or boilerplate-only pages
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const k = `${list[i]}|${list[j]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const s = minhashSimilarity(items[list[i]], items[list[j]]);
        if (s >= threshold) {
          out.push({ a: list[i], b: list[j], similarity: s });
          if (out.length >= maxPairs) return out;
        }
      }
  }
  return out;
}
