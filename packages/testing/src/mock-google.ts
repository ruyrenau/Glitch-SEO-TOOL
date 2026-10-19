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
  data: Map<string, { pages: Array<{ page: string; clicks: number; impressions: number; position: number }>; queries: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>; /** Optional page rows per month (YYYY-MM) for month-long queries. */ months?: Record<string, Array<{ page: string; clicks: number; impressions: number; position: number }>>; /** Optional rows per day and query (dimensions date,query). */ queryDays?: Array<{ date: string; query: string; clicks: number; impressions: number; position: number }> }>;
  properties: Array<{ siteUrl: string; permissionLevel: string }>;
  /** GA4 properties ("properties/123") and their reports. */
  ga4Properties: Array<{ property: string; displayName: string }>;
  ga4: Map<string, Ga4MockData>;
  revoked: string[];
  requests: string[];
  /** Next consent: grant only these scopes (to test a user unticking Search Console). */
  grantScopes: (scopes: string | null) => void;
  close: () => Promise<void>;
}

type Ga4Metrics = { sessions: number; users: number; engaged: number; engagementSec: number; keyEvents: number; revenue: number };
export interface Ga4MockData {
  organic: Array<{ page: string } & Ga4Metrics>;
  ai: Array<{ page: string; source: string } & Ga4Metrics>;
  daily: Array<{ date: string; channel: string; sessions: number; keyEvents: number }>;
}

export async function startMockGoogle(): Promise<MockGoogle> {
  const ga4: MockGoogle['ga4'] = new Map();
  const ga4Properties: MockGoogle['ga4Properties'] = [];
  const tokenScopes = new Map<string, string>();
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
          const granted = scopesOverride ?? 'openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly';
          tokenScopes.set(rt, granted);
          tokenScopes.set(at, granted);
          const idToken = ['e30', Buffer.from(JSON.stringify({ email: 'seo@example.com' })).toString('base64url'), 'sig'].join('.');
          return send(200, { access_token: at, refresh_token: rt, expires_in: 3600, scope: granted, id_token: idToken });
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (!refreshTokens.has(f.get('refresh_token') ?? '')) return send(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const at = `access-${++n}`;
          accessTokens.add(at);
          tokenScopes.set(at, tokenScopes.get(f.get('refresh_token') ?? '') ?? '');
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
      if (u.pathname.startsWith('/v1beta/')) {
        const at = (req.headers.authorization ?? '').replace('Bearer ', '');
        if (!accessTokens.has(at)) return send(401, { error: { message: 'Invalid Credentials' } });
        if (!(tokenScopes.get(at) ?? '').includes('analytics.readonly')) return send(403, { error: { message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } });
        if (u.pathname === '/v1beta/accountSummaries') return send(200, { accountSummaries: [{ displayName: 'Cuenta de prueba', propertySummaries: ga4Properties }] });
        const m = /^\/v1beta\/(properties\/\d+):runReport$/.exec(u.pathname);
        if (m && req.method === 'POST') {
          const d = ga4.get(m[1]);
          if (!d) return send(403, { error: { message: 'User does not have sufficient permissions for this property.' } });
          const q = JSON.parse(body) as { dimensions: Array<{ name: string }>; limit: number; offset: number };
          const dims = q.dimensions.map(x => x.name).join();
          const met = (r: Ga4Metrics) => [r.sessions, r.users, r.engaged, r.engagementSec, r.keyEvents, r.revenue].map(v => ({ value: String(v) }));
          let rows: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
          if (dims === 'landingPagePlusQueryString') rows = d.organic.map(r => ({ dimensionValues: [{ value: r.page }], metricValues: met(r) }));
          else if (dims === 'landingPagePlusQueryString,sessionSource') rows = d.ai.map(r => ({ dimensionValues: [{ value: r.page }, { value: r.source }], metricValues: met(r) }));
          else rows = d.daily.map(r => ({ dimensionValues: [{ value: r.date.replace(/-/g, '') }, { value: r.channel }], metricValues: [{ value: String(r.sessions) }, { value: String(r.keyEvents) }] }));
          return send(200, { rows: rows.slice(q.offset, q.offset + q.limit), rowCount: rows.length });
        }
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
          } else if (q.dimensions.join() === 'date,query') {
            const f = (q as unknown as { dimensionFilterGroups?: Array<{ filters: Array<{ expression: string }> }> }).dimensionFilterGroups?.[0]?.filters?.[0]?.expression;
            const re = f ? new RegExp(f, 'i') : null;
            rows = (d.queryDays ?? []).filter(x => !re || re.test(x.query)).map(x => ({ keys: [x.date, x.query], clicks: x.clicks, impressions: x.impressions, ctr: ctr(x.clicks, x.impressions), position: x.position }));
          } else if (q.dimensions.join() === 'page' && d.months && q.startDate.slice(0, 7) === q.endDate.slice(0, 7)) rows = (d.months[q.startDate.slice(0, 7)] ?? []).map(p => ({ keys: [p.page], clicks: p.clicks, impressions: p.impressions, ctr: ctr(p.clicks, p.impressions), position: p.position }));
          else if (q.dimensions.join() === 'page') rows = d.pages.map(p => ({ keys: [p.page], clicks: p.clicks, impressions: p.impressions, ctr: ctr(p.clicks, p.impressions), position: p.position }));
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
    env: { GOOGLE_AUTH_URL: `${url}/o/oauth2/v2/auth`, GOOGLE_TOKEN_URL: `${url}/token`, GOOGLE_REVOKE_URL: `${url}/revoke`, GSC_API_URL: `${url}/webmasters/v3`, GA4_DATA_API_URL: `${url}/v1beta`, GA4_ADMIN_API_URL: `${url}/v1beta` },
    data,
    properties,
    ga4Properties,
    ga4,
    revoked,
    requests,
    grantScopes: s => (scopesOverride = s),
    close: () => new Promise(r => server.close(() => r()))
  };
}
