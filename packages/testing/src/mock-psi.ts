import http from 'http';
import type { AddressInfo } from 'net';

/** A trimmed but structurally real Lighthouse result. */
export function sampleLhr(url: string, overrides: { score?: number; lcp?: number } = {}) {
  const audit = (id: string, numericValue: number, score: number, extra: Record<string, unknown> = {}) => ({ id, title: id, numericValue, score, displayValue: String(numericValue), ...extra });
  return {
    lighthouseVersion: '12.8.2',
    finalDisplayedUrl: url,
    categories: { performance: { score: overrides.score ?? 0.62 } },
    audits: {
      'largest-contentful-paint': audit('largest-contentful-paint', overrides.lcp ?? 3900, 0.3),
      'cumulative-layout-shift': audit('cumulative-layout-shift', 0.18, 0.4),
      'total-blocking-time': audit('total-blocking-time', 450, 0.4),
      'first-contentful-paint': audit('first-contentful-paint', 2100, 0.6),
      'speed-index': audit('speed-index', 4200, 0.5),
      'server-response-time': audit('server-response-time', 620, 1),
      'render-blocking-resources': { title: 'Eliminate render-blocking resources', score: 0, displayValue: 'Potential savings of 900 ms', details: { overallSavingsMs: 900, items: [{}, {}, {}] } },
      'unsized-images': { title: 'Image elements do not have explicit width and height', score: 0, details: { items: [{}, {}] } },
      'unused-javascript': { title: 'Reduce unused JavaScript', score: 0.5, details: { overallSavingsBytes: 180000, items: [{}] } },
      'uses-long-cache-ttl': { title: 'Serve static assets with an efficient cache policy', score: 1, details: { items: [] } },
      'total-byte-weight': audit('total-byte-weight', 2_400_000, 0.5),
      'network-requests': { title: 'Network Requests', details: { items: new Array(57).fill({}) } }
    }
  };
}

export const sampleCrux = {
  id: 'https://example.com/',
  metrics: {
    LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, distributions: [{ proportion: 0.62 }, { proportion: 0.25 }, { proportion: 0.13 }] },
    INTERACTION_TO_NEXT_PAINT: { percentile: 180, distributions: [{ proportion: 0.8 }, { proportion: 0.15 }, { proportion: 0.05 }] },
    CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, distributions: [{ proportion: 0.7 }, { proportion: 0.2 }, { proportion: 0.1 }] },
    FIRST_CONTENTFUL_PAINT_MS: { percentile: 1700 },
    EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 900 }
  },
  collectionPeriod: { firstDate: { year: 2026, month: 9, day: 8 }, lastDate: { year: 2026, month: 10, day: 5 } }
};

/**
 * PageSpeed Insights stand-in. URLs containing "quota" get 429; URLs containing "nofield"
 * return no CrUX data; others return URL-level field data.
 */
export async function startMockPsi() {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const target = u.searchParams.get('url') ?? '';
    requests.push(`${u.searchParams.get('strategy')} ${target} key=${u.searchParams.has('key')}`);
    res.setHeader('content-type', 'application/json');
    if (target.includes('quota')) {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }));
    }
    res.end(
      JSON.stringify({
        analysisUTCTimestamp: '2026-10-07T10:00:00Z',
        lighthouseResult: sampleLhr(target),
        ...(target.includes('nofield') ? {} : { loadingExperience: { ...sampleCrux, id: target }, originLoadingExperience: sampleCrux })
      })
    );
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/runPagespeed`, requests, close: () => new Promise<void>(r => server.close(() => r())) };
}
