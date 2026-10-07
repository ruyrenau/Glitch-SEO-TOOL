import fs from 'fs';
import { once } from 'events';

/**
 * DEMO / TEST ONLY. Deterministic synthetic Nginx log generator.
 * Output is clearly fake (documentation IP ranges, example.com referers).
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AGENTS: Array<[number, string]> = [
  [30, 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [8, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [3, 'Googlebot-Image/1.0'],
  [6, 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  [5, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'],
  [2, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)'],
  [3, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  [2, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  [1, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)'],
  [2, 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
  [38, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36']
];
const AGENT_TOTAL = AGENTS.reduce((s, [w]) => s + w, 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export const SYNTHETIC_SECTIONS = ['blog', 'servicios', 'productos', 'ciudades', 'docs'] as const;
/** Paths that the synthetic sitemap lists (some are rarely or never crawled). */
export function syntheticSitemapPaths(perSection = 40): string[] {
  const out: string[] = ['/'];
  for (const s of SYNTHETIC_SECTIONS) {
    for (let i = 1; i <= perSection; i++) out.push(`/${s}/item-${i}/`);
    // "New" pages listed in the sitemap that bots never request in the synthetic log.
    for (let i = 61; i <= 66; i++) out.push(`/${s}/item-${i}/`);
  }
  return out;
}

export function syntheticLogLine(rand: () => number, ts: Date): string {
  let pick = rand() * AGENT_TOTAL;
  let ua = AGENTS[AGENTS.length - 1][1];
  for (const [w, a] of AGENTS) {
    if ((pick -= w) < 0) { ua = a; break; }
  }
  const section = SYNTHETIC_SECTIONS[Math.floor(rand() * SYNTHETIC_SECTIONS.length)];
  // Skewed popularity: low item numbers are crawled far more often; items > 40 are not in the sitemap.
  const item = 1 + Math.floor(Math.pow(rand(), 2.2) * 55);
  let path = `/${section}/item-${item}/`;
  let status = 200;
  const r = rand();
  if (r < 0.06) { path = `/${section}/?page=${1 + Math.floor(rand() * 30)}&sort=${rand() < 0.5 ? 'asc' : 'desc'}`; }
  else if (r < 0.09) { path = `/old/${section}-${item}`; status = 301; }
  else if (r < 0.115) { path = `/${section}/removed-${item}/`; status = 404; }
  else if (r < 0.122) { status = 500; }
  else if (r < 0.13) { path = `/search?q=item${item}&email=user${item}@example.com`; }
  // Real crawler ranges for Google and Bing (so DNS verification has something true to verify),
  // with ~4% of "Googlebot" traffic from a documentation range to simulate spoofers.
  const isGoogle = /Googlebot/.test(ua);
  const isBing = /bingbot/.test(ua);
  const ip =
    isGoogle && rand() > 0.04
      ? `66.249.66.${1 + Math.floor(rand() * 12)}`
      : isBing
        ? `157.55.39.${10 + Math.floor(rand() * 8)}`
        : `203.0.113.${Math.floor(rand() * 254) + 1}`;
  const bytes = status === 200 ? 3000 + Math.floor(rand() * 40000) : 400;
  const rt = (status === 500 ? 1.5 + rand() * 3 : 0.04 + Math.pow(rand(), 3) * 1.8).toFixed(3);
  const referer = !/bot|Googlebot/i.test(ua) && rand() < 0.04
    ? ['https://chatgpt.com/', 'https://www.perplexity.ai/', 'https://claude.ai/', 'https://gemini.google.com/'][Math.floor(rand() * 4)]
    : '-';
  const d = `${pad(ts.getUTCDate())}/${MONTHS[ts.getUTCMonth()]}/${ts.getUTCFullYear()}:${pad(ts.getUTCHours())}:${pad(ts.getUTCMinutes())}:${pad(ts.getUTCSeconds())} +0000`;
  return `${ip} - - [${d}] "GET ${path} HTTP/1.1" ${status} ${bytes} "${referer}" "${ua}" ${rt}`;
}

/** Writes `lines` synthetic lines spread over `days` days ending at `end`, honoring backpressure. */
export async function writeSyntheticLog(filePath: string, lines: number, opts: { seed?: number; days?: number; end?: Date } = {}): Promise<void> {
  const rand = mulberry32(opts.seed ?? 42);
  const days = opts.days ?? 14;
  const end = (opts.end ?? new Date('2026-10-05T00:00:00Z')).getTime();
  const start = end - days * 86_400_000;
  const step = (end - start) / lines;
  const out = fs.createWriteStream(filePath);
  for (let i = 0; i < lines; i++) {
    if (!out.write(syntheticLogLine(rand, new Date(start + i * step)) + '\n')) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
}
