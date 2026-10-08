import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Local stand-in for Google OAuth + the Search Console API, used by tests.
 * The consent screen "accepts" immediately and redirects back with a code.
 */
export interface MockGoogle {
  url: string;
  /** Point GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_REVOKE_URL and GSC_API_URL here. */
  env: Record<string, string>;
  /** Search Analytics rows per property: page-level and query+page-level. */
  data: Map<string, { pages: Array<{ page: string; clicks: number; impressions: number; position: number }>; queries: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> }>;
  properties: Array<{ siteUrl: string; permissionLevel: string }>;
  revoked: string[];
  requests: string[];
  /** Next consent: grant only these scopes (to test a user unticking Search Console). */
  grantScopes: (scopes: string | null) => void;
  close: () => Promise<void>;
}

export async function startMockGoogle(): Promise<MockGoogle> {
  const data: MockGoogle['data'] = new Map();
  const properties: MockGoogle['properties'] = [];
  const revoked: string[] = [];
  const requests: string[] = [];
  let scopesOverride: string | null = null;
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  let n = 0;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    requests.push(`${req.method} ${u.pathname}`);
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const send = (status: number, obj: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === '/o/oauth2/v2/auth') {
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', `code-${++n}`);
        back.searchParams.set('state', u.searchParams.get('state') ?? '');
        back.searchParams.set('scope', u.searchParams.get('scope') ?? '');
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (u.pathname === '/token') {
        const f = new URLSearchParams(body);
        if (f.get('grant_type') === 'authorization_code') {
          const rt = `refresh-${n}`;
          refreshTokens.add(rt);
          const at = `access-${++n}`;
          accessTokens.add(at);
          const idToken = ['e30', Buffer.from(JSON.stringify({ email: 'seo@example.com' })).toString('base64url'), 'sig'].join('.');
          return send(200, { access_token: at, refresh_token: rt, expires_in: 3600, scope: scopesOverride ?? 'openid email https://www.googleapis.com/auth/webmasters.readonly', id_token: idToken });
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (!refreshTokens.has(f.get('refresh_token') ?? '')) return send(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const at = `access-${++n}`;
          accessTokens.add(at);
          return send(200, { access_token: at, expires_in: 3600 });
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      if (u.pathname === '/revoke') {
        const t = new URLSearchParams(body).get('token') ?? '';
        revoked.push(t);
        refreshTokens.delete(t);
        return send(200, {});
      }
      if (u.pathname.startsWith('/webmasters/v3/')) {
        if (!accessTokens.has((req.headers.authorization ?? '').replace('Bearer ', ''))) return send(401, { error: { message: 'Invalid Credentials' } });
        if (u.pathname === '/webmasters/v3/sites') return send(200, { siteEntry: properties });
        const m = /^\/webmasters\/v3\/sites\/(.+)\/searchAnalytics\/query$/.exec(u.pathname);
        if (m && req.method === 'POST') {
          const property = decodeURIComponent(m[1]);
          const d = data.get(property);
          if (!d) return send(403, { error: { message: `User does not have sufficient permission for site '${property}'.` } });
          const q = JSON.parse(body) as { startDate: string; endDate: string; dimensions: string[]; rowLimit: number; startRow: number };
          let rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
          const ctr = (c: number, i: number) => (i ? c / i : 0);
          if (q.dimensions.join() === 'date') {
            rows = [];
            const days = Math.round((Date.parse(q.endDate) - Date.parse(q.startDate)) / 86400_000) + 1;
            const totC = d.pages.reduce((s, p) => s + p.clicks, 0);
            const totI = d.pages.reduce((s, p) => s + p.impressions, 0);
            for (let i = 0; i < days; i++) {
              const date = new Date(Date.parse(q.startDate) + i * 86400_000).toISOString().slice(0, 10);
              const c = Math.floor(totC / days) + (i < totC % days ? 1 : 0);
              const im = Math.floor(totI / days) + (i < totI % days ? 1 : 0);
              rows.push({ keys: [date], clicks: c, impressions: im, ctr: ctr(c, im), position: 7.5 });
            }
          } else if (q.dimensions.join() === 'page') rows = d.pages.map(p => ({ keys: [p.page], clicks: p.clicks, impressions: p.impressions, ctr: ctr(p.clicks, p.impressions), position: p.position }));
          else rows = d.queries.map(x => ({ keys: [x.query, x.page], clicks: x.clicks, impressions: x.impressions, ctr: ctr(x.clicks, x.impressions), position: x.position }));
          return send(200, { rows: rows.slice(q.startRow, q.startRow + q.rowLimit) });
        }
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    env: { GOOGLE_AUTH_URL: `${url}/o/oauth2/v2/auth`, GOOGLE_TOKEN_URL: `${url}/token`, GOOGLE_REVOKE_URL: `${url}/revoke`, GSC_API_URL: `${url}/webmasters/v3` },
    data,
    properties,
    revoked,
    requests,
    grantScopes: s => (scopesOverride = s),
    close: () => new Promise(r => server.close(() => r()))
  };
}
