export function createShingles(text: string, k: number = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const shingles = new Set<string>();
  if (words.length < k) {
    shingles.add(words.join(' '));
    return shingles;
  }

  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

export function computeJaccardSimilarity(textA: string, textB: string, k: number = 3): number {
  const shinglesA = createShingles(textA, k);
  const shinglesB = createShingles(textB, k);

  if (shinglesA.size === 0 && shinglesB.size === 0) return 1.0;
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0.0;

  let intersection = 0;
  for (const s of shinglesA) {
    if (shinglesB.has(s)) {
      intersection++;
    }
  }

  const union = shinglesA.size + shinglesB.size - intersection;
  return Math.round((intersection / union) * 100) / 100;
}
