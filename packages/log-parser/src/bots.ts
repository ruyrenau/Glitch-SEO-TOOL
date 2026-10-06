export interface BotIdentity {
  name: string;
  category: 'SEARCH_ENGINE' | 'AI_CRAWLER' | 'SEO_TOOL' | 'SOCIAL' | 'UNKNOWN';
  verified: boolean;
  pattern: RegExp;
}

export const KNOWN_BOTS: Array<{ name: string; category: BotIdentity['category']; pattern: RegExp }> = [
  { name: 'Googlebot Smartphone', category: 'SEARCH_ENGINE', pattern: /Googlebot/i },
  { name: 'Googlebot-Image', category: 'SEARCH_ENGINE', pattern: /Googlebot-Image/i },
  { name: 'Googlebot', category: 'SEARCH_ENGINE', pattern: /Googlebot/i },
  { name: 'Bingbot', category: 'SEARCH_ENGINE', pattern: /bingbot/i },
  { name: 'Applebot', category: 'SEARCH_ENGINE', pattern: /Applebot/i },
  { name: 'DuckDuckBot', category: 'SEARCH_ENGINE', pattern: /DuckDuckBot/i },
  { name: 'YandexBot', category: 'SEARCH_ENGINE', pattern: /YandexBot/i },
  { name: 'Baiduspider', category: 'SEARCH_ENGINE', pattern: /Baiduspider/i },
  // AI Bots
  { name: 'GPTBot', category: 'AI_CRAWLER', pattern: /GPTBot/i },
  { name: 'ChatGPT-User', category: 'AI_CRAWLER', pattern: /ChatGPT-User/i },
  { name: 'OAI-SearchBot', category: 'AI_CRAWLER', pattern: /OAI-SearchBot/i },
  { name: 'ClaudeBot', category: 'AI_CRAWLER', pattern: /ClaudeBot/i },
  { name: 'Claude-SearchBot', category: 'AI_CRAWLER', pattern: /Claude-SearchBot/i },
  { name: 'PerplexityBot', category: 'AI_CRAWLER', pattern: /PerplexityBot/i },
  { name: 'Bytespider', category: 'AI_CRAWLER', pattern: /Bytespider/i },
  { name: 'Amazonbot', category: 'AI_CRAWLER', pattern: /Amazonbot/i },
  // Social & SEO
  { name: 'FacebookExternalHit', category: 'SOCIAL', pattern: /facebookexternalhit/i },
  { name: 'AhrefsBot', category: 'SEO_TOOL', pattern: /AhrefsBot/i },
  { name: 'SemrushBot', category: 'SEO_TOOL', pattern: /SemrushBot/i }
];

export function identifyBot(userAgent: string): { name: string; category: BotIdentity['category']; isBot: boolean } {
  if (!userAgent) return { name: 'Unknown', category: 'UNKNOWN', isBot: false };
  for (const bot of KNOWN_BOTS) {
    if (bot.pattern.test(userAgent)) {
      return { name: bot.name, category: bot.category, isBot: true };
    }
  }
  if (/bot|crawler|spider|crawling/i.test(userAgent)) {
    return { name: 'Unknown Bot', category: 'UNKNOWN', isBot: true };
  }
  return { name: 'Browser / Direct', category: 'UNKNOWN', isBot: false };
}
