import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma, createSite, importLogFile, getLogReport } from '@glitch/db';
import type { DnsLookups } from '@glitch/log-parser';

const dns: DnsLookups = {
  reverse: async ip => {
    if (ip === '66.249.66.1') return ['crawl-66-249-66-1.googlebot.com'];
    throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
  },
  forward: async host => (host === 'crawl-66-249-66-1.googlebot.com' ? ['66.249.66.1'] : [])
};
const line = (ip: string, ua: string, p: string) => `${ip} - - [05/Oct/2026:10:00:00 +0000] "GET ${p} HTTP/1.1" 200 100 "-" "${ua}" 0.1`;
const GOOGLE = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

afterAll(() => prisma.$disconnect());

describe('crawler DNS verification during import', () => {
  it('stores verified vs spoofed hit counts and never a raw IP', async () => {
    const site = await createSite({ name: 'Verify', domain: 'verify.example.com', canonicalUrl: 'https://verify.example.com' });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glitch-v-')), 'a.log');
    fs.writeFileSync(file, [line('66.249.66.1', GOOGLE, '/a'), line('66.249.66.1', GOOGLE, '/b'), line('203.0.113.77', GOOGLE, '/a'), line('198.51.100.3', 'GPTBot/1.2', '/a')].join('\n'));
    const r = await importLogFile({ siteId: site.id, filePath: file, verifyBots: true, dns });
    expect(r.analysis.botVerification!['Googlebot Desktop']).toMatchObject({ claimedHits: 3, verifiedHits: 2, spoofedHits: 1 });
    expect(JSON.stringify(r.analysis)).not.toMatch(/66\.249\.66\.1|203\.0\.113\.77/);

    const report = await getLogReport(site.id);
    expect(report!.botVerification!['Googlebot Desktop'].spoofedHits).toBe(1);
    const imp = await prisma.logImport.findUniqueOrThrow({ where: { id: r.importId } });
    expect(JSON.stringify(imp, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))).not.toMatch(/66\.249\.66\.1|203\.0\.113\.77/);
    const cache = await prisma.botIpVerification.findMany();
    expect(cache.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(cache)).not.toMatch(/66\.249|203\.0\.113|googlebot\.com/);
  });

  it('can be turned off', async () => {
    const site = await createSite({ name: 'NoVerify', domain: 'nov.example.com', canonicalUrl: 'https://nov.example.com' });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glitch-v-')), 'b.log');
    fs.writeFileSync(file, line('66.249.66.1', GOOGLE, '/x'));
    const r = await importLogFile({ siteId: site.id, filePath: file, verifyBots: false, dns });
    expect(r.analysis.botVerification).toBeNull();
  });
});
