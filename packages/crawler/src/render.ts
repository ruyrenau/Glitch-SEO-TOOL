import fs from 'fs';
import { assertSafeUrl } from './ssrf';

const CANDIDATE_BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter((p): p is string => !!p);

/** Installed Chrome/Chromium/Edge (CHROME_PATH overrides). */
export function findBrowser(): string | null {
  return CANDIDATE_BROWSERS.find(p => fs.existsSync(p)) ?? null;
}

export class RenderError extends Error {
  constructor(public code: 'BROWSER_NOT_FOUND' | 'RENDER_FAILED', message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export interface RenderResult {
  html: string;
  finalUrl: string;
  ms: number;
  /** Uncaught exceptions and console errors raised by the page's JavaScript. */
  jsErrors: string[];
  /** Subresource requests refused by the SSRF guard. */
  blockedRequests: number;
}

export interface Renderer {
  render(url: string): Promise<RenderResult>;
  close(): Promise<void>;
}

/**
 * Headless Chrome/Edge renderer for JavaScript sites.
 * Every request the page makes goes through the SSRF guard; images, media and fonts are not loaded
 * (they do not change the DOM and are checked separately as resources).
 */
export async function createRenderer(opts: { userAgent: string; timeoutMs: number; allowHosts?: string[]; concurrency?: number }): Promise<Renderer> {
  const executablePath = findBrowser();
  if (!executablePath) throw new RenderError('BROWSER_NOT_FOUND', 'Para ejecutar JavaScript se necesita Chrome, Chromium o Edge instalado (o CHROME_PATH).');
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-dev-shm-usage'] });
  const safeHosts = new Map<string, Promise<boolean>>();
  const isSafe = (u: string) => {
    let host: string;
    try {
      const x = new URL(u);
      if (x.protocol === 'data:' || x.protocol === 'blob:') return Promise.resolve(true);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return Promise.resolve(false);
      host = x.host;
    } catch {
      return Promise.resolve(false);
    }
    if (!safeHosts.has(host)) safeHosts.set(host, assertSafeUrl(u, { allowHosts: opts.allowHosts }).then(() => true, () => false));
    return safeHosts.get(host)!;
  };

  // Simple semaphore: rendering is far heavier than fetching.
  const max = Math.max(1, Math.min(opts.concurrency ?? 2, 4));
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = () => (active < max ? (active++, Promise.resolve()) : new Promise<void>(r => waiters.push(() => (active++, r()))));
  const release = () => {
    active--;
    waiters.shift()?.();
  };

  return {
    async render(url) {
      await acquire();
      const t0 = Date.now();
      const page = await browser.newPage();
      const jsErrors: string[] = [];
      let blockedRequests = 0;
      try {
        await page.setUserAgent(opts.userAgent);
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (type === 'image' || type === 'media' || type === 'font') return void req.abort().catch(() => undefined);
          isSafe(req.url()).then(ok => {
            if (!ok) blockedRequests++;
            return ok ? req.continue() : req.abort('blockedbyclient');
          }).catch(() => undefined);
        });
        page.on('pageerror', e => jsErrors.length < 20 && jsErrors.push(String((e as Error).message ?? e).slice(0, 300)));
        page.on('console', m => m.type() === 'error' && jsErrors.length < 20 && jsErrors.push(m.text().slice(0, 300)));
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs });
        } catch (e) {
          // Pages that never go idle (polling, analytics) still have a usable DOM.
          if (!/timeout/i.test((e as Error).message)) throw e;
        }
        return { html: await page.content(), finalUrl: page.url(), ms: Date.now() - t0, jsErrors, blockedRequests };
      } catch (e) {
        throw new RenderError('RENDER_FAILED', (e as Error).message);
      } finally {
        await page.close().catch(() => undefined);
        release();
      }
    },
    close: () => browser.close().catch(() => undefined)
  };
}
