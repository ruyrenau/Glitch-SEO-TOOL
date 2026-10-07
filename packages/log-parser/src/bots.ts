export type BotCategory = 'SEARCH_ENGINE' | 'AI_CRAWLER' | 'AI_ASSISTANT' | 'SEO_TOOL' | 'SOCIAL' | 'UNKNOWN';

export interface BotIdentity {
  name: string;
  category: BotCategory;
  isBot: boolean;
}

interface BotRule {
  name: string;
  category: BotCategory;
  pattern: RegExp;
  /** Extra condition evaluated on the full UA (e.g. smartphone vs desktop). */
  when?: (ua: string) => boolean;
}

/**
 * Order matters: the first matching rule wins, so specific variants
 * (Googlebot-Image, Claude-SearchBot, ChatGPT-User) come before generic ones.
 */
export const KNOWN_BOTS: BotRule[] = [
  { name: 'Googlebot-Image', category: 'SEARCH_ENGINE', pattern: /Googlebot-Image/i },
  { name: 'Googlebot-Video', category: 'SEARCH_ENGINE', pattern: /Googlebot-Video/i },
  { name: 'Googlebot-News', category: 'SEARCH_ENGINE', pattern: /Googlebot-News/i },
  { name: 'Googlebot Smartphone', category: 'SEARCH_ENGINE', pattern: /Googlebot\//i, when: ua => /Mobile|Android|iPhone/i.test(ua) },
  { name: 'Googlebot Desktop', category: 'SEARCH_ENGINE', pattern: /Googlebot\//i },
  { name: 'Google-Extended', category: 'AI_CRAWLER', pattern: /Google-Extended/i },
  { name: 'Bingbot', category: 'SEARCH_ENGINE', pattern: /bingbot/i },
  { name: 'Applebot', category: 'SEARCH_ENGINE', pattern: /Applebot\//i },
  { name: 'DuckDuckBot', category: 'SEARCH_ENGINE', pattern: /DuckDuckBot/i },
  { name: 'YandexBot', category: 'SEARCH_ENGINE', pattern: /YandexBot/i },
  { name: 'Baiduspider', category: 'SEARCH_ENGINE', pattern: /Baiduspider/i },
  // AI crawlers (training / indexing)
  { name: 'OAI-SearchBot', category: 'AI_CRAWLER', pattern: /OAI-SearchBot/i },
  { name: 'GPTBot', category: 'AI_CRAWLER', pattern: /GPTBot/i },
  { name: 'Claude-SearchBot', category: 'AI_CRAWLER', pattern: /Claude-SearchBot/i },
  { name: 'ClaudeBot', category: 'AI_CRAWLER', pattern: /ClaudeBot/i },
  { name: 'PerplexityBot', category: 'AI_CRAWLER', pattern: /PerplexityBot/i },
  { name: 'Bytespider', category: 'AI_CRAWLER', pattern: /Bytespider/i },
  { name: 'Amazonbot', category: 'AI_CRAWLER', pattern: /Amazonbot/i },
  { name: 'CCBot', category: 'AI_CRAWLER', pattern: /CCBot/i },
  // AI assistants fetching on behalf of a user
  { name: 'ChatGPT-User', category: 'AI_ASSISTANT', pattern: /ChatGPT-User/i },
  { name: 'Claude-User', category: 'AI_ASSISTANT', pattern: /Claude-User/i },
  { name: 'Perplexity-User', category: 'AI_ASSISTANT', pattern: /Perplexity-User/i },
  // Social & SEO tools
  { name: 'FacebookExternalHit', category: 'SOCIAL', pattern: /facebookexternalhit/i },
  { name: 'AhrefsBot', category: 'SEO_TOOL', pattern: /AhrefsBot/i },
  { name: 'SemrushBot', category: 'SEO_TOOL', pattern: /SemrushBot/i },
  { name: 'Screaming Frog', category: 'SEO_TOOL', pattern: /Screaming Frog/i }
];

export function identifyBot(userAgent: string): BotIdentity {
  if (!userAgent || userAgent === '-') return { name: 'Unknown', category: 'UNKNOWN', isBot: false };
  for (const bot of KNOWN_BOTS) {
    if (bot.pattern.test(userAgent) && (!bot.when || bot.when(userAgent))) {
      return { name: bot.name, category: bot.category, isBot: true };
    }
  }
  if (/bot|crawler|spider|crawling/i.test(userAgent)) {
    return { name: 'Unknown Bot', category: 'UNKNOWN', isBot: true };
  }
  return { name: 'Browser / Other', category: 'UNKNOWN', isBot: false };
}

export function isGooglebot(name: string): boolean {
  return name.startsWith('Googlebot');
}

export function isAiBot(category: BotCategory): boolean {
  return category === 'AI_CRAWLER' || category === 'AI_ASSISTANT';
}

/** Referrer hosts that indicate a human click coming from an AI answer engine. */
const AI_REFERRERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'ChatGPT', pattern: /^https?:\/\/(chat\.openai\.com|chatgpt\.com)/i },
  { name: 'Perplexity', pattern: /^https?:\/\/(www\.)?perplexity\.ai/i },
  { name: 'Claude', pattern: /^https?:\/\/claude\.ai/i },
  { name: 'Gemini', pattern: /^https?:\/\/gemini\.google\.com/i },
  { name: 'Copilot', pattern: /^https?:\/\/copilot\.microsoft\.com/i }
];

export function identifyAiReferrer(referer: string): string | null {
  if (!referer || referer === '-') return null;
  for (const r of AI_REFERRERS) if (r.pattern.test(referer)) return r.name;
  return null;
}
