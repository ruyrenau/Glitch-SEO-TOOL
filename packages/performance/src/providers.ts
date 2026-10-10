import { assertSafeUrl, findBrowser } from '@glitch/crawler';
import { PerformanceResult } from './metrics';
import { Lhr, parseLab, parseDiagnostics, parseResources, parseField, parseReport, CruxExperience } from './parse';

export class PerformanceError extends Error {
  constructor(public code: 'QUOTA' | 'BROWSER_NOT_FOUND' | 'PSI_ERROR' | 'LIGHTHOUSE_ERROR' | 'BLOCKED_URL', message: string) {
    super(message);
    this.name = 'PerformanceError';
  }
}

export { findBrowser };

export interface RunOptions {
  strategy: 'mobile' | 'desktop';
  allowHosts?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Lab data only: Lighthouse in a local headless Chrome/Edge (CHROME_PATH to override).
 * The URL is SSRF-checked first; subresources are loaded by the browser as on any visit.
 */
export async function runLighthouseLocal(url: string, opts: RunOptions): Promise<PerformanceResult> {
  try {
    await assertSafeUrl(url, { allowHosts: opts.allowHosts });
  } catch (e) {
    throw new PerformanceError('BLOCKED_URL', (e as Error).message);
  }
  const chromePath = findBrowser();
  if (!chromePath) throw new PerformanceError('BROWSER_NOT_FOUND', 'No Chrome/Chromium/Edge found. Install one or set CHROME_PATH.');
  // Both packages are ESM-only.
  const { launch } = await import('chrome-launcher');
  const lighthouse = (await import('lighthouse')).default;
  const chrome = await launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run'] });
  const kill = () => chrome.kill();
  opts.signal?.addEventListener('abort', kill, { once: true });
  try {
    const desktop = opts.strategy === 'desktop';
    const run = lighthouse(
      url,
      { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'], locale: (process.env.LIGHTHOUSE_LOCALE ?? 'es') as 'es' },
      desktop
        ? {
            extends: 'lighthouse:default',
            settings: {
              formFactor: 'desktop',
              screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
              throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
              emulatedUserAgent: undefined
            }
          }
        : undefined
    );
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new PerformanceError('LIGHTHOUSE_ERROR', 'Lighthouse timed out')), opts.timeoutMs ?? 120_000));
    const res = await Promise.race([run, timeout]);
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const lhr = res?.lhr as unknown as Lhr | undefined;
    if (!lhr) throw new PerformanceError('LIGHTHOUSE_ERROR', 'Lighthouse returned no result');
    const runtimeError = (res!.lhr as unknown as { runtimeError?: { message: string } }).runtimeError;
    if (runtimeError) throw new PerformanceError('LIGHTHOUSE_ERROR', runtimeError.message);
    return {
      source: 'lighthouse-local',
      strategy: opts.strategy,
      finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? url,
      lab: parseLab(lhr),
      field: null,
      fieldStatus: 'not-requested',
      diagnostics: parseDiagnostics(lhr),
      resources: parseResources(lhr),
      report: parseReport(lhr),
      lighthouseVersion: lhr.lighthouseVersion,
      fetchedAt: new Date().toISOString()
    };
  } finally {
    opts.signal?.removeEventListener('abort', kill);
    kill();
  }
}

/** PageSpeed Insights: Google's lab run plus CrUX field data. Requires PSI_API_KEY in practice. */
export async function runPsi(url: string, opts: RunOptions & { apiKey: string; endpoint?: string }): Promise<PerformanceResult> {
  const endpoint = opts.endpoint ?? process.env.PSI_API_URL ?? 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const qs = new URLSearchParams({ url, strategy: opts.strategy, category: 'performance', locale: process.env.LIGHTHOUSE_LOCALE ?? 'es', key: opts.apiKey });
  const res = await fetch(`${endpoint}?${qs}`, { signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 120_000), ...(opts.signal ? [opts.signal] : [])]) });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string }; lighthouseResult?: Lhr; loadingExperience?: CruxExperience; originLoadingExperience?: CruxExperience; analysisUTCTimestamp?: string } | null;
  if (res.status === 429) throw new PerformanceError('QUOTA', 'PageSpeed Insights quota exceeded for this API key; try later.');
  if (!res.ok || !body?.lighthouseResult) throw new PerformanceError('PSI_ERROR', body?.error?.message ?? `PageSpeed Insights answered HTTP ${res.status}`);
  const lhr = body.lighthouseResult;
  const field = parseField(body.loadingExperience, body.originLoadingExperience);
  return {
    source: 'psi',
    strategy: opts.strategy,
    finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? url,
    lab: parseLab(lhr),
    field,
    fieldStatus: field ? 'available' : 'insufficient-data',
    diagnostics: parseDiagnostics(lhr),
    resources: parseResources(lhr),
    report: parseReport(lhr),
    lighthouseVersion: lhr.lighthouseVersion,
    fetchedAt: body.analysisUTCTimestamp ?? new Date().toISOString()
  };
}

/** Hosts Google's servers cannot reach (this machine or a private network): always measured locally. */
export function isLocalHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.local') || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || (h.includes(":") && /^(fc|fd)/i.test(h));
  } catch {
    return false;
  }
}

/** PSI when a key is configured (lab + field), otherwise local Lighthouse (lab only). Local hosts always run locally. */
export async function measure(url: string, opts: RunOptions & { apiKey?: string | null }): Promise<PerformanceResult> {
  const key = opts.apiKey ?? process.env.PSI_API_KEY;
  if (key && !isLocalHost(url)) return runPsi(url, { ...opts, apiKey: key });
  return runLighthouseLocal(url, opts);
}
