/**
 * SERP snapshots through SerpAPI (scraping Google directly breaks its terms and gets blocked).
 * The response is reduced to what matters for SEO and AI visibility: which result blocks are on the page,
 * who ranks in the top 10, and which sources the AI Overview cites.
 */

export type SerpFeature = 'ai_overview' | 'featured_snippet' | 'people_also_ask' | 'forums' | 'videos' | 'local_pack' | 'shopping' | 'top_stories' | 'knowledge_panel' | 'images' | 'ads';

export const SERP_FEATURES: Record<SerpFeature, { label: string; above: boolean }> = {
  ai_overview: { label: 'AI Overview', above: true },
  ads: { label: 'Anuncios', above: true },
  featured_snippet: { label: 'Fragmento destacado', above: true },
  local_pack: { label: 'Mapa local', above: true },
  shopping: { label: 'Compras', above: true },
  top_stories: { label: 'Noticias principales', above: true },
  people_also_ask: { label: 'Más preguntas (People Also Ask)', above: false },
  forums: { label: 'Foros y Reddit', above: false },
  videos: { label: 'Videos', above: false },
  images: { label: 'Imágenes', above: false },
  knowledge_panel: { label: 'Panel de conocimiento', above: false }
};

export interface SerpResult {
  organic: Array<{ position: number; url: string; domain: string; title: string; snippet?: string }>;
  features: SerpFeature[];
  aiOverview: { present: boolean; sources: Array<{ url: string; domain: string; title: string }> };
  /** "People also ask" questions. */
  questions?: string[];
  /** "Related searches" at the bottom of the page. */
  related?: string[];
}

export class SerpError extends Error {
  constructor(public code: 'AUTH' | 'QUOTA' | 'PROVIDER_ERROR', message: string) {
    super(message);
    this.name = 'SerpError';
  }
}

const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseSerpApi(j: Json, aiExtra?: Json | null): SerpResult {
  const organic = ((j.organic_results ?? []) as Json[]).filter(r => r.link).map(r => ({ position: Number(r.position) || 0, url: String(r.link), domain: domainOf(String(r.link)), title: String(r.title ?? ''), ...(r.snippet ? { snippet: String(r.snippet) } : {}) }));
  const f = new Set<SerpFeature>();
  const ai = aiExtra?.ai_overview ?? j.ai_overview;
  if (ai && !ai.error) f.add('ai_overview');
  if (j.answer_box) f.add('featured_snippet');
  if ((j.related_questions ?? []).length) f.add('people_also_ask');
  if ((j.discussions_and_forums ?? []).length || organic.slice(0, 10).some(o => /(^|\.)(reddit\.com|quora\.com)$/.test(o.domain))) f.add('forums');
  if ((j.inline_videos ?? []).length || (j.video_results ?? []).length || (j.short_videos ?? []).length) f.add('videos');
  if (j.local_results) f.add('local_pack');
  if ((j.shopping_results ?? []).length || (j.inline_shopping ?? []).length || j.immersive_products) f.add('shopping');
  if ((j.top_stories ?? []).length) f.add('top_stories');
  if (j.knowledge_graph) f.add('knowledge_panel');
  if ((j.inline_images ?? []).length) f.add('images');
  if ((j.ads ?? []).length) f.add('ads');
  const refs = ((ai?.references ?? []) as Json[]).filter(r => r.link).map(r => ({ url: String(r.link), domain: domainOf(String(r.link)), title: String(r.title ?? r.source ?? '') }));
  const questions = ((j.related_questions ?? []) as Json[]).map(q => String(q.question ?? '')).filter(Boolean);
  const related = ((j.related_searches ?? []) as Json[]).map(q => String(q.query ?? '')).filter(Boolean);
  return { organic, features: [...f], aiOverview: { present: f.has('ai_overview'), sources: refs }, questions, related };
}

export class SerpApiClient {
  constructor(private apiKey: string, private baseUrl = (process.env.SERPAPI_URL ?? 'https://serpapi.com/search.json').replace(/\/$/, '')) {}

  private async get(params: Record<string, string>): Promise<Json> {
    const res = await fetch(`${this.baseUrl}?${new URLSearchParams({ ...params, api_key: this.apiKey })}`, { signal: AbortSignal.timeout(60_000) });
    const j = (await res.json().catch(() => ({}))) as Json;
    if (res.status === 401 || /invalid api key/i.test(String(j.error ?? ''))) throw new SerpError('AUTH', 'La clave de SerpAPI no es válida. Revísala en Configuración.');
    if (res.status === 429 || /run out of searches|plan/i.test(String(j.error ?? ''))) throw new SerpError('QUOTA', 'Se acabaron las búsquedas de tu plan de SerpAPI este mes.');
    if (!res.ok || (j.error && !/hasn't returned any results/i.test(String(j.error)))) throw new SerpError('PROVIDER_ERROR', `SerpAPI: ${j.error ?? `HTTP ${res.status}`}`);
    return j;
  }

  /** One Google results page (desktop, first 10 results) for a keyword in a country and language. */
  async search(q: string, opts: { gl: string; hl: string }): Promise<SerpResult> {
    const j = await this.get({ engine: 'google', q, gl: opts.gl, hl: opts.hl, num: '10', device: 'desktop' });
    // Some AI Overviews come as a token that needs a second request to get their sources.
    let extra: Json | null = null;
    if (j.ai_overview?.page_token && !(j.ai_overview.references ?? []).length) extra = await this.get({ engine: 'google_ai_overview', page_token: String(j.ai_overview.page_token) }).catch(() => null);
    return parseSerpApi(j, extra);
  }
}
