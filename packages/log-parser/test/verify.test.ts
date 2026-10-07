import { describe, it, expect } from 'vitest';
import { verifyIp, verifyBotIps, DnsLookups } from '@glitch/log-parser';

/** Fake DNS: real Googlebot/Bing style records, plus a spoofer whose PTR claims googlebot.com. */
const PTR: Record<string, string[]> = {
  '66.249.66.1': ['crawl-66-249-66-1.googlebot.com'],
  '157.55.39.10': ['msnbot-157-55-39-10.search.msn.com.'],
  '198.51.100.7': ['crawl-fake.googlebot.com'], // PTR controlled by an attacker
  '192.0.2.50': ['host.example.net']
};
const A: Record<string, string[]> = {
  'crawl-66-249-66-1.googlebot.com': ['66.249.66.1'],
  'msnbot-157-55-39-10.search.msn.com': ['157.55.39.10'],
  'crawl-fake.googlebot.com': ['66.249.66.99'] // forward lookup does not point back
};
let calls = 0;
const dns: DnsLookups = {
  reverse: async ip => {
    calls++;
    if (ip === '10.9.9.9') throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
    if (!PTR[ip]) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return PTR[ip];
  },
  forward: async host => A[host] ?? []
};

describe('verifyIp (reverse + forward DNS)', () => {
  it('verifies real crawlers and rejects spoofers', async () => {
    expect(await verifyIp('66.249.66.1', 'Googlebot Smartphone', dns)).toBe('verified');
    expect(await verifyIp('157.55.39.10', 'Bingbot', dns)).toBe('verified');
    expect(await verifyIp('198.51.100.7', 'Googlebot Desktop', dns)).toBe('spoofed'); // PTR ok, A does not match
    expect(await verifyIp('192.0.2.50', 'Googlebot Desktop', dns)).toBe('spoofed'); // wrong domain
    expect(await verifyIp('203.0.113.1', 'Googlebot Desktop', dns)).toBe('spoofed'); // no PTR
    expect(await verifyIp('66.249.66.1', 'Bingbot', dns)).toBe('spoofed'); // Google IP claiming to be Bing
    expect(await verifyIp('10.9.9.9', 'Googlebot Desktop', dns)).toBe('error'); // DNS timeout is not a verdict
  });
});

describe('verifyBotIps', () => {
  const byBot = () =>
    new Map([
      ['Googlebot Smartphone', new Map([['66.249.66.1', 90], ['203.0.113.1', 10]])],
      ['Googlebot-Image', new Map([['66.249.66.1', 5]])],
      ['Bingbot', new Map([['157.55.39.10', 7]])],
      ['GPTBot', new Map([['1.2.3.4', 3]])]
    ]);

  it('returns hit counts per bot and checks each family+IP once', async () => {
    calls = 0;
    const r = await verifyBotIps(byBot(), { dns });
    expect(r['Googlebot Smartphone']).toEqual({ claimedHits: 100, verifiedHits: 90, spoofedHits: 10, errorHits: 0, uncheckedHits: 0, ipsChecked: 2 });
    expect(r['Googlebot-Image'].verifiedHits).toBe(5);
    expect(r.Bingbot.verifiedHits).toBe(7);
    expect(r.GPTBot).toBeUndefined(); // no DNS method published
    expect(calls).toBe(3); // 66.249.66.1 shared by two Google variants
  });

  it('respects the IP limit (most active first) and uses the cache', async () => {
    const r = await verifyBotIps(byBot(), { dns, maxIps: 1 });
    expect(r['Googlebot Smartphone']).toMatchObject({ verifiedHits: 90, uncheckedHits: 10 });
    const store = new Map<string, 'verified' | 'spoofed' | 'error'>();
    const cache = { get: async (k: string, f: string) => store.get(`${f}:${k}`) ?? null, set: async (k: string, f: string, v: 'verified' | 'spoofed' | 'error') => void store.set(`${f}:${k}`, v) };
    await verifyBotIps(byBot(), { dns, cache, keyOf: ip => `h(${ip})` });
    calls = 0;
    await verifyBotIps(byBot(), { dns, cache, keyOf: ip => `h(${ip})` });
    expect(calls).toBe(0);
    expect([...store.keys()].every(k => k.includes('h('))).toBe(true); // keys are opaque, not raw IPs
  });
});
