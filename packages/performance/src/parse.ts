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

// ---------------------------------------------------------------------------
// GTmetrix-style report: screenshot, filmstrip, grade, top issues, page weight by type, waterfall.

type AnyAudit = {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  displayValue?: string;
  metricSavings?: Partial<Record<'FCP' | 'LCP' | 'TBT' | 'CLS' | 'INP', number>>;
  details?: { type?: string; data?: string; timing?: number; items?: Array<Record<string, unknown>>; overallSavingsMs?: number; overallSavingsBytes?: number };
};
type FullLhr = { audits: Record<string, AnyAudit>; categories: { performance?: { score: number | null; auditRefs?: Array<{ id: string; group?: string; weight?: number }> } } };

export type ReportMetric = 'FCP' | 'LCP' | 'TBT' | 'CLS';
export type Impact = 'Alto' | 'Medio' | 'Medio-bajo' | 'Bajo';

export interface ReportIssue {
  id: string;
  title: string;
  description: string;
  displayValue: string | null;
  score: number;
  impact: Impact;
  metrics: ReportMetric[];
  savingsMs: number | null;
  savingsBytes: number | null;
  items: Array<{ label: string; url: string | null; wastedBytes: number | null; wastedMs: number | null; totalBytes: number | null }>;
  itemCount: number;
}

export type ResourceGroup = 'HTML' | 'JS' | 'CSS' | 'IMG' | 'Video' | 'Font' | 'XHR' | 'Other';

export interface WaterfallEntry {
  url: string;
  group: ResourceGroup;
  mimeType: string;
  status: number;
  start: number;
  end: number;
  transferSize: number;
  resourceSize: number;
  priority: string | null;
  protocol: string | null;
  domain: string | null;
}

export interface PerformanceReport {
  screenshot: string | null;
  filmstrip: Array<{ timing: number; data: string }>;
  grade: { letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null; value: number | null; performance: number | null; structure: number | null };
  issues: ReportIssue[];
  breakdown: Array<{ group: ResourceGroup; bytes: number; requests: number }>;
  totals: { bytes: number; requests: number; fullyLoadedMs: number | null };
  markers: { fcp: number | null; lcp: number | null; domContentLoaded: number | null; load: number | null };
  waterfall: WaterfallEntry[];
  waterfallTruncated: boolean;
  lcpElement: string | null;
}

const MAX_WATERFALL = 400;
/** Audits that describe the page rather than judge it (shown elsewhere in the report). */
const INFO_ONLY = new Set(['largest-contentful-paint-element', 'lcp-lazy-loaded', 'layout-shifts']);

/** Audits with no metricSavings still clearly affect one metric. */
const FALLBACK_METRICS: Record<string, ReportMetric[]> = {
  'dom-size': ['TBT'],
  'bootup-time': ['TBT'],
  'mainthread-work-breakdown': ['TBT'],
  'long-tasks': ['TBT'],
  'third-party-summary': ['TBT'],
  'total-byte-weight': ['LCP'],
  'critical-request-chains': ['FCP', 'LCP'],
  'unsized-images': ['CLS'],
  'non-composited-animations': ['CLS'],
  'layout-shifts': ['CLS']
};

function impactOf(a: AnyAudit): Impact {
  const s = a.metricSavings ?? {};
  const lcp = Math.max(s.LCP ?? 0, s.FCP ?? 0);
  const tbt = s.TBT ?? 0;
  const cls = s.CLS ?? 0;
  if (lcp >= 1000 || tbt >= 600 || cls >= 0.1) return 'Alto';
  if (lcp >= 500 || tbt >= 300 || cls >= 0.05) return 'Medio';
  if (lcp >= 150 || tbt >= 100 || cls >= 0.01 || (a.score ?? 1) < 0.5) return 'Medio-bajo';
  return 'Bajo';
}
const IMPACT_RANK: Record<Impact, number> = { Alto: 0, Medio: 1, 'Medio-bajo': 2, Bajo: 3 };

/** Lighthouse descriptions are Markdown with "[Learn more](...)" links; keep the text. */
const plain = (md: string | undefined) => (md ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();

function itemLabel(it: Record<string, unknown>): { label: string; url: string | null } {
  const src = it.source as { url?: string } | undefined;
  const url = typeof it.url === 'string' ? it.url : typeof src?.url === 'string' ? src.url : null;
  if (url) return { label: url, url };
  const node = it.node as { selector?: string; snippet?: string } | undefined;
  const nodeText = node?.snippet ?? node?.selector;
  if (nodeText) return { label: nodeText.slice(0, 200), url: null };
  for (const k of ['label', 'groupLabel', 'entity', 'statistic', 'description']) if (typeof it[k] === 'string') return { label: String(it[k]).slice(0, 200), url: null };
  return { label: '', url: null };
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const GROUP: Record<string, ResourceGroup> = { Document: 'HTML', Script: 'JS', Stylesheet: 'CSS', Image: 'IMG', Media: 'Video', Font: 'Font', XHR: 'XHR', Fetch: 'XHR', EventSource: 'XHR', WebSocket: 'XHR' };
const groupOf = (resourceType: unknown, mime: string): ResourceGroup => {
  const g = GROUP[String(resourceType)];
  if (g) return g;
  if (/^video\/|^audio\//.test(mime)) return 'Video';
  if (/^image\//.test(mime)) return 'IMG';
  return 'Other';
};

export function letterFor(value: number | null): PerformanceReport['grade']['letter'] {
  if (value === null) return null;
  return value >= 90 ? 'A' : value >= 80 ? 'B' : value >= 70 ? 'C' : value >= 60 ? 'D' : value >= 50 ? 'E' : 'F';
}

export function parseReport(lhrIn: Lhr): PerformanceReport {
  const lhr = lhrIn as unknown as FullLhr;
  const a = lhr.audits;
  const refs = lhr.categories.performance?.auditRefs ?? [];

  // Audits that judge how the page is built (not the metrics themselves, not Lighthouse's hidden "insights" duplicates).
  const scored = refs
    .filter(r => r.group !== 'metrics' && r.group !== 'hidden' && !INFO_ONLY.has(r.id))
    .map(r => a[r.id])
    .filter((x): x is AnyAudit => !!x && typeof x.score === 'number' && ['metricSavings', 'numeric', 'binary'].includes(x.scoreDisplayMode ?? ''));

  const issues: ReportIssue[] = scored
    .filter(x => (x.score ?? 1) < 0.9)
    .map(x => {
      const fromSavings = Object.keys(x.metricSavings ?? {}).filter((k): k is ReportMetric => ['FCP', 'LCP', 'TBT', 'CLS'].includes(k));
      const items = Array.isArray(x.details?.items) ? x.details!.items! : [];
      return {
        id: x.id ?? '',
        title: plain(x.title ?? x.id ?? ''),
        description: plain(x.description),
        displayValue: x.displayValue ?? null,
        score: x.score ?? 0,
        impact: impactOf(x),
        metrics: fromSavings.length ? fromSavings : FALLBACK_METRICS[x.id ?? ''] ?? [],
        savingsMs: n(x.details?.overallSavingsMs),
        savingsBytes: n(x.details?.overallSavingsBytes),
        itemCount: items.length,
        items: items.slice(0, 10).map(it => ({ ...itemLabel(it), wastedBytes: n(it.wastedBytes), wastedMs: n(it.wastedMs), totalBytes: n(it.totalBytes ?? it.transferSize) }))
      };
    })
    .sort((x, y) => IMPACT_RANK[x.impact] - IMPACT_RANK[y.impact] || x.score - y.score);

  const perfScore = lhr.categories.performance?.score;
  const performance = typeof perfScore === 'number' ? Math.round(perfScore * 100) : null;
  const structure = scored.length ? Math.round((scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length) * 100) : null;
  // Same blend GTmetrix documents (70 % performance, 30 % structure); the audits behind "structure" are Lighthouse's own.
  const value = performance !== null && structure !== null ? Math.round(performance * 0.7 + structure * 0.3) : performance;

  const reqs = (a['network-requests']?.details?.items ?? []) as Array<Record<string, unknown>>;
  const all: WaterfallEntry[] = reqs.map(r => {
    const url = String(r.url ?? '');
    let domain: string | null = null;
    try {
      domain = new URL(url).hostname || null;
    } catch {
      domain = null;
    }
    const mime = String(r.mimeType ?? '');
    return {
      url,
      group: groupOf(r.resourceType, mime),
      mimeType: mime,
      status: n(r.statusCode) ?? 0,
      start: n(r.networkRequestTime) ?? n(r.rendererStartTime) ?? 0,
      end: n(r.networkEndTime) ?? n(r.networkRequestTime) ?? 0,
      transferSize: n(r.transferSize) ?? 0,
      resourceSize: n(r.resourceSize) ?? 0,
      priority: typeof r.priority === 'string' ? r.priority : null,
      protocol: typeof r.protocol === 'string' ? r.protocol : null,
      domain
    };
  });
  const breakdown = new Map<ResourceGroup, { group: ResourceGroup; bytes: number; requests: number }>();
  for (const w of all) {
    const b = breakdown.get(w.group) ?? { group: w.group, bytes: 0, requests: 0 };
    b.bytes += w.transferSize;
    b.requests++;
    breakdown.set(w.group, b);
  }
  const m = (a['metrics']?.details?.items?.[0] ?? {}) as Record<string, unknown>;
  const fullyLoaded = all.length ? Math.max(...all.map(w => w.end)) : null;
  const lcpList = a['largest-contentful-paint-element']?.details?.items?.[0] as { items?: Array<{ node?: { snippet?: string; selector?: string } }> } | undefined;
  const lcpNode = lcpList?.items?.[0]?.node;
  const shot = a['final-screenshot']?.details?.data;

  return {
    screenshot: typeof shot === 'string' ? shot : null,
    filmstrip: (a['screenshot-thumbnails']?.details?.items ?? []).map(t => ({ timing: n(t.timing) ?? 0, data: String(t.data ?? '') })).filter(t => t.data.startsWith('data:image/')),
    grade: { letter: letterFor(value), value, performance, structure },
    issues,
    breakdown: [...breakdown.values()].sort((x, y) => y.bytes - x.bytes),
    totals: { bytes: all.reduce((s, w) => s + w.transferSize, 0), requests: all.length, fullyLoadedMs: fullyLoaded },
    markers: { fcp: n(m.observedFirstContentfulPaint), lcp: n(m.observedLargestContentfulPaint), domContentLoaded: n(m.observedDomContentLoaded), load: n(m.observedLoad) },
    waterfall: [...all].sort((x, y) => x.start - y.start).slice(0, MAX_WATERFALL),
    waterfallTruncated: all.length > MAX_WATERFALL,
    lcpElement: lcpNode?.snippet ?? lcpNode?.selector ?? null
  };
}
