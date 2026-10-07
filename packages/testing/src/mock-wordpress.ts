import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Minimal WordPress REST API (wp/v2 posts, categories, users/me) for tests.
 * Mirrors the real responses the client depends on: Basic auth with an
 * Application Password, ?rest_route= routing, context=edit raw fields,
 * modified_gmt, and error bodies { code, message }.
 */
export interface MockPost {
  id: number;
  status: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  categories: number[];
  modified_gmt: string;
}

export interface MockWordPress {
  url: string;
  username: string;
  appPassword: string;
  posts: Map<number, MockPost>;
  requests: Array<{ method: string; route: string }>;
  /** Simulates a person editing the draft in wp-admin. */
  humanEdit: (id: number, content: string) => void;
  /** Simulates a person publishing the post. */
  publish: (id: number) => void;
  /** Makes the next N requests answer 503 (to test retries). */
  failNext: (n: number) => void;
  close: () => Promise<void>;
}

let clock = Date.UTC(2026, 9, 6, 12, 0, 0);
const tick = () => new Date((clock += 1000)).toISOString().slice(0, 19);

export async function startMockWordPress(): Promise<MockWordPress> {
  const username = 'editor';
  const appPassword = 'abcd EFGH 1234 ijkl MNOP 5678';
  const posts = new Map<number, MockPost>();
  const requests: MockWordPress['requests'] = [];
  const categories = [
    { id: 1, name: 'Uncategorized', slug: 'uncategorized', count: 0 },
    { id: 7, name: 'SEO', slug: 'seo', count: 0 }
  ];
  let nextId = 100;
  let failures = 0;
  let base = '';

  const view = (p: MockPost) => ({
    id: p.id,
    status: p.status,
    slug: p.slug,
    link: `${base}/?p=${p.id}`,
    modified_gmt: p.modified_gmt,
    title: { raw: p.title, rendered: p.title },
    content: { raw: p.content, rendered: p.content },
    excerpt: { raw: p.excerpt, rendered: `<p>${p.excerpt}</p>` },
    categories: p.categories
  });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const route = u.searchParams.get('rest_route') ?? '';
    requests.push({ method: req.method ?? 'GET', route });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (failures > 0) {
      failures--;
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' });
      return res.end(JSON.stringify({ code: 'unavailable', message: 'Try again' }));
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (route === '/') return send(200, { name: 'Mock WP', namespaces: ['oembed/1.0', 'wp/v2'] });
      const expected = 'Basic ' + Buffer.from(`${username}:${appPassword.replace(/\s+/g, '')}`).toString('base64');
      if (req.headers.authorization !== expected) return send(401, { code: 'rest_not_logged_in', message: 'You are not currently logged in.' });
      if (route === '/wp/v2/users/me') return send(200, { id: 2, name: 'Editor', capabilities: { edit_posts: true } });
      if (route === '/wp/v2/categories') return send(200, categories);
      if (route === '/wp/v2/tags') return send(200, []);
      const input = body ? JSON.parse(body) : {};
      if (route === '/wp/v2/posts' && req.method === 'POST') {
        if (input.status && input.status !== 'draft') return send(403, { code: 'not_allowed_in_test', message: 'mock only accepts drafts' });
        const p: MockPost = { id: nextId++, status: 'draft', slug: input.slug ?? '', title: input.title ?? '', content: input.content ?? '', excerpt: input.excerpt ?? '', categories: input.categories ?? [1], modified_gmt: tick() };
        posts.set(p.id, p);
        return send(201, view(p));
      }
      const m = /^\/wp\/v2\/posts\/(\d+)$/.exec(route);
      if (m) {
        const p = posts.get(Number(m[1]));
        if (!p) return send(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
        if (req.method === 'GET') return send(200, view(p));
        Object.assign(p, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.categories ? { categories: input.categories } : {}),
          ...(input.status ? { status: input.status } : {}),
          modified_gmt: tick()
        });
        return send(200, view(p));
      }
      send(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    username,
    appPassword,
    posts,
    requests,
    humanEdit: (id, content) => Object.assign(posts.get(id)!, { content, modified_gmt: tick() }),
    publish: id => Object.assign(posts.get(id)!, { status: 'publish', modified_gmt: tick() }),
    failNext: n => (failures = n),
    close: () => new Promise(r => server.close(() => r()))
  };
}
