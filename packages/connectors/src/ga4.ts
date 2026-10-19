import { GscError, tokenRequest, type GoogleOAuthConfig } from './gsc';

/**
 * Google Analytics 4: Admin API (list properties) and Data API (runReport), read-only, with the same Google
 * account and refresh token as Search Console.
 */

export interface Ga4Property {
  /** "properties/123456789" */
  property: string;
  displayName: string;
  account: string;
}

export interface Ga4Filter {
  fieldName: string;
  value: string;
  matchType?: 'EXACT' | 'FULL_REGEXP' | 'CONTAINS';
}

export interface Ga4ReportRequest {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  /** All filters must match (AND). */
  filters?: Ga4Filter[];
  orderByMetric?: string;
  /** Stop after this many rows (the API pages 100,000 at a time). */
  maxRows?: number;
}

export interface Ga4Row {
  dimensions: string[];
  metrics: number[];
}

export class Ga4Client {
  private access: { token: string; until: number } | null = null;
  constructor(private cfg: GoogleOAuthConfig, private refreshToken: string) {}

  private async token(): Promise<string> {
    if (this.access && Date.now() < this.access.until) return this.access.token;
    const j = await tokenRequest(this.cfg, { refresh_token: this.refreshToken, grant_type: 'refresh_token' });
    this.access = { token: String(j.access_token), until: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
    return this.access.token;
  }

  private async call<T>(url: string, init: { method?: string; body?: unknown } = {}, attempt = 0): Promise<T> {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${await this.token()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000)
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt + Math.random() * 500)));
      return this.call<T>(url, init, attempt + 1);
    }
    if (res.status === 401 && attempt === 0) {
      this.access = null;
      return this.call<T>(url, init, 1);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } } & T;
    if (!res.ok) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new GscError('FORBIDDEN', 'Falta el permiso de Google Analytics. Vuelve a conectar con Google y acepta "Ver tus datos de Google Analytics".', 403);
      if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new GscError('FORBIDDEN', 'La API de Google Analytics no está habilitada en tu proyecto de Google Cloud (Google Analytics Data API y Admin API).', 403);
      if (res.status === 403) throw new GscError('FORBIDDEN', `Tu cuenta de Google no tiene acceso a esta propiedad de Analytics (${msg}).`, 403);
      if (res.status === 429) throw new GscError('QUOTA', 'Se alcanzó el límite de consultas de la API de Google Analytics. Intenta más tarde.', 429);
      throw new GscError('GOOGLE_ERROR', `Google Analytics API: ${msg}`, res.status);
    }
    return json;
  }

  /** GA4 properties the account can read. */
  async listProperties(): Promise<Ga4Property[]> {
    const out: Ga4Property[] = [];
    let pageToken = '';
    for (let i = 0; i < 20; i++) {
      const r = await this.call<{ accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property: string; displayName?: string }> }>; nextPageToken?: string }>(
        `${this.cfg.ga4AdminUrl}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      );
      for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ property: p.property, displayName: p.displayName ?? p.property, account: a.displayName ?? '' });
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
    return out;
  }

  /** runReport with paging. Metric values come back as numbers. */
  async report(property: string, q: Ga4ReportRequest): Promise<Ga4Row[]> {
    if (!/^properties\/\d+$/.test(property)) throw new GscError('GOOGLE_ERROR', `Propiedad de Analytics no válida: ${property}`);
    const max = q.maxRows ?? 100_000;
    const filters = (q.filters ?? []).map(f => ({ filter: { fieldName: f.fieldName, stringFilter: { value: f.value, matchType: f.matchType ?? 'EXACT', caseSensitive: false } } }));
    const dimensionFilter = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { andGroup: { expressions: filters } };
    const out: Ga4Row[] = [];
    for (let offset = 0; offset < max; offset += 100_000) {
      const limit = Math.min(100_000, max - offset);
      const r = await this.call<{ rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }> }>(`${this.cfg.ga4DataUrl}/${property}:runReport`, {
        method: 'POST',
        body: {
          dateRanges: [{ startDate: q.startDate, endDate: q.endDate }],
          dimensions: q.dimensions.map(name => ({ name })),
          metrics: q.metrics.map(name => ({ name })),
          ...(dimensionFilter ? { dimensionFilter } : {}),
          ...(q.orderByMetric ? { orderBys: [{ metric: { metricName: q.orderByMetric }, desc: true }] } : {}),
          limit,
          offset
        }
      });
      const rows = r.rows ?? [];
      for (const row of rows) out.push({ dimensions: (row.dimensionValues ?? []).map(d => d.value), metrics: (row.metricValues ?? []).map(m => Number(m.value) || 0) });
      if (rows.length < limit) break;
    }
    return out;
  }
}

/** Referrers of AI assistants and answer engines, grouped by product. */
export const AI_SOURCES: Array<{ engine: string; pattern: RegExp }> = [
  { engine: 'ChatGPT', pattern: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$|^chatgpt/i },
  { engine: 'Perplexity', pattern: /(^|\.)perplexity\.ai$|^perplexity/i },
  { engine: 'Gemini', pattern: /(^|\.)(gemini\.google\.com|bard\.google\.com)$|^gemini/i },
  { engine: 'Copilot', pattern: /(^|\.)(copilot\.microsoft\.com|copilot\.cloud\.microsoft)$|^copilot/i },
  { engine: 'Claude', pattern: /(^|\.)claude\.ai$|^claude/i },
  { engine: 'DeepSeek', pattern: /(^|\.)(chat\.)?deepseek\.com$/i },
  { engine: 'Meta AI', pattern: /(^|\.)meta\.ai$/i },
  { engine: 'Grok', pattern: /(^|\.)grok\.com$|^grok/i },
  { engine: 'You.com', pattern: /(^|\.)you\.com$/i },
  { engine: 'Phind', pattern: /(^|\.)phind\.com$/i }
];
/** GA4 regex (RE2) matching the AI sources above, for a sessionSource filter. */
export const AI_SOURCE_REGEX = '.*(chatgpt\\.com|chat\\.openai\\.com|openai\\.com|chatgpt|perplexity|gemini\\.google\\.com|bard\\.google\\.com|copilot\\.microsoft\\.com|copilot\\.cloud\\.microsoft|claude\\.ai|deepseek\\.com|meta\\.ai|grok\\.com|you\\.com|phind\\.com).*';
export function aiEngineOf(source: string): string | null {
  const s = source.toLowerCase().trim();
  return AI_SOURCES.find(a => a.pattern.test(s))?.engine ?? null;
}
