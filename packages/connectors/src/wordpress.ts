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

  protected get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  protected post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  protected del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, opts: { query?: Record<string, string | number>; body?: unknown; auth?: boolean } = {}): Promise<T> {
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

// ---------------------------------------------------------------------------
// SEO field editing on existing content (title, slug, SEO title/description, image alt)
// ---------------------------------------------------------------------------

export type SeoTarget = 'post' | 'page';
export type SeoMetaProvider = 'yoast' | 'rankmath' | 'gseo';

export const SEO_META_KEYS: Record<SeoMetaProvider, { title: string; description: string }> = {
  yoast: { title: '_yoast_wpseo_title', description: '_yoast_wpseo_metadesc' },
  rankmath: { title: 'rank_math_title', description: 'rank_math_description' },
  // G.SEO – SEO plugin (docs/wordpress/gseo-seo)
  gseo: { title: '_gseo_title', description: '_gseo_description' }
};
/** REST namespace of the G.SEO – SEO plugin. */
export const GSEO_PLUGIN_NS = 'gseo-seo/v1';

export interface GseoPluginStatus {
  plugin: 'gseo-seo';
  version: string;
  active: boolean;
  output: boolean;
  conflicts: string[];
  sitemap: string;
  llms_txt: string | null;
  public: boolean;
  robots_file: boolean;
}
/** JSON-LD graph printed in <head> by docs/wordpress/glitch-seo-meta.php (v2). */
export const GLITCH_SCHEMA_KEY = '_glitch_schema_jsonld';
const ALLOWED_META = new Set([...Object.values(SEO_META_KEYS).flatMap(k => [k.title, k.description]), GLITCH_SCHEMA_KEY]);

export interface WpSeoItem {
  id: number;
  type: SeoTarget;
  status: string;
  link: string;
  slug: string;
  title: string;
  modified_gmt: string;
  meta: Record<string, string>;
  /** Which SEO plugin fields are exposed over REST (null = none: install docs/wordpress/glitch-seo-meta.php). */
  metaProvider: SeoMetaProvider | null;
}

export interface WpMediaItem {
  id: number;
  source_url: string;
  alt_text: string;
  modified_gmt: string;
}

const sameUrl = (a: string, b: string) => {
  const n = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`;
    } catch {
      return u;
    }
  };
  return n(a) === n(b);
};

function toSeoItem(raw: { id: number; status: string; link: string; slug: string; modified_gmt: string; title: { raw?: string; rendered: string }; meta?: Record<string, unknown> }, type: SeoTarget, active: SeoMetaProvider | null): WpSeoItem {
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.meta ?? {})) if (ALLOWED_META.has(k)) meta[k] = typeof v === 'string' ? v : '';
  // Usable only when the ACTIVE SEO plugin's keys come back in `meta` (registered with show_in_rest).
  const provider = active && (SEO_META_KEYS[active].title in meta || SEO_META_KEYS[active].description in meta) ? active : null;
  return { id: raw.id, type, status: raw.status, link: raw.link, slug: raw.slug, title: raw.title.raw ?? raw.title.rendered, modified_gmt: raw.modified_gmt, meta, metaProvider: provider };
}

export interface SeoFieldUpdate {
  title?: string;
  slug?: string;
  meta?: Record<string, string>;
}

export class WordPressSeoClient extends WordPressClient {
  private ns: Promise<string[]> | null = null;

  /** REST namespaces the site registers (one request, cached). */
  namespaces(): Promise<string[]> {
    this.ns ??= this.get<{ namespaces?: string[] }>('/', {})
      .then(r => r.namespaces ?? [])
      .catch(() => []);
    return this.ns;
  }

  /**
   * The SEO plugin actually running, from the REST namespaces it registers. Yoast and Rank Math win:
   * while one of them is active the G.SEO plugin stays passive and does not print its fields.
   */
  async activeSeoPlugin(): Promise<SeoMetaProvider | null> {
    const n = await this.namespaces();
    return n.includes('yoast/v1') ? 'yoast' : n.includes('rankmath/v1') ? 'rankmath' : n.includes(GSEO_PLUGIN_NS) ? 'gseo' : null;
  }

  /** Status of the G.SEO – SEO plugin, or null when it is not installed. */
  async gseoPluginStatus(): Promise<GseoPluginStatus | null> {
    if (!(await this.namespaces()).includes(GSEO_PLUGIN_NS)) return null;
    return this.get<GseoPluginStatus>(`/${GSEO_PLUGIN_NS}/status`, {});
  }

  /** Changes settings of the G.SEO – SEO plugin (needs an administrator). Unknown keys are ignored by the plugin. */
  async updateGseoSettings(settings: Record<string, string | boolean>): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(`/${GSEO_PLUGIN_NS}/settings`, settings);
  }

  /** Where redirects can be created: the G.SEO plugin first, then the Redirection plugin. */
  async redirectBackend(): Promise<'gseo' | 'redirection' | null> {
    const n = await this.namespaces();
    return n.includes(GSEO_PLUGIN_NS) ? 'gseo' : n.includes('redirection/v1') ? 'redirection' : null;
  }

  /** Finds the post or page whose permalink is `url` (matched by slug, then by link). */
  async findByUrl(url: string): Promise<WpSeoItem | null> {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (!slug) return null; // the front page has no slug
    for (const type of ['posts', 'pages'] as const) {
      const list = await this.get<Array<Parameters<typeof toSeoItem>[0]>>(`/wp/v2/${type}`, { slug, context: 'edit', status: 'publish,draft,private,future,pending', per_page: 10 });
      const hit = list.find(i => sameUrl(i.link, url)) ?? (list.length === 1 ? list[0] : undefined);
      if (hit) return toSeoItem(hit, type === 'posts' ? 'post' : 'page', await this.activeSeoPlugin());
    }
    return null;
  }

  async getSeoItem(type: SeoTarget, id: number): Promise<WpSeoItem> {
    return toSeoItem(await this.get(`/wp/v2/${type === 'post' ? 'posts' : 'pages'}/${id}`, { context: 'edit' }), type, await this.activeSeoPlugin());
  }

  /**
   * Updates SEO fields only. Content, status, dates and authors are never sent,
   * and meta keys outside the Yoast/Rank Math title/description whitelist are rejected.
   */
  async updateSeoFields(type: SeoTarget, id: number, u: SeoFieldUpdate): Promise<WpSeoItem> {
    const body: Record<string, unknown> = {};
    if (u.title !== undefined) body.title = u.title;
    if (u.slug !== undefined) body.slug = u.slug;
    if (u.meta) {
      for (const k of Object.keys(u.meta)) if (!ALLOWED_META.has(k)) throw new WordPressError(0, 'META_NOT_ALLOWED', `Meta key ${k} is not an SEO field`);
      body.meta = u.meta;
    }
    if (!Object.keys(body).length) throw new WordPressError(0, 'NOTHING_TO_UPDATE', 'No SEO fields to update');
    return toSeoItem(await this.post(`/wp/v2/${type === 'post' ? 'posts' : 'pages'}/${id}`, body), type, await this.activeSeoPlugin());
  }

  /** Media library item behind an <img src> (also matches WordPress' resized variants). */
  async findMediaBySrc(src: string): Promise<WpMediaItem | null> {
    let file: string;
    try {
      file = decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '');
    } catch {
      return null;
    }
    const base = file.replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, '');
    if (!base) return null;
    const list = await this.get<Array<WpMediaItem & { media_details?: { sizes?: Record<string, { source_url: string }> } }>>('/wp/v2/media', { search: base, per_page: 20, context: 'edit' });
    const hit = list.find(m => m.source_url === src || Object.values(m.media_details?.sizes ?? {}).some(s => s.source_url === src)) ?? list.find(m => m.source_url.split('/').pop()?.startsWith(base));
    return hit ? { id: hit.id, source_url: hit.source_url, alt_text: hit.alt_text ?? '', modified_gmt: hit.modified_gmt } : null;
  }

  async getMedia(id: number): Promise<WpMediaItem> {
    const m = await this.get<WpMediaItem>(`/wp/v2/media/${id}`, { context: 'edit' });
    return { id: m.id, source_url: m.source_url, alt_text: m.alt_text ?? '', modified_gmt: m.modified_gmt };
  }

  /** Raw (editable) content of a post or page, as stored: Gutenberg block comments and shortcodes included. */
  async getContent(type: SeoTarget, id: number): Promise<{ raw: string; modified_gmt: string }> {
    const r = await this.get<{ content: { raw?: string; rendered: string }; modified_gmt: string }>(`/wp/v2/${type === 'post' ? 'posts' : 'pages'}/${id}`, { context: 'edit' });
    if (r.content.raw === undefined) throw new WordPressError(0, 'NO_RAW_CONTENT', 'WordPress no devolvió el contenido editable (el usuario necesita permiso para editar esta entrada).');
    return { raw: r.content.raw, modified_gmt: r.modified_gmt };
  }

  /** Replaces the body of a post or page. Used only to insert approved internal links. */
  async updateContent(type: SeoTarget, id: number, raw: string): Promise<void> {
    await this.post(`/wp/v2/${type === 'post' ? 'posts' : 'pages'}/${id}`, { content: raw });
  }

  /** Whether redirects can be created (G.SEO plugin or Redirection plugin active and reachable). */
  async hasRedirectionPlugin(): Promise<boolean> {
    return (await this.redirectBackend()) !== null;
  }

  /** Creates a 301 in the G.SEO plugin, or in the Redirection plugin (first group, usually "Redirections"). */
  async createRedirect(fromPath: string, to: string): Promise<{ id: number }> {
    if ((await this.redirectBackend()) === 'gseo') {
      const r = await this.post<{ id: number }>(`/${GSEO_PLUGIN_NS}/redirects`, { source: fromPath, target: to, code: 301, note: 'G.SEO' });
      return { id: r.id };
    }
    const groups = await this.get<{ items?: Array<{ id: number; name: string; module_id?: number }> }>('/redirection/v1/group', { per_page: 50 });
    const group = (groups.items ?? []).find(g => (g.module_id ?? 1) === 1) ?? groups.items?.[0];
    if (!group) throw new WordPressError(0, 'NO_REDIRECT_GROUP', 'El plugin Redirection no tiene grupos; abre Herramientas → Redirection en WordPress una vez para crearlos.');
    const r = await this.post<{ items?: Array<{ id: number }> } & { id?: number }>('/redirection/v1/redirect', {
      url: fromPath,
      match_type: 'url',
      action_type: 'url',
      action_code: 301,
      action_data: { url: to },
      group_id: group.id,
      regex: false,
      status: 'enabled',
      title: 'G.SEO'
    });
    return { id: r.id ?? r.items?.[0]?.id ?? 0 };
  }

  /** Saves a site setting registered with show_in_rest (needs a user who can manage options). */
  async updateSetting(key: string, value: string): Promise<void> {
    const r = await this.post<Record<string, unknown>>('/wp/v2/settings', { [key]: value });
    if (!(key in r)) throw new WordPressError(404, 'rest_invalid_param', `WordPress no tiene registrado el ajuste ${key}.`);
  }

  /** Deletes a redirect created through the Redirection plugin (bulk endpoint of redirection/v1). */
  async deleteRedirect(id: number): Promise<void> {
    if ((await this.redirectBackend()) === 'gseo') {
      await this.del(`/${GSEO_PLUGIN_NS}/redirects/${id}`);
      return;
    }
    await this.post('/redirection/v1/bulk/redirect/delete', { items: [id] });
  }

  async updateMediaAlt(id: number, alt: string): Promise<WpMediaItem> {
    const m = await this.post<WpMediaItem>(`/wp/v2/media/${id}`, { alt_text: alt });
    return { id: m.id, source_url: m.source_url, alt_text: m.alt_text ?? '', modified_gmt: m.modified_gmt };
  }
}
