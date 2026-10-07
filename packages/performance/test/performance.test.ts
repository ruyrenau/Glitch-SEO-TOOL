import { describe, it, expect } from 'vitest';
import { parseLab, parseDiagnostics, parseResources, parseField, rate, runLighthouseLocal, findBrowser, Lhr } from '@glitch/performance';
import { sampleLhr, sampleCrux, startFixtureSite } from '@glitch/testing';

describe('ratings', () => {
  it('uses the published thresholds', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 2501)).toBe('needs-improvement');
    expect(rate('LCP', 4001)).toBe('poor');
    expect(rate('INP', 199)).toBe('good');
    expect(rate('CLS', 0.26)).toBe('poor');
    expect(rate('TBT', null)).toBeNull();
  });
});

describe('Lighthouse result parsing', () => {
  const lhr = sampleLhr('https://example.com/') as unknown as Lhr;
  it('extracts lab metrics and score', () => {
    expect(parseLab(lhr)).toEqual({ performanceScore: 62, LCP: 3900, CLS: 0.18, TBT: 450, FCP: 2100, SI: 4200, TTFB: 620 });
  });
  it('lists failing diagnostics first, with savings and item counts', () => {
    const d = parseDiagnostics(lhr);
    expect(d[0]).toMatchObject({ id: 'render-blocking-resources', score: 0, savingsMs: 900, items: 3 });
    expect(d.find(x => x.id === 'unsized-images')?.items).toBe(2);
    expect(d.at(-1)?.score).toBe(1);
  });
  it('counts weight and requests', () => {
    expect(parseResources(lhr)).toEqual({ totalBytes: 2_400_000, requests: 57 });
  });
});

describe('CrUX field data parsing', () => {
  it('reads p75, converts CLS from x100 and keeps distributions', () => {
    const f = parseField(sampleCrux, sampleCrux)!;
    expect(f.scope).toBe('url');
    expect(f.metrics.CLS).toEqual({ p75: 0.12, rating: 'needs-improvement', distribution: [0.7, 0.2, 0.1] });
    expect(f.metrics.INP?.rating).toBe('good');
    expect(f.metrics.TTFB?.p75).toBe(900);
    expect(f.collectionPeriod).toEqual({ firstDate: '2026-09-08', lastDate: '2026-10-05' });
  });
  it('falls back to origin data and says so', () => {
    expect(parseField({ ...sampleCrux, origin_fallback: true }, sampleCrux)!.scope).toBe('origin');
    expect(parseField(undefined, sampleCrux)!.scope).toBe('origin');
  });
  it('returns null when there is not enough traffic', () => {
    expect(parseField(undefined, undefined)).toBeNull();
    expect(parseField({ id: 'x' }, { id: 'y', metrics: {} })).toBeNull();
  });
});

describe.skipIf(!findBrowser())('local Lighthouse (real browser)', () => {
  it('measures a page and reports lab data only', async () => {
    const site = await startFixtureSite();
    try {
      const r = await runLighthouseLocal(`${site.origin}/about`, { strategy: 'desktop', allowHosts: ['127.0.0.1'] });
      expect(r.source).toBe('lighthouse-local');
      expect(r.field).toBeNull();
      expect(r.fieldStatus).toBe('not-requested');
      expect(r.lab.performanceScore).toBeGreaterThan(0);
      expect(r.lab.LCP).toBeGreaterThan(0);
      expect(r.resources.requests).toBeGreaterThanOrEqual(1);
    } finally {
      await site.close();
    }
  }, 120_000);

  it('refuses private targets without the allowlist', async () => {
    await expect(runLighthouseLocal('http://127.0.0.1:9/', { strategy: 'mobile' })).rejects.toThrow(/Blocked private/);
  });
});
