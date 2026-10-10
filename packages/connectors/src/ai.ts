import Anthropic from '@anthropic-ai/sdk';

/**
 * AI providers for the "Visibilidad en IA" module.
 * Today only the written analysis runs (Claude). Keys for the other providers are stored now so the
 * automated checks (ChatGPT, Claude, Gemini, Google AI via a SERP API) can be wired in later.
 */

export const AI_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', usedFor: 'Análisis con IA; más adelante, consultas automáticas a Claude', keyPrefix: 'sk-ant-' },
  openai: { label: 'OpenAI (ChatGPT)', usedFor: 'Más adelante: consultas automáticas a ChatGPT', keyPrefix: 'sk-' },
  google: { label: 'Google AI Studio (Gemini)', usedFor: 'Más adelante: consultas automáticas a Gemini', keyPrefix: 'AIza' },
  serpapi: { label: 'SerpAPI (Google AI Overviews)', usedFor: 'Más adelante: respuestas de IA de Google', keyPrefix: '' }
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;

export const ANALYSIS_MODEL = 'claude-opus-5-5';

export class AiError extends Error {
  constructor(public code: 'AUTH' | 'RATE_LIMIT' | 'REFUSED' | 'PROVIDER_ERROR', message: string) {
    super(message);
    this.name = 'AiError';
  }
}

/** One Claude request that returns plain text. Server-side fallback is on, so a policy decline is retried on a fallback model in the same call. */
export async function analyzeWithClaude(apiKey: string, system: string, content: string): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}), maxRetries: 2 });
  try {
    const params = {
      model: ANALYSIS_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }]
    };
    // `fallbacks` is newer than some SDK typings; the request shape follows the API reference.
    const response = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0])) as Anthropic.Beta.BetaMessage;
    if (response.stop_reason === 'refusal') throw new AiError('REFUSED', 'El modelo no generó el análisis (rechazo de seguridad). Intenta de nuevo o revisa el texto pegado en las respuestas.');
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (!text) throw new AiError('PROVIDER_ERROR', 'Claude respondió sin texto.');
    return { text, model: response.model };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('AUTH', 'La clave de Anthropic no es válida o no tiene permiso. Revísala en Configuración.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('RATE_LIMIT', 'Anthropic limitó las solicitudes por ahora. Intenta en unos minutos.');
    if (e instanceof Anthropic.APIError) throw new AiError('PROVIDER_ERROR', `Anthropic respondió ${e.status ?? ''}: ${e.message}`.trim());
    throw new AiError('PROVIDER_ERROR', `No se pudo contactar a Anthropic: ${(e as Error).message}`);
  }
}
