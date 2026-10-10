import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { parseLab, parseDiagnostics, parseResources, parseField, parseReport, letterFor, rate, runLighthouseLocal, findBrowser, isLocalHost, Lhr } from '@glitch/performance';
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

describe('GTmetrix-style report (real Lighthouse 12 result)', () => {
  // Trimmed result of a real local run: a page with a render-blocking CSS and script, two unsized images (one 400 KB), no cache headers, no viewport.
  const real = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../fixtures/lhr-sample.json'), 'utf8')) as Lhr;
  const r = parseReport(real);

  it('grades like GTmetrix: 70 % performance + 30 % structure', () => {
    expect(r.grade.performance).toBe(94);
    expect(r.grade.structure).toBeGreaterThan(50);
    expect(r.grade.structure).toBeLessThan(100);
    expect(r.grade.value).toBe(Math.round(94 * 0.7 + r.grade.structure! * 0.3));
    expect(r.grade.letter).toBe(letterFor(r.grade.value));
    expect([letterFor(95), letterFor(85), letterFor(75), letterFor(65), letterFor(55), letterFor(10), letterFor(null)]).toEqual(['A', 'B', 'C', 'D', 'E', 'F', null]);
  });

  it('lists failing audits as issues with impact, affected metrics and offending items', () => {
    const ids = r.issues.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['render-blocking-resources', 'unsized-images', 'uses-long-cache-ttl']));
    expect(ids).not.toContain('largest-contentful-paint-element'); // descriptive, shown apart
    const blocking = r.issues.find(i => i.id === 'render-blocking-resources')!;
    expect(blocking.metrics).toEqual(expect.arrayContaining(['FCP', 'LCP']));
    expect(blocking.items.map(i => i.url)).toEqual(expect.arrayContaining(['https://perf.example.com/s.css', 'https://perf.example.com/a.js']));
    expect(r.issues.find(i => i.id === 'unsized-images')!.metrics).toEqual(['CLS']);
    expect(blocking.description).not.toMatch(/\]\(/); // markdown links flattened
    const rank = { Alto: 0, Medio: 1, 'Medio-bajo': 2, Bajo: 3 } as const;
    expect(r.issues.map(i => rank[i.impact])).toEqual([...r.issues.map(i => rank[i.impact])].sort((a, b) => a - b));
  });

  it('breaks page weight and requests down by type, with a waterfall and timing markers', () => {
    expect(r.breakdown[0]).toMatchObject({ group: 'IMG', requests: 2 });
    expect(r.breakdown.map(b => b.group)).toEqual(expect.arrayContaining(['HTML', 'CSS', 'JS', 'IMG']));
    expect(r.totals.requests).toBe(r.waterfall.length);
    expect(r.totals.bytes).toBe(r.breakdown.reduce((s, b) => s + b.bytes, 0));
    expect(r.waterfall[0]).toMatchObject({ url: 'https://perf.example.com/', group: 'HTML', status: 200, domain: 'perf.example.com' });
    expect(r.waterfall.every((w, i) => i === 0 || w.start >= r.waterfall[i - 1].start)).toBe(true);
    expect(r.markers.fcp).toBeGreaterThan(0);
    expect(r.totals.fullyLoadedMs).toBeGreaterThan(0);
    expect(r.lcpElement).toContain('<p>');
  });

  it('keeps the screenshot and filmstrip as image data URLs', () => {
    expect(r.screenshot).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.filmstrip.length).toBeGreaterThan(0);
    expect(r.filmstrip[0].data).toMatch(/^data:image\//);
  });

  it('degrades gracefully on a minimal result', () => {
    const m = parseReport(sampleLhr('https://example.com/') as unknown as Lhr);
    expect(m.grade.performance).toBe(62);
    expect(m.screenshot).toBeNull();
    expect(m.totals.requests).toBe(57); // the minimal sample still lists its requests
  });
});

describe('local hosts are measured locally even with a PageSpeed key', () => {
  it('recognises this machine and private networks, not public domains', () => {
    for (const u of ['http://127.0.0.1:3000/', 'http://localhost/', 'http://192.168.1.5/', 'http://10.0.0.8/', 'http://172.20.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://tienda.local/']) expect(isLocalHost(u)).toBe(true);
    for (const u of ['https://www.iexe.edu.mx/', 'http://172.32.0.1/', 'https://fdsite.com/', 'https://fc-barcelona.com/']) expect(isLocalHost(u)).toBe(false);
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
      expect(r.report.screenshot).toMatch(/^data:image\//);
      expect(r.report.waterfall.length).toBeGreaterThanOrEqual(1);
      expect(r.report.grade.letter).toMatch(/^[A-F]$/);
    } finally {
      await site.close();
    }
  }, 120_000);

  it('refuses private targets without the allowlist', async () => {
    await expect(runLighthouseLocal('http://127.0.0.1:9/', { strategy: 'mobile' })).rejects.toThrow(/Blocked private/);
  });
});
