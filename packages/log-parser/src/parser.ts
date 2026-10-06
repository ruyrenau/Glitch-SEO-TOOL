import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import { anonymizeIp, sanitizeQueryString } from '@glitch/core';
import { identifyBot } from './bots';

export interface ParsedLogEntry {
  ipHash: string;
  timestamp: Date;
  method: string;
  url: string;
  path: string;
  statusCode: number;
  bytes: number;
  referer: string;
  userAgent: string;
  responseTimeMs: number;
  botName: string;
  botCategory: string;
  isBot: boolean;
}

export interface ParseOptions {
  salt?: string;
  format?: 'nginx_combined' | 'apache_combined';
  onProgress?: (linesProcessed: number) => void;
  maxLines?: number;
}

// Standard Combined regex: IP - - [date] "METHOD URL PROTOCOL" STATUS BYTES "REFERER" "UA" (optional duration)
const COMBINED_LOG_REGEX = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^ "]+)?[^"]*" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?(?: (\d+(?:\.\d+)?))?/;

export function parseLogLine(line: string, salt = 'glitch-salt'): ParsedLogEntry | null {
  const match = line.match(COMBINED_LOG_REGEX);
  if (!match) return null;

  const rawIp = match[1];
  const dateStr = match[2];
  const method = match[3];
  const fullUrl = match[4] || '/';
  const statusCode = parseInt(match[5], 10);
  const bytes = match[6] === '-' ? 0 : parseInt(match[6], 10);
  const referer = match[7] || '';
  const userAgent = match[8] || '';
  const responseTimeSec = match[9] ? parseFloat(match[9]) : 0;

  // Split path & query
  const [pathPart, queryPart] = fullUrl.split('?');
  const sanitizedQuery = queryPart ? sanitizeQueryString('?' + queryPart) : '';
  const cleanUrl = pathPart + sanitizedQuery;

  const bot = identifyBot(userAgent);

  return {
    ipHash: anonymizeIp(rawIp, salt),
    timestamp: new Date(dateStr.replace(':', ' ')),
    method,
    url: cleanUrl,
    path: pathPart,
    statusCode,
    bytes,
    referer,
    userAgent,
    responseTimeMs: Math.round(responseTimeSec * 1000),
    botName: bot.name,
    botCategory: bot.category,
    isBot: bot.isBot
  };
}

export async function processLogStream(
  filePath: string,
  options: ParseOptions = {}
): Promise<{
  totalLines: number;
  validLines: number;
  invalidLines: number;
  botRequests: number;
  statusDistribution: Record<number, number>;
  botDistribution: Record<string, number>;
  sampleEntries: ParsedLogEntry[];
}> {
  const salt = options.salt || 'glitch-salt';
  let inputStream: NodeJS.ReadableStream = fs.createReadStream(filePath);

  if (filePath.endsWith('.gz')) {
    inputStream = inputStream.pipe(zlib.createGunzip());
  }

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });

  let totalLines = 0;
  let validLines = 0;
  let invalidLines = 0;
  let botRequests = 0;
  const statusDistribution: Record<number, number> = {};
  const botDistribution: Record<string, number> = {};
  const sampleEntries: ParsedLogEntry[] = [];

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;

    const parsed = parseLogLine(line, salt);
    if (!parsed) {
      invalidLines++;
      continue;
    }

    validLines++;
    statusDistribution[parsed.statusCode] = (statusDistribution[parsed.statusCode] || 0) + 1;

    if (parsed.isBot) {
      botRequests++;
      botDistribution[parsed.botName] = (botDistribution[parsed.botName] || 0) + 1;
    }

    if (sampleEntries.length < 50) {
      sampleEntries.push(parsed);
    }

    if (options.onProgress && totalLines % 50000 === 0) {
      options.onProgress(totalLines);
    }

    if (options.maxLines && totalLines >= options.maxLines) {
      break;
    }
  }

  return {
    totalLines,
    validLines,
    invalidLines,
    botRequests,
    statusDistribution,
    botDistribution,
    sampleEntries
  };
}
