import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { describe, it, expect } from 'vitest';
import { parseLogDate, parseLogLine, analyzeLogFile, identifyBot, identifyAiReferrer, writeSyntheticLog } from '@glitch/log-parser';

const SALT = 'test-salt';
const NGINX =
  '66.249.66.1 - - [05/Oct/2026:14:32:10 +0000] "GET /blog/post?utm_source=x&token=abc HTTP/1.1" 200 4520 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" 0.120';
const APACHE =
  '192.0.2.10 - frank [10/Oct/2026:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 304 - "http://www.example.com/start.html" "Mozilla/5.0 (Windows NT 10.0)"';

const tmpFile = (name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glitch-test-')), name);

describe('parseLogDate', () => {
  it('converts timezone offsets to UTC', () => {
    expect(parseLogDate('05/Oct/2026:14:32:10 +0000')?.toISOString()).toBe('2026-10-05T14:32:10.000Z');
    expect(parseLogDate('10/Oct/2026:13:55:36 -0700')?.toISOString()).toBe('2026-10-10T20:55:36.000Z');
    expect(parseLogDate('01/Jan/2026:00:30:00 +0200')?.toISOString()).toBe('2025-12-31T22:30:00.000Z');
  });
  it('rejects malformed dates', () => {
    expect(parseLogDate('2026-10-05 14:32:10')).toBeNull();
    expect(parseLogDate('05/Foo/2026:14:32:10 +0000')).toBeNull();
  });
});

describe('parseLogLine', () => {
  it('parses nginx combined with $request_time and sanitizes the query', () => {
    const e = parseLogLine(NGINX, SALT)!;
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/blog/post');
    expect(e.url).toContain('token=%5BREDACTED%5D');
    expect(e.url).toContain('utm_source=x');
    expect(e.statusCode).toBe(200);
    expect(e.responseTimeMs).toBe(120);
    expect(e.botName).toBe('Googlebot Desktop');
  });
  it('parses apache combined without $request_time', () => {
    const e = parseLogLine(APACHE, SALT)!;
    expect(e.statusCode).toBe(304);
    expect(e.bytes).toBe(0);
    expect(e.responseTimeMs).toBeNull();
    expect(e.isBot).toBe(false);
  });
  it('never exposes the raw IP', () => {
    const e = parseLogLine(NGINX, SALT)!;
    expect(e.ipHash).not.toContain('66.249');
    expect(e.ipHash).toHaveLength(16);
    expect(parseLogLine(NGINX, 'other-salt')!.ipHash).not.toBe(e.ipHash);
  });
  it('returns null for garbage', () => {
    expect(parseLogLine('not a log line', SALT)).toBeNull();
    expect(parseLogLine('', SALT)).toBeNull();
  });
});

describe('identifyBot', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot Smartphone'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot Desktop'],
    ['Googlebot-Image/1.0', 'Googlebot-Image'],
    ['Mozilla/5.0 (compatible; Claude-SearchBot/1.0)', 'Claude-SearchBot'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'ChatGPT-User'],
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0)', 'OAI-SearchBot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0)', 'Bingbot'],
    ['SomeRandomCrawler/1.0', 'Unknown Bot'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0', 'Browser / Other']
  ])('%s -> %s', (ua, name) => {
    expect(identifyBot(ua).name).toBe(name);
  });
  it('detects AI answer-engine referrers', () => {
    expect(identifyAiReferrer('https://chatgpt.com/')).toBe('ChatGPT');
    expect(identifyAiReferrer('https://www.perplexity.ai/search?q=x')).toBe('Perplexity');
    expect(identifyAiReferrer('https://www.google.com/')).toBeNull();
  });
});

describe('analyzeLogFile', () => {
  const lines = [NGINX, APACHE, 'garbage line from 10.1.2.3 with secret', '', NGINX.replace('200 4520', '404 100')].join('\n');

  it('counts valid, invalid and skipped lines and redacts error samples', async () => {
    const f = tmpFile('a.log');
    fs.writeFileSync(f, lines);
    const r = await analyzeLogFile(f, { salt: SALT });
    expect(r.totalLines).toBe(5);
    expect(r.validLines).toBe(3);
    expect(r.invalidLines).toBe(1);
    expect(r.skippedLines).toBe(1);
    expect(r.botRequests).toBe(2);
    expect(r.googlebotRequests).toBe(2);
    expect(r.statusDistribution).toEqual({ 200: 1, 304: 1, 404: 1 });
    expect(r.errorSamples[0]).toContain('[ip]');
    expect(r.errorSamples[0]).not.toContain('10.1.2.3');
    expect(r.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reads gzip by magic bytes, regardless of extension', async () => {
    const f = tmpFile('compressed.txt');
    fs.writeFileSync(f, zlib.gzipSync(lines));
    const r = await analyzeLogFile(f, { salt: SALT });
    expect(r.validLines).toBe(3);
  });

  it('aborts when decompressed size exceeds the limit (zip-bomb guard)', async () => {
    const f = tmpFile('bomb.gz');
    fs.writeFileSync(f, zlib.gzipSync(Buffer.from('aaaaaaaaaaaaaaa\n'.repeat(320_000)))); // ~5 MB of short lines
    await expect(analyzeLogFile(f, { maxDecompressedBytes: 1024 * 1024 })).rejects.toThrow(/exceeds limit/);
  });

  it('rejects files with a single huge line (not a log)', async () => {
    const f = tmpFile('blob.txt');
    fs.writeFileSync(f, Buffer.alloc(2 * 1024 * 1024, 'a'));
    await expect(analyzeLogFile(f)).rejects.toThrow(/Line exceeds 1 MB/);
  });

  it('aggregates synthetic traffic deterministically', async () => {
    const f = tmpFile('synthetic.log');
    await writeSyntheticLog(f, 5_000, { seed: 1, days: 3 });
    const a = await analyzeLogFile(f);
    const b = await analyzeLogFile(f);
    expect(a.validLines).toBe(5_000);
    expect(a.checksum).toBe(b.checksum);
    expect(a.aggregates.reduce((s, r) => s + r.hits, 0)).toBe(5_000);
    expect(a.aiBotRequests).toBeGreaterThan(0);
    expect(a.responseTime.p50).not.toBeNull();
    expect(Object.keys(a.crawledParameters)).toContain('page');
  });

  it('can be cancelled with an AbortSignal', async () => {
    const f = tmpFile('cancel.log');
    await writeSyntheticLog(f, 2_000, { seed: 2 });
    const ac = new AbortController();
    ac.abort();
    const r = await analyzeLogFile(f, { signal: ac.signal });
    expect(r.cancelled).toBe(true);
  });
});
