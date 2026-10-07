import { rate, LabMetrics, Diagnostic, FieldData, FieldMetric } from './metrics';

/** Minimal shape of a Lighthouse result (LHR) — the same in local runs and in PSI's lighthouseResult. */
export interface Lhr {
  lighthouseVersion: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  fetchTime?: string;
  categories: { performance?: { score: number | null } };
  audits: Record<string, { id?: string; title?: string; score?: number | null; numericValue?: number; displayValue?: string; details?: { items?: unknown[]; overallSavingsMs?: number; overallSavingsBytes?: number } }>;
}

/** Audits that answer the spec's checklist: blocking scripts, unsized/offscreen images, unused CSS/JS, caching, fonts, weight. */
export const DIAGNOSTIC_AUDITS = [
  'render-blocking-resources',
  'unsized-images',
  'offscreen-images',
  'unused-javascript',
  'unused-css-rules',
  'uses-long-cache-ttl',
  'font-display',
  'total-byte-weight',
  'bootup-time',
  'mainthread-work-breakdown',
  'dom-size',
  'uses-optimized-images',
  'modern-image-formats',
  'uses-text-compression',
  'largest-contentful-paint-element',
  'layout-shifts'
];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseLab(lhr: Lhr): LabMetrics {
  const a = lhr.audits;
  const score = lhr.categories.performance?.score;
  return {
    performanceScore: typeof score === 'number' ? Math.round(score * 100) : null,
    LCP: num(a['largest-contentful-paint']?.numericValue),
    CLS: num(a['cumulative-layout-shift']?.numericValue),
    TBT: num(a['total-blocking-time']?.numericValue),
    FCP: num(a['first-contentful-paint']?.numericValue),
    SI: num(a['speed-index']?.numericValue),
    TTFB: num(a['server-response-time']?.numericValue)
  };
}

export function parseDiagnostics(lhr: Lhr): Diagnostic[] {
  return DIAGNOSTIC_AUDITS.filter(id => lhr.audits[id])
    .map(id => {
      const au = lhr.audits[id];
      return {
        id,
        title: au.title ?? id,
        score: typeof au.score === 'number' ? au.score : null,
        displayValue: au.displayValue ?? null,
        savingsMs: num(au.details?.overallSavingsMs),
        savingsBytes: num(au.details?.overallSavingsBytes),
        items: Array.isArray(au.details?.items) ? au.details!.items!.length : 0
      };
    })
    .sort((x, y) => (x.score ?? 1) - (y.score ?? 1));
}

export function parseResources(lhr: Lhr) {
  return {
    totalBytes: num(lhr.audits['total-byte-weight']?.numericValue),
    requests: Array.isArray(lhr.audits['network-requests']?.details?.items) ? lhr.audits['network-requests'].details!.items!.length : null
  };
}

/** PSI "loadingExperience" / "originLoadingExperience" (CrUX). */
export interface CruxExperience {
  id?: string;
  metrics?: Record<string, { percentile: number; category?: string; distributions?: Array<{ proportion: number }> }>;
  origin_fallback?: boolean;
  collectionPeriod?: { firstDate: { year: number; month: number; day: number }; lastDate: { year: number; month: number; day: number } };
}

const CRUX_KEYS: Record<string, keyof FieldData['metrics']> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'LCP',
  INTERACTION_TO_NEXT_PAINT: 'INP',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'CLS',
  FIRST_CONTENTFUL_PAINT_MS: 'FCP',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'TTFB'
};

const ymd = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export function parseField(url: CruxExperience | undefined, origin: CruxExperience | undefined): FieldData | null {
  // PSI marks URL data that is really origin data with origin_fallback.
  const useUrl = url?.metrics && Object.keys(url.metrics).length > 0 && !url.origin_fallback;
  const src = useUrl ? url : origin?.metrics && Object.keys(origin.metrics).length ? origin : null;
  if (!src?.metrics) return null;
  const metrics: FieldData['metrics'] = {};
  for (const [k, v] of Object.entries(src.metrics)) {
    const key = CRUX_KEYS[k];
    if (!key) continue;
    // CrUX reports CLS ×100 as an integer.
    const p75 = key === 'CLS' ? v.percentile / 100 : v.percentile;
    const d = v.distributions?.map(x => x.proportion) ?? [];
    metrics[key] = { p75, rating: rate(key, p75), distribution: [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] } as FieldMetric;
  }
  return {
    scope: useUrl ? 'url' : 'origin',
    collectionPeriod: src.collectionPeriod ? { firstDate: ymd(src.collectionPeriod.firstDate), lastDate: ymd(src.collectionPeriod.lastDate) } : null,
    metrics
  };
}
