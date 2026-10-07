import { Resolver } from 'dns/promises';
import net from 'net';

/**
 * Crawler verification by reverse + forward DNS, as documented by the search engines:
 *  1. reverse-resolve the IP to a hostname,
 *  2. the hostname must end in one of the operator's domains,
 *  3. forward-resolve that hostname; it must include the original IP.
 * Bots that do not publish a DNS method (most AI crawlers, DuckDuckBot) are "unverifiable".
 */
export const DNS_VERIFIABLE: Record<string, { family: string; domains: string[] }> = {
  'Googlebot Smartphone': { family: 'google', domains: ['googlebot.com', 'google.com'] },
  'Googlebot Desktop': { family: 'google', domains: ['googlebot.com', 'google.com'] },
  'Googlebot-Image': { family: 'google', domains: ['googlebot.com', 'google.com'] },
  'Googlebot-Video': { family: 'google', domains: ['googlebot.com', 'google.com'] },
  'Googlebot-News': { family: 'google', domains: ['googlebot.com', 'google.com'] },
  Bingbot: { family: 'bing', domains: ['search.msn.com'] },
  Applebot: { family: 'apple', domains: ['applebot.apple.com'] },
  YandexBot: { family: 'yandex', domains: ['yandex.ru', 'yandex.net', 'yandex.com'] },
  Baiduspider: { family: 'baidu', domains: ['baidu.com', 'baidu.jp'] }
};

export const isDnsVerifiable = (botName: string) => botName in DNS_VERIFIABLE;

export type VerificationResult = 'verified' | 'spoofed' | 'error';

export interface DnsLookups {
  reverse: (ip: string) => Promise<string[]>;
  forward: (hostname: string) => Promise<string[]>;
}

/** Real DNS with short timeouts and a single try. */
export function systemDns(timeoutMs = 2500): DnsLookups {
  const r = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    reverse: ip => r.reverse(ip),
    forward: async host => {
      const [v4, v6] = await Promise.all([r.resolve4(host).catch(() => [] as string[]), r.resolve6(host).catch(() => [] as string[])]);
      return [...v4, ...v6];
    }
  };
}

const normalizeIp = (ip: string) => (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip).toLowerCase();

export async function verifyIp(ip: string, botName: string, dns: DnsLookups): Promise<VerificationResult> {
  const rule = DNS_VERIFIABLE[botName];
  if (!rule || !net.isIP(normalizeIp(ip))) return 'spoofed';
  let hosts: string[];
  try {
    hosts = await dns.reverse(normalizeIp(ip));
  } catch (e) {
    // NXDOMAIN / no PTR record: a real crawler of these operators always has one.
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOTFOUND' || code === 'ENODATA' ? 'spoofed' : 'error';
  }
  const host = hosts.map(h => h.toLowerCase().replace(/\.$/, '')).find(h => rule.domains.some(d => h === d || h.endsWith(`.${d}`)));
  if (!host) return 'spoofed';
  try {
    const addrs = (await dns.forward(host)).map(normalizeIp);
    return addrs.includes(normalizeIp(ip)) ? 'verified' : 'spoofed';
  } catch {
    return 'error';
  }
}

export interface BotVerificationSummary {
  claimedHits: number;
  verifiedHits: number;
  spoofedHits: number;
  errorHits: number;
  /** Hits from IPs beyond the per-import check limit. */
  uncheckedHits: number;
  ipsChecked: number;
}

export interface VerifyOptions {
  dns?: DnsLookups;
  /** Most-active IPs checked per import; the rest are reported as unchecked. */
  maxIps?: number;
  concurrency?: number;
  /** Cache keyed by an opaque IP key (e.g. its HMAC), never the raw IP. */
  cache?: { get: (key: string, family: string) => Promise<VerificationResult | null>; set: (key: string, family: string, r: VerificationResult) => Promise<void> };
  keyOf?: (ip: string) => string;
}

/**
 * Verifies the IPs seen for each DNS-verifiable bot and returns hit counts only.
 * Input: botName -> (raw IP -> hits), held in memory for the duration of the import.
 */
export async function verifyBotIps(byBot: Map<string, Map<string, number>>, opts: VerifyOptions = {}): Promise<Record<string, BotVerificationSummary>> {
  const dns = opts.dns ?? systemDns();
  const maxIps = opts.maxIps ?? 2000;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const out: Record<string, BotVerificationSummary> = {};

  // One check per (family, IP) across bot variants; most active first.
  const tasks = new Map<string, { ip: string; family: string; botName: string; hits: number }>();
  for (const [botName, ips] of byBot) {
    const rule = DNS_VERIFIABLE[botName];
    if (!rule) continue;
    out[botName] = { claimedHits: 0, verifiedHits: 0, spoofedHits: 0, errorHits: 0, uncheckedHits: 0, ipsChecked: 0 };
    for (const [ip, hits] of ips) {
      out[botName].claimedHits += hits;
      const k = `${rule.family}|${ip}`;
      const t = tasks.get(k);
      if (t) t.hits += hits;
      else tasks.set(k, { ip, family: rule.family, botName, hits });
    }
  }
  const ordered = [...tasks.values()].sort((a, b) => b.hits - a.hits);
  const checked = ordered.slice(0, maxIps);
  const results = new Map<string, VerificationResult>();

  let i = 0;
  const worker = async () => {
    while (i < checked.length) {
      const t = checked[i++];
      const key = opts.keyOf ? opts.keyOf(t.ip) : t.ip;
      let r = opts.cache ? await opts.cache.get(key, t.family) : null;
      if (!r) {
        r = await verifyIp(t.ip, t.botName, dns);
        if (opts.cache && r !== 'error') await opts.cache.set(key, t.family, r);
      }
      results.set(`${t.family}|${t.ip}`, r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, checked.length) }, worker));

  for (const [botName, ips] of byBot) {
    const rule = DNS_VERIFIABLE[botName];
    if (!rule) continue;
    const s = out[botName];
    for (const [ip, hits] of ips) {
      const r = results.get(`${rule.family}|${ip}`);
      if (!r) s.uncheckedHits += hits;
      else {
        s.ipsChecked++;
        if (r === 'verified') s.verifiedHits += hits;
        else if (r === 'spoofed') s.spoofedHits += hits;
        else s.errorHits += hits;
      }
    }
  }
  return out;
}
