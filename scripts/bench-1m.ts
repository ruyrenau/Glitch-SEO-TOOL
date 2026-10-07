/**
 * Streams N synthetic log lines (default 1,000,000) through the parser and
 * reports throughput and peak memory. Usage: pnpm bench:logs [lines]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeSyntheticLog, analyzeLogFile } from '../packages/log-parser/src';

async function main() {
  const lines = Number(process.argv[2] ?? 1_000_000);
  const file = path.join(os.tmpdir(), `glitch-bench-${lines}.log`);
  if (!fs.existsSync(file)) {
    console.log(`Generating ${lines.toLocaleString()} synthetic lines...`);
    await writeSyntheticLog(file, lines, { seed: 99, days: 30 });
  }
  const sizeMb = fs.statSync(file).size / 1024 ** 2;

  global.gc?.();
  const baseline = process.memoryUsage();
  let peakRss = baseline.rss;
  let peakHeap = baseline.heapUsed;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  }, 50);

  const t0 = performance.now();
  const r = await analyzeLogFile(file);
  const secs = (performance.now() - t0) / 1000;
  clearInterval(sampler);

  const mb = (b: number) => `${(b / 1024 ** 2).toFixed(0)} MB`;
  console.table({
    lines: r.totalLines,
    fileSize: `${sizeMb.toFixed(0)} MB`,
    seconds: secs.toFixed(1),
    linesPerSecond: Math.round(r.totalLines / secs),
    aggregateRows: r.aggregates.length,
    baselineHeap: mb(baseline.heapUsed),
    peakHeap: mb(peakHeap),
    peakRss: mb(peakRss)
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
