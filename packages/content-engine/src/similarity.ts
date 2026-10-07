import crypto from 'crypto';

/** Lowercase words without HTML, accents or punctuation ("Auditoría" -> "auditoria"). */
export function toWords(text: string): string[] {
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function createShingles(text: string, k = 3): Set<string> {
  const words = toWords(text);
  const shingles = new Set<string>();
  if (words.length < k) {
    if (words.length) shingles.add(words.join(' '));
    return shingles;
  }
  for (let i = 0; i <= words.length - k; i++) shingles.add(words.slice(i, i + k).join(' '));
  return shingles;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) if (big.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

export function computeJaccardSimilarity(textA: string, textB: string, k = 3): number {
  const a = createShingles(textA, k);
  const b = createShingles(textB, k);
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;
  return Math.round(jaccard(a, b) * 100) / 100;
}

/**
 * Content a page adds beyond its template: shingles and words that are not part of
 * the boilerplate (the template rendered with every variable empty). Comparing pages
 * on this part avoids flagging every page of a template as a duplicate of the others,
 * and measures what the data actually contributes.
 */
export function specificContent(content: string, boilerplate: string, k = 3) {
  const page = createShingles(content, k);
  const base = createShingles(boilerplate, k);
  const shingles = new Set([...page].filter(s => !base.has(s)));
  const baseCounts = new Map<string, number>();
  for (const w of toWords(boilerplate)) baseCounts.set(w, (baseCounts.get(w) ?? 0) + 1);
  let uniqueWords = 0;
  for (const w of toWords(content)) {
    const c = baseCounts.get(w) ?? 0;
    if (c > 0) baseCounts.set(w, c - 1);
    else uniqueWords++;
  }
  return { shingles, uniqueWords, totalWords: toWords(content).length };
}

/** 64-bit SimHash over word 3-grams; near-identical texts have a small Hamming distance. */
export function simhash(text: string): bigint {
  const v = new Array(64).fill(0);
  for (const s of createShingles(text, 3)) {
    const h = crypto.createHash('md5').update(s).digest();
    const x = h.readBigUInt64BE(0);
    for (let i = 0; i < 64; i++) v[i] += (x >> BigInt(i)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) out |= 1n << BigInt(i);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
