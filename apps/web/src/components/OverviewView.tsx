'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, fmt, fmtDate } from '@/lib/api';
import type { SiteOverview } from '@/lib/types';
import { Badge, Card, Empty, ErrorBox, Kpi, Skeleton, Button } from './ui';
import { ALERT_LABEL } from './AlertsView';

export function OverviewView({ siteId, go }: { siteId: string; go: (nav: string) => void }) {
  const [data, setData] = useState<SiteOverview | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiGet<SiteOverview>(`/api/v1/sites/${siteId}/overview`).then(setData).catch(setError);
  }, [siteId]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Skeleton rows={4} />;
  const logs = data.logs;
  const issues = Object.values(data.openIssuesBySeverity).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {data.site.isDemo && (
        <p className="text-xs text-fuchsia-700 dark:text-fuchsia-300">
          <Badge tone="demo">DEMO</Badge> Sitio de demostración con datos sintéticos, procesados con los mismos pipelines que los datos reales.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Solicitudes en el último log" value={fmt(logs?.requests)} hint={logs ? `${fmtDate(logs.period.start)} → ${fmtDate(logs.period.end)}` : 'Sin logs importados'} />
        <Kpi label="Hits de Googlebot" value={fmt(logs?.googlebotRequests)} tone="brand" hint="Todas las variantes (smartphone, desktop, image…)" />
        <Kpi label="Hits de bots de IA" value={fmt(logs?.aiBotRequests)} tone="brand" hint="GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User…" />
        <Kpi label="URLs de sitemap cargadas" value={fmt(data.sitemapUrls)} hint={`${data.importCount} importaciones de logs`} />
      </div>

      {data.openAlerts.length > 0 && (
        <Card title={`Alertas abiertas (${data.openAlertsCount})`} actions={<Button variant="secondary" onClick={() => go('alerts')}>Ver alertas</Button>}>
          <ul className="space-y-2 text-xs">
            {data.openAlerts.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={a.severity === 'CRITICAL' || a.severity === 'HIGH' ? 'bad' : 'warn'}>{ALERT_LABEL[a.type] ?? a.type}</Badge>
                <span>{a.message}</span>
                <span className="text-slate-500">· {fmtDate(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Siguientes pasos">
          <ul className="space-y-2 text-xs">
            <li className="flex justify-between items-center gap-2">
              <span>{logs ? `Último log: ${logs.fileName}` : 'Importa un log de Nginx o Apache (.log, .txt o .gz).'}</span>
              <Button variant="secondary" onClick={() => go('logs')}>Ir a logs</Button>
            </li>
            <li className="flex justify-between items-center gap-2">
              <span>{data.sitemapUrls ? `${fmt(data.sitemapUrls)} URLs de sitemap para cruzar con logs.` : 'Carga el sitemap para detectar URLs nunca rastreadas.'}</span>
              <Button variant="secondary" onClick={() => go('logs')}>Cargar sitemap</Button>
            </li>
            <li className="flex justify-between items-center gap-2">
              <span>{issues ? `${fmt(issues)} tipos de issue abiertos${data.openIssuesBySeverity.CRITICAL ? `, ${data.openIssuesBySeverity.CRITICAL} críticos` : ''}.` : 'Sin issues: ejecuta un crawl para auditar el sitio.'}</span>
              <Button variant="secondary" onClick={() => go(issues ? 'issues' : 'crawler')}>{issues ? 'Ver issues' : 'Ir a crawl'}</Button>
            </li>
          </ul>
        </Card>

        <Card title="Actividad reciente" actions={<Button variant="secondary" onClick={() => go('audit')}>Audit log</Button>}>
          {data.recentEvents.length ? (
            <ul className="space-y-2 text-xs">
              {data.recentEvents.map(e => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span className="font-mono">{e.action}</span>
                  <span className="text-slate-500 shrink-0">{fmtDate(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Sin eventos todavía.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
