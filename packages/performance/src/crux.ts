import { rate, type MetricKey, type Rating } from './metrics';

/**
 * Chrome UX Report (CrUX) History API: real-user Core Web Vitals per week for an
 * origin or a URL (about 25–40 weekly points, each a rolling 28-day window).
 * https://developer.chrome.com/docs/crux/history-api
 */

export type CruxFormFactor = 'PHONE' | 'DESKTOP' | 'ALL';
export type CruxMetric = Extract<MetricKey, 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'>;

export interface CruxPoint {
  /** Last day of the 28-day window (YYYY-MM-DD). */
  date: string;
  p75: number | null;
  rating: Rating | null;
  /** Share of visits rated good / needs improvement / poor (0–1). */
  good: number | null;
  ni: number | null;
  poor: number | null;
}

export interface CruxHistory {
  scope: 'url' | 'origin';
  key: string;
  formFactor: CruxFormFactor;
  metrics: Partial<Record<CruxMetric, CruxPoint[]>>;
}

const API_METRICS: Record<string, CruxMetric> = {
  largest_contentful_paint: 'LCP',
  interaction_to_next_paint: 'INP',
  cumulative_layout_shift: 'CLS',
  first_contentful_paint: 'FCP',
  experimental_time_to_first_byte: 'TTFB'
};

type Ymd = { year: number; month: number; day: number };
interface HistoryResponse {
  record?: {
    key?: { url?: string; origin?: string };
    metrics?: Record<string, { histogramTimeseries?: Array<{ densities?: Array<number | string | null> }>; percentilesTimeseries?: { p75s?: Array<number | string | null> } }>;
    collectionPeriods?: Array<{ firstDate: Ymd; lastDate: Ymd }>;
  };
  error?: { code?: number; message?: string };
}

const ymd = (d: Ymd) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === 'NaN' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseCruxHistory(body: HistoryResponse, scope: 'url' | 'origin', formFactor: CruxFormFactor): CruxHistory | null {
  const r = body.record;
  if (!r?.metrics) return null;
  const dates = (r.collectionPeriods ?? []).map(p => ymd(p.lastDate));
  const metrics: CruxHistory['metrics'] = {};
  for (const [name, m] of Object.entries(r.metrics)) {
    const key = API_METRICS[name];
    if (!key) continue;
    const p75s = m.percentilesTimeseries?.p75s ?? [];
    const hist = m.histogramTimeseries ?? [];
    metrics[key] = dates.map((date, i) => {
      const p75 = num(p75s[i]);
      return { date, p75, rating: rate(key, p75), good: num(hist[0]?.densities?.[i]), ni: num(hist[1]?.densities?.[i]), poor: num(hist[2]?.densities?.[i]) };
    });
  }
  return { scope, key: r.key?.url ?? r.key?.origin ?? '', formFactor, metrics };
}

export class CruxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** null = CrUX has no data for this URL/origin (not enough Chrome traffic). */
export async function fetchCruxHistory(target: { url: string } | { origin: string }, opts: { formFactor?: CruxFormFactor; apiKey?: string; endpoint?: string } = {}): Promise<CruxHistory | null> {
  const key = opts.apiKey ?? process.env.CRUX_API_KEY ?? process.env.PSI_API_KEY;
  if (!key) throw new CruxError(400, 'Falta la clave de Google (PSI_API_KEY o CRUX_API_KEY).');
  const formFactor = opts.formFactor ?? 'PHONE';
  const endpoint = opts.endpoint ?? process.env.CRUX_API_URL ?? 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';
  const res = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...target, ...(formFactor === 'ALL' ? {} : { formFactor }), metrics: Object.keys(API_METRICS) }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = (await res.json().catch(() => ({}))) as HistoryResponse;
  if (res.status === 404) return null;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    throw new CruxError(res.status, /has not been used|is disabled|SERVICE_DISABLED/i.test(msg) ? 'La "Chrome UX Report API" no está habilitada en tu proyecto de Google Cloud. Habilítala en console.cloud.google.com → APIs y servicios (usa la misma clave de PageSpeed).' : `CrUX respondió: ${msg}`);
  }
  return parseCruxHistory(body, 'url' in target ? 'url' : 'origin', formFactor);
}
