/**
 * Google Search Console: OAuth 2.0 (authorization code, offline access) and the Search Analytics API.
 * Endpoints come from env so tests can point them at a local mock.
 * Scope: read-only Search Console + openid/email (to show which Google account is connected).
 */

export const GSC_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly'];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiUrl: string;
}

export function googleConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GSC_CLIENT_ID?.trim();
  const clientSecret = process.env.GSC_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const apiBase = (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.GSC_REDIRECT_URI ?? `${apiBase}/api/v1/gsc/oauth/callback`,
    authUrl: process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
    revokeUrl: process.env.GOOGLE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke',
    apiUrl: (process.env.GSC_API_URL ?? 'https://www.googleapis.com/webmasters/v3').replace(/\/$/, '')
  };
}

export class GscError extends Error {
  constructor(public code: 'NOT_CONFIGURED' | 'TOKEN_REVOKED' | 'FORBIDDEN' | 'QUOTA' | 'GOOGLE_ERROR', message: string, public status = 0) {
    super(message);
    this.name = 'GscError';
  }
}

/** URL of Google's consent screen. `prompt=consent` + `access_type=offline` always return a refresh token. */
export function buildAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
  const u = new URL(cfg.authUrl);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GSC_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  }).toString();
  return u.toString();
}

async function tokenRequest(cfg: GoogleOAuthConfig, body: Record<string, string>) {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }).toString(),
    signal: AbortSignal.timeout(20_000)
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(json.error ?? res.status);
    if (err === 'invalid_grant') throw new GscError('TOKEN_REVOKED', 'Google rechazó el permiso (caducó o fue revocado). Vuelve a conectar la cuenta.', res.status);
    throw new GscError('GOOGLE_ERROR', `Google OAuth: ${err} ${String(json.error_description ?? '')}`.trim(), res.status);
  }
  return json;
}

/** The email inside Google's id_token. It comes straight from Google's token endpoint over TLS, so the payload is only decoded. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function exchangeCode(cfg: GoogleOAuthConfig, code: string) {
  const j = await tokenRequest(cfg, { code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri });
  const scope = String(j.scope ?? '');
  if (!scope.includes('webmasters')) throw new GscError('FORBIDDEN', 'No se concedió el permiso de Search Console. Vuelve a conectar y marca la casilla de Search Console.');
  if (!j.refresh_token) throw new GscError('GOOGLE_ERROR', 'Google no devolvió un token de actualización. Quita el acceso de la app en tu cuenta de Google y vuelve a conectar.');
  return { refreshToken: String(j.refresh_token), accessToken: String(j.access_token), expiresIn: Number(j.expires_in ?? 3600), scope, email: emailFromIdToken(j.id_token) };
}

export async function revokeToken(cfg: GoogleOAuthConfig, token: string) {
  await fetch(cfg.revokeUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQuery {
  startDate: string;
  endDate: string;
  dimensions: Array<'date' | 'page' | 'query' | 'country' | 'device'>;
  /** Stop after this many rows (the API pages 25,000 at a time). */
  maxRows?: number;
  type?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
}

/** Read-only Search Console client for one Google account (refresh token). */
export class SearchConsoleClient {
  private access: { token: string; until: number } | null = null;
  constructor(private cfg: GoogleOAuthConfig, private refreshToken: string) {}

  private async token(): Promise<string> {
    if (this.access && Date.now() < this.access.until) return this.access.token;
    const j = await tokenRequest(this.cfg, { refresh_token: this.refreshToken, grant_type: 'refresh_token' });
    this.access = { token: String(j.access_token), until: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
    return this.access.token;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}, attempt = 0): Promise<T> {
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${await this.token()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000)
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt + Math.random() * 500)));
      return this.call<T>(path, init, attempt + 1);
    }
    if (res.status === 401 && attempt === 0) {
      this.access = null;
      return this.call<T>(path, init, 1);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 403) throw new GscError('FORBIDDEN', `Tu cuenta de Google no tiene acceso a esta propiedad de Search Console (${msg}).`, 403);
      if (res.status === 429) throw new GscError('QUOTA', 'Se alcanzó el límite de consultas de la API de Search Console. Intenta más tarde.', 429);
      throw new GscError('GOOGLE_ERROR', `Search Console API: ${msg}`, res.status);
    }
    return json;
  }

  /** Properties the account can read (siteUrl is "https://example.com/" or "sc-domain:example.com"). */
  async listSites(): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
    const r = await this.call<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>('/sites');
    return (r.siteEntry ?? []).filter(s => s.permissionLevel !== 'siteUnverifiedUser');
  }

  /** Search Analytics with paging (25,000 rows per request). */
  async query(property: string, q: GscQuery): Promise<GscRow[]> {
    const max = q.maxRows ?? 100_000;
    const out: GscRow[] = [];
    for (let startRow = 0; startRow < max; startRow += 25_000) {
      const r = await this.call<{ rows?: GscRow[] }>(`/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
        method: 'POST',
        body: { startDate: q.startDate, endDate: q.endDate, dimensions: q.dimensions, type: q.type ?? 'web', rowLimit: Math.min(25_000, max - startRow), startRow, dataState: 'final' }
      });
      const rows = r.rows ?? [];
      out.push(...rows);
      if (rows.length < 25_000) break;
    }
    return out;
  }
}

/** Does a crawled site URL belong to a Search Console property? */
export function propertyMatchesUrl(property: string, url: string): boolean {
  try {
    const u = new URL(url);
    if (property.startsWith('sc-domain:')) {
      const d = property.slice('sc-domain:'.length).toLowerCase();
      return u.hostname === d || u.hostname.endsWith(`.${d}`);
    }
    return url.startsWith(property) || `${u.origin}/` === property;
  } catch {
    return false;
  }
}
