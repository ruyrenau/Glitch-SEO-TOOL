export interface GscMetricRow {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export class GoogleSearchConsoleClient {
  constructor(private propertyUrl: string, private isDemo: boolean = true) {}

  async getSearchAnalytics(): Promise<GscMetricRow[]> {
    if (this.isDemo) {
      return [
        { date: '2026-10-01', query: 'seo audit automation', page: '/features/audit', clicks: 240, impressions: 3200, ctr: 0.075, position: 3.2 },
        { date: '2026-10-02', query: 'server log analyzer', page: '/features/logs', clicks: 195, impressions: 2800, ctr: 0.069, position: 4.1 },
        { date: '2026-10-03', query: 'programmatic seo templates', page: '/features/programmatic', clicks: 310, impressions: 4500, ctr: 0.068, position: 2.8 },
        { date: '2026-10-04', query: 'json-ld generator api', page: '/features/schema', clicks: 140, impressions: 1900, ctr: 0.073, position: 5.4 }
      ];
    }
    return [];
  }
}
