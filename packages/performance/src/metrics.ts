/** Thresholds published for Core Web Vitals and Lighthouse lab metrics (good / needs improvement). */
export const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000, unit: 'ms' },
  INP: { good: 200, poor: 500, unit: 'ms' },
  CLS: { good: 0.1, poor: 0.25, unit: '' },
  FCP: { good: 1800, poor: 3000, unit: 'ms' },
  TTFB: { good: 800, poor: 1800, unit: 'ms' },
  TBT: { good: 200, poor: 600, unit: 'ms' },
  SI: { good: 3400, poor: 5800, unit: 'ms' }
} as const;

export type MetricKey = keyof typeof THRESHOLDS;
export type Rating = 'good' | 'needs-improvement' | 'poor';

export function rate(metric: MetricKey, value: number | null | undefined): Rating | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const t = THRESHOLDS[metric];
  return value <= t.good ? 'good' : value <= t.poor ? 'needs-improvement' : 'poor';
}

export interface LabMetrics {
  performanceScore: number | null; // 0-100
  LCP: number | null;
  CLS: number | null;
  TBT: number | null;
  FCP: number | null;
  SI: number | null;
  TTFB: number | null;
}

export interface FieldMetric {
  p75: number;
  rating: Rating | null;
  /** Share of page loads in good / needs-improvement / poor. */
  distribution: [number, number, number];
}

export interface FieldData {
  /** "url" = this exact URL had enough traffic; "origin" = only site-wide data exists. */
  scope: 'url' | 'origin';
  collectionPeriod: { firstDate: string; lastDate: string } | null;
  metrics: Partial<Record<'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB', FieldMetric>>;
}

export interface Diagnostic {
  id: string;
  title: string;
  score: number | null;
  displayValue: string | null;
  savingsMs: number | null;
  savingsBytes: number | null;
  items: number;
}

export interface PerformanceResult {
  source: 'lighthouse-local' | 'psi';
  strategy: 'mobile' | 'desktop';
  finalUrl: string;
  lab: LabMetrics;
  /** Real-user data from CrUX. null = not requested (no PSI key) or not enough traffic. */
  field: FieldData | null;
  fieldStatus: 'available' | 'insufficient-data' | 'not-requested';
  diagnostics: Diagnostic[];
  resources: { totalBytes: number | null; requests: number | null };
  lighthouseVersion: string;
  fetchedAt: string;
}
