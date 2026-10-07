import fs from 'fs';
import crypto from 'crypto';
import { StringDecoder } from 'string_decoder';
import zlib from 'zlib';
import { Readable } from 'stream';
import { anonymizeIp, sanitizeQueryString } from '@glitch/core';
import { identifyBot, identifyAiReferrer, isAiBot, isGooglebot, BotCategory } from './bots';

export interface ParsedLogEntry {
  ipHash: string;
  timestamp: Date;
  method: string;
  url: string;
  path: string;
  query: string;
  protocol: string;
  statusCode: number;
  bytes: number;
  referer: string;
  userAgent: string;
  /** null when the log format does not include $request_time. */
  responseTimeMs: number | null;
  botName: string;
  botCategory: BotCategory;
  isBot: boolean;
}

export interface ParseOptions {
  salt?: string;
  customSensitiveParams?: string[];
  onProgress?: (linesProcessed: number) => void;
  maxLines?: number;
  signal?: AbortSignal;
}

/**
 * Nginx/Apache "combined" format, optionally followed by $request_time (seconds).
 * IP - user [date] "METHOD URL PROTOCOL" STATUS BYTES "REFERER" "UA" [request_time]
 */
const COMBINED_LOG_REGEX =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+)(?: (HTTP\/[\d.]+))?" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?(?: (\d+(?:\.\d+)?))?/;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

/** Parses "05/Oct/2026:14:32:10 +0000" into a UTC Date. Returns null if malformed. */
export function parseLogDate(value: string): Date | null {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  const utc = Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]);
  const offsetMin = (+m[8] * 60 + +m[9]) * (m[7] === '-' ? -1 : 1);
  return new Date(utc - offsetMin * 60_000);
}

export function parseLogLine(line: string, salt: string, customSensitiveParams: string[] = []): ParsedLogEntry | null {
  const match = COMBINED_LOG_REGEX.exec(line);
  if (!match) return null;
  const timestamp = parseLogDate(match[2]);
  if (!timestamp) return null;

  const fullUrl = match[4];
  const qIndex = fullUrl.indexOf('?');
  const path = qIndex === -1 ? fullUrl : fullUrl.slice(0, qIndex);
  const query = qIndex === -1 ? '' : sanitizeQueryString(fullUrl.slice(qIndex), customSensitiveParams);
  const userAgent = match[9] ?? '';
  const bot = identifyBot(userAgent);

  return {
    ipHash: anonymizeIp(match[1], salt),
    timestamp,
    method: match[3],
    url: path + query,
    path,
    query,
    protocol: match[5] ?? '',
    statusCode: parseInt(match[6], 10),
    bytes: match[7] === '-' ? 0 : parseInt(match[7], 10),
    referer: match[8] ?? '',
    userAgent,
    responseTimeMs: match[10] !== undefined ? Math.round(parseFloat(match[10]) * 1000) : null,
    botName: bot.name,
    botCategory: bot.category,
    isBot: bot.isBot
  };
}

// ---------------------------------------------------------------------------
// Streaming aggregation
// ---------------------------------------------------------------------------

export interface LogAggregateRow {
  date: string; // YYYY-MM-DD (UTC)
  botName: string;
  botCategory: string;
  statusCode: number;
  path: string;
  hits: number;
  bytes: number;
  durationSumMs: number;
  durationCount: number;
}

export interface LogAnalysis {
  checksum: string;
  totalLines: number;
  validLines: number;
  invalidLines: number;
  skippedLines: number;
  botRequests: number;
  googlebotRequests: number;
  aiBotRequests: number;
  startDate: Date | null;
  endDate: Date | null;
  statusDistribution: Record<string, number>;
  botDistribution: Record<string, number>;
  hourlyBotHits: number[]; // 24 buckets, UTC
  aiReferrals: Record<string, number>;
  crawledParameters: Record<string, number>;
  responseTime: { p50: number | null; p90: number | null; p99: number | null; samples: number };
  errorSamples: string[];
  aggregates: LogAggregateRow[];
  /** True if the distinct-key cap was hit and some paths were folded into "(other)". */
  aggregatesTruncated: boolean;
  cancelled: boolean;
}

/** Upper bound of distinct (day, bot, status, path) keys kept in memory. */
const MAX_AGGREGATE_KEYS = 250_000;
const MAX_PARAM_KEYS = 500;
/** Fixed histogram buckets (ms) so percentiles use constant memory. */
const LATENCY_BUCKETS = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, Infinity];

function percentileFromHistogram(hist: number[], total: number, p: number): number | null {
  if (total === 0) return null;
  const target = Math.ceil(total * p);
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return LATENCY_BUCKETS[i] === Infinity ? LATENCY_BUCKETS[i - 1] : LATENCY_BUCKETS[i];
  }
  return null;
}

/** Returns a flat copy of a string so it no longer references the source chunk. */
const detach = (s: string): string => Buffer.from(s, 'utf8').toString('utf8');

const IPV4 =/\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;

/** Error samples must never leak raw IPs or secrets. */
function redactSample(line: string): string {
  return line.replace(IPV4, '[ip]').replace(IPV6, '[ip]').replace(/([?&](?:token|password|email|key|session)[^=]*=)[^&\s"]*/gi, '$1[REDACTED]').slice(0, 300);
}

/**
 * Splits a byte stream into lines. Unlike readline's async iterator, the next
 * chunk is only pulled after every line of the current one was consumed, so
 * backpressure holds and memory stays flat. The stream is not destroyed on early exit.
 */
export async function* readLines(input: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  for await (const chunk of input.iterator({ destroyOnReturn: false })) {
    rest += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
    let start = 0;
    let nl: number;
    while ((nl = rest.indexOf('\n', start)) !== -1) {
      const end = nl > start && rest.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      yield rest.slice(start, end);
      start = nl + 1;
    }
    rest = rest.slice(start);
    if (rest.length > 1024 * 1024) throw new Error('Line exceeds 1 MB; is this a log file?');
  }
  rest += decoder.end();
  if (rest.length) yield rest.endsWith(String.fromCharCode(13)) ? rest.slice(0, -1) : rest;
}

/**
 * Consumes a stream of log text line by line. Only bounded aggregates are kept:
 * memory does not grow with the number of lines, only with distinct keys (capped).
 */
export async function analyzeLogStream(input: Readable, options: ParseOptions = {}): Promise<Omit<LogAnalysis, 'checksum'>> {
  const salt = options.salt ?? 'glitch-salt';
  const rl = readLines(input);

  const res: Omit<LogAnalysis, 'checksum' | 'aggregates'> = {
    totalLines: 0, validLines: 0, invalidLines: 0, skippedLines: 0,
    botRequests: 0, googlebotRequests: 0, aiBotRequests: 0,
    startDate: null, endDate: null,
    statusDistribution: {}, botDistribution: {}, hourlyBotHits: new Array(24).fill(0),
    aiReferrals: {}, crawledParameters: {},
    responseTime: { p50: null, p90: null, p99: null, samples: 0 },
    errorSamples: [], aggregatesTruncated: false, cancelled: false
  };
  const agg = new Map<string, LogAggregateRow>();
  const hist = new Array(LATENCY_BUCKETS.length).fill(0);
  let minTs = Infinity;
  let maxTs = -Infinity;

  for await (const line of rl) {
    if (options.signal?.aborted) {
      res.cancelled = true;
      break;
    }
    res.totalLines++;
    if (!line.trim()) {
      res.skippedLines++;
      continue;
    }

    const e = parseLogLine(line, salt, options.customSensitiveParams);
    if (!e) {
      res.invalidLines++;
      if (res.errorSamples.length < 20) res.errorSamples.push(redactSample(line));
      continue;
    }
    res.validLines++;

    const ts = e.timestamp.getTime();
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
    res.statusDistribution[e.statusCode] = (res.statusDistribution[e.statusCode] ?? 0) + 1;

    if (e.responseTimeMs !== null) {
      let i = 0;
      while (e.responseTimeMs > LATENCY_BUCKETS[i]) i++;
      hist[i]++;
      res.responseTime.samples++;
    }

    const aiRef = identifyAiReferrer(e.referer);
    if (aiRef) res.aiReferrals[aiRef] = (res.aiReferrals[aiRef] ?? 0) + 1;

    if (e.isBot) {
      res.botRequests++;
      res.botDistribution[e.botName] = (res.botDistribution[e.botName] ?? 0) + 1;
      res.hourlyBotHits[e.timestamp.getUTCHours()]++;
      if (isGooglebot(e.botName)) res.googlebotRequests++;
      if (isAiBot(e.botCategory)) res.aiBotRequests++;
      if (e.query) {
        for (const key of new URLSearchParams(e.query.slice(1)).keys()) {
          if (key in res.crawledParameters || Object.keys(res.crawledParameters).length < MAX_PARAM_KEYS) {
            res.crawledParameters[key] = (res.crawledParameters[key] ?? 0) + 1;
          }
        }
      }
    }

    // Per-path detail only for bot traffic; human traffic is folded per status.
    const day = e.timestamp.toISOString().slice(0, 10);
    let path = e.isBot ? e.url : '*';
    let key = `${day}\u0000${e.botName}\u0000${e.statusCode}\u0000${path}`;
    let row = agg.get(key);
    if (!row && agg.size >= MAX_AGGREGATE_KEYS) {
      res.aggregatesTruncated = true;
      path = '(other)';
      key = `${day}\u0000${e.botName}\u0000${e.statusCode}\u0000${path}`;
      row = agg.get(key);
    }
    if (!row) {
      // V8 substrings keep their parent chunk (~64 KB) alive. Copy anything we retain.
      row = { date: day, botName: e.botName, botCategory: e.botCategory, statusCode: e.statusCode, path: detach(path), hits: 0, bytes: 0, durationSumMs: 0, durationCount: 0 };
      agg.set(detach(key), row);
    }
    row.hits++;
    row.bytes += e.bytes;
    if (e.responseTimeMs !== null) {
      row.durationSumMs += e.responseTimeMs;
      row.durationCount++;
    }

    if (options.onProgress && res.totalLines % 50_000 === 0) options.onProgress(res.totalLines);
    if (options.maxLines && res.totalLines >= options.maxLines) break;
  }

  const n = res.responseTime.samples;
  res.responseTime.p50 = percentileFromHistogram(hist, n, 0.5);
  res.responseTime.p90 = percentileFromHistogram(hist, n, 0.9);
  res.responseTime.p99 = percentileFromHistogram(hist, n, 0.99);
  res.startDate = Number.isFinite(minTs) ? new Date(minTs) : null;
  res.endDate = Number.isFinite(maxTs) ? new Date(maxTs) : null;

  return { ...res, aggregates: [...agg.values()] };
}

async function readMagic(filePath: string): Promise<Buffer> {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    await fh.read(buf, 0, 2, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

export interface FileAnalysisOptions extends ParseOptions {
  /** Max decompressed bytes accepted from a .gz file (zip-bomb guard). */
  maxDecompressedBytes?: number;
}

/**
 * Streams a .log/.txt/.gz file. Gzip is detected by magic bytes, not by extension.
 * The SHA-256 checksum is computed over the raw file bytes in the same pass.
 */
export async function analyzeLogFile(filePath: string, options: FileAnalysisOptions = {}): Promise<LogAnalysis> {
  const magic = await readMagic(filePath);
  const isGzip = magic[0] === 0x1f && magic[1] === 0x8b;
  const hash = crypto.createHash('sha256');
  const raw = fs.createReadStream(filePath);
  raw.on('data', chunk => hash.update(chunk));

  let input: Readable = raw;
  if (isGzip) {
    const limit = options.maxDecompressedBytes ?? 5 * 1024 ** 3;
    let seen = 0;
    const gunzip = zlib.createGunzip();
    gunzip.on('data', (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > limit) gunzip.destroy(new Error(`Decompressed size exceeds limit of ${limit} bytes`));
    });
    raw.on('error', err => gunzip.destroy(err));
    input = raw.pipe(gunzip);
  }

  const result = await analyzeLogStream(input, options);
  // Parsing may stop early (maxLines/cancel); drain the raw stream so the checksum covers the whole file.
  if (!raw.readableEnded) {
    raw.unpipe();
    raw.resume();
    await new Promise<void>((resolve, reject) => {
      raw.once('end', resolve);
      raw.once('close', resolve);
      raw.once('error', reject);
    });
  }
  return { ...result, checksum: hash.digest('hex') };
}

/** @deprecated kept for backwards compatibility with the CLI; use analyzeLogFile. */
export const processLogStream = analyzeLogFile;
