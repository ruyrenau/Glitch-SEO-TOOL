import http from 'http';
import type { AddressInfo } from 'net';

/**
 * CrUX History API stand-in. Origins get 10 weekly points where LCP improves over time;
 * URLs containing "nodata" answer 404 (not enough traffic); a key "disabled" answers 403
 * like a Google Cloud project without the API enabled.
 */
export async function startMockCrux() {
  const requests: Array<{ url?: string; origin?: string; formFactor?: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      const q = JSON.parse(body || '{}');
      requests.push(q);
      res.setHeader('content-type', 'application/json');
      if (u.searchParams.get('key') === 'disabled') {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: { code: 403, message: 'Chrome UX Report API has not been used in project 123 before or it is disabled.' } }));
      }
      if (String(q.url ?? '').includes('nodata')) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { code: 404, message: 'chrome ux report data not found' } }));
      }
      const n = 10;
      const periods = Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(2026, 7, 2 + i * 7));
        const p = (x: Date) => ({ year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() });
        return { firstDate: p(new Date(d.getTime() - 27 * 864e5)), lastDate: p(d) };
      });
      const series = (start: number, step: number) => Array.from({ length: n }, (_, i) => start + step * i);
      const hist = (good: number[]) => [{ start: 0, end: 1, densities: good }, { start: 1, end: 2, densities: good.map(g => Number(((1 - g) * 0.6).toFixed(3))) }, { start: 2, densities: good.map(g => Number(((1 - g) * 0.4).toFixed(3))) }];
      const lcp = q.url ? series(3600, -150) : series(3000, -60);
      res.end(
        JSON.stringify({
          record: {
            key: q.url ? { url: q.url, formFactor: q.formFactor } : { origin: q.origin, formFactor: q.formFactor },
            metrics: {
              largest_contentful_paint: { histogramTimeseries: hist(lcp.map(v => Number(Math.min(0.95, 2500 / v - 0.1).toFixed(3)))), percentilesTimeseries: { p75s: lcp } },
              interaction_to_next_paint: { histogramTimeseries: hist(series(0.8, 0)), percentilesTimeseries: { p75s: [...series(180, 0).slice(0, n - 1), 'NaN'] } },
              cumulative_layout_shift: { histogramTimeseries: hist(series(0.7, 0.01)), percentilesTimeseries: { p75s: series(0.14, -0.005).map(v => v.toFixed(2)) } },
              first_contentful_paint: { percentilesTimeseries: { p75s: series(1900, -20) } },
              experimental_time_to_first_byte: { percentilesTimeseries: { p75s: series(900, 0) } }
            },
            collectionPeriods: periods
          }
        })
      );
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/records:queryHistoryRecord`,
    requests,
    close: () => new Promise<void>(r => server.close(() => r()))
  };
}
