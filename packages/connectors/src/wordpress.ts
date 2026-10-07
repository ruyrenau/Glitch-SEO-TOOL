import { assertSafeUrl } from '@glitch/crawler';

/**
 * WordPress REST API client limited to what the MVP allows:
 * read posts/terms and create or update DRAFTS. It never publishes,
 * never deletes, and refuses to modify a post that is not a draft.
 */

export interface WordPressConfig {
  /** Site root, e.g. https://example.com (the client appends /wp-json/…). */
  baseUrl: string;
  username: string;
  /** Application Password (spaces allowed, as WordPress shows it). */
  appPassword: string;
  /** Hosts allowed over plain HTTP / private IPs (local development only). */
  allowHosts?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

export interface WpPost {
  id: number;
  status: string;
  slug: string;
  link: string;
  modified_gmt: string;
  title: { raw?: string; rendered: string };
  content: { raw?: string; rendered: string };
  excerpt: { raw?: string; rendered: string };
  categories?: number[];
  tags?: number[];
}

export interface WpTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface DraftInput {
  title: string;
  content: string;
  slug: string;
  excerpt?: string;
  categories?: number[];
  tags?: number[];
}

export class WordPressError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'WordPressError';
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class WordPressClient {
  private readonly root: URL;
  private readonly auth: string;

  constructor(private readonly cfg: WordPressConfig) {
    const u = new URL(cfg.baseUrl);
    const local = cfg.allowHosts?.includes(u.hostname);
    if (u.protocol !== 'https:' && !local) throw new WordPressError(0, 'HTTPS_REQUIRED', 'Application Passwords must be sent over HTTPS');
    u.pathname = u.pathname.replace(/\/+$/, '') + '/';
    u.search = '';
    u.hash = '';
    this.root = u;
    this.auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.appPassword.replace(/\s+/g, '')}`).toString('base64');
  }

  private url(path: string, query: Record<string, string | number> = {}): string {
    // ?rest_route= works whether or not pretty permalinks are enabled.
    const u = new URL(this.root.toString());
    u.searchParams.set('rest_route', path);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async request<T>(method: 'GET' | 'POST', path: string, opts: { query?: Record<string, string | number>; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const url = this.url(path, opts.query);
    await assertSafeUrl(url, { allowHosts: this.cfg.allowHosts });
    const maxRetries = this.cfg.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          redirect: 'error',
          headers: {
            accept: 'application/json',
            'user-agent': this.cfg.userAgent ?? 'GlitchSeoOps/0.5',
            ...(opts.auth === false ? {} : { authorization: this.auth }),
            ...(opts.body ? { 'content-type': 'application/json' } : {})
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000)
        });
      } catch (e) {
        if (attempt < maxRetries && method === 'GET') {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new WordPressError(0, 'NETWORK_ERROR', (e as Error).message);
      }
      // Retry transient failures. POSTs are retried only on 429/503, where the server did not process them.
      const transient = res.status === 429 || res.status === 503 || (method === 'GET' && res.status >= 500);
      if (transient && attempt < maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new WordPressError(res.status, 'INVALID_RESPONSE', `WordPress returned non-JSON (HTTP ${res.status}). Is this the site root and is the REST API enabled?`);
      }
      if (!res.ok) {
        const err = json as { code?: string; message?: string } | null;
        throw new WordPressError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `HTTP ${res.status}`);
      }
      return json as T;
    }
  }

  /** Checks the REST API, the credentials and the ability to edit posts. */
  async testConnection(): Promise<{ siteName: string; user: string; canEditPosts: boolean }> {
    const index = await this.request<{ name?: string; namespaces?: string[] }>('GET', '/', { auth: false });
    if (!index.namespaces?.includes('wp/v2')) throw new WordPressError(0, 'NO_WP_V2', 'The REST API does not expose wp/v2');
    const me = await this.request<{ name: string; capabilities?: Record<string, boolean> }>('GET', '/wp/v2/users/me', { query: { context: 'edit' } });
    return { siteName: index.name ?? '', user: me.name, canEditPosts: !!me.capabilities?.edit_posts };
  }

  async listCategories(): Promise<WpTerm[]> {
    return this.request<WpTerm[]>('GET', '/wp/v2/categories', { query: { per_page: 100, _fields: 'id,name,slug,count' } });
  }

  async listTags(): Promise<WpTerm[]> {
    return this.request<WpTerm[]>('GET', '/wp/v2/tags', { query: { per_page: 100, _fields: 'id,name,slug,count' } });
  }

  async listPosts(params: { status?: string; search?: string; perPage?: number } = {}): Promise<WpPost[]> {
    return this.request<WpPost[]>('GET', '/wp/v2/posts', { query: { context: 'edit', per_page: params.perPage ?? 20, status: params.status ?? 'draft,publish', ...(params.search ? { search: params.search } : {}) } });
  }

  async getPost(id: number): Promise<WpPost> {
    return this.request<WpPost>('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit' } });
  }

  async createDraft(input: DraftInput): Promise<WpPost> {
    const post = await this.request<WpPost>('POST', '/wp/v2/posts', { body: { ...input, status: 'draft' } });
    if (post.status !== 'draft') throw new WordPressError(0, 'UNEXPECTED_STATUS', `WordPress returned status "${post.status}" for a draft`);
    return post;
  }

  /** Updates an existing post only if it is still a draft. */
  async updateDraft(id: number, input: DraftInput): Promise<WpPost> {
    const current = await this.getPost(id);
    if (current.status !== 'draft') throw new WordPressError(409, 'NOT_A_DRAFT', `Post ${id} is "${current.status}" in WordPress; the tool only edits drafts`);
    return this.request<WpPost>('POST', `/wp/v2/posts/${id}`, { body: { ...input, status: 'draft' } });
  }
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

export interface DiffLine {
  op: 'same' | 'add' | 'remove';
  text: string;
}

/** Splits HTML into comparable lines (one per block tag), so diffs stay readable. */
export function htmlToLines(html: string): string[] {
  return html
    .replace(/\r/g, '')
    .replace(/(<\/(p|h[1-6]|li|ul|ol|div|section|table|tr|blockquote)>)/gi, '$1\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

/** Line diff (LCS). Inputs are capped to keep it O(n·m) small. */
export function lineDiff(before: string[], after: string[], max = 2000): DiffLine[] {
  const a = before.slice(0, max);
  const b = after.slice(0, max);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: 'remove', text: a[i++] });
    else out.push({ op: 'add', text: b[j++] });
  }
  while (i < a.length) out.push({ op: 'remove', text: a[i++] });
  while (j < b.length) out.push({ op: 'add', text: b[j++] });
  return out;
}
