'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import type { Alert } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton } from './ui';

export const ALERT_LABEL: Record<string, string> = {
  NOINDEX_ADDED: 'noindex añadido',
  PAGE_BROKEN: 'Páginas rotas',
  BECAME_NON_INDEXABLE: 'Dejaron de ser indexables',
  CANONICAL_CHANGED: 'Canonical cambiado',
  ROBOTS_BLOCKED_NEW: 'Nuevos bloqueos de robots.txt',
  CONTENT_SHRUNK: 'Contenido reducido',
  SCHEMA_REMOVED: 'Datos estructurados eliminados',
  MASS_TITLE_CHANGE: 'Cambio masivo de títulos',
  ROBOTS_CHANGED: 'robots.txt cambió',
  ROBOTS_UNREACHABLE: 'robots.txt inaccesible'
};
const SEV_TONE = { CRITICAL: 'bad', HIGH: 'bad', MEDIUM: 'warn', LOW: 'default', INFO: 'default' } as const;
const SEV_LABEL = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja', INFO: 'Info' } as const;

export function AlertsView({ siteId, go }: { siteId: string; go: (nav: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [status, setStatus] = useState<'open' | 'acknowledged' | ''>('open');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await apiGet<Alert[]>(`/api/v1/sites/${siteId}/alerts${status ? `?status=${status}` : ''}`));
    } catch (err) {
      setError(err);
    }
  }, [siteId, status]);
  useEffect(() => {
    setAlerts(null);
    load();
  }, [load]);

  const ack = async (a: Alert) => {
    try {
      await apiSend('POST', `/api/v1/alerts/${a.id}/acknowledge`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card
      title="Alertas por cambios entre crawls"
      actions={
        <select aria-label="Estado de la alerta" className="p-2 text-xs rounded-lg border bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
          <option value="open">Abiertas</option>
          <option value="acknowledged">Revisadas</option>
          <option value="">Todas</option>
        </select>
      }
    >
      <p className="text-[11px] text-slate-500 mb-4">
        Cada crawl completado se compara con el anterior. Solo alertan las regresiones: noindex nuevo, páginas rotas, canonicals cambiados, bloqueos nuevos de robots.txt,
        contenido reducido a menos de la mitad o schema eliminado. Si defines <code className="font-mono">ALERT_WEBHOOK_URL</code> (webhook genérico o de Slack), también se envían ahí.
      </p>
      <ErrorBox error={error} />
      {!alerts ? (
        <Skeleton rows={4} />
      ) : !alerts.length ? (
        <Empty>
          {status === 'open' ? 'Sin alertas abiertas.' : 'Sin alertas.'} Las alertas aparecen a partir del segundo crawl.{' '}
          <button className="underline font-semibold" onClick={() => go('crawler')}>Ir a crawl</button>
        </Empty>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {alerts.map(a => (
            <li key={a.id} className="py-3 space-y-2">
              <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV_TONE[a.severity]}>{SEV_LABEL[a.severity]}</Badge>
                    <span className="font-semibold text-sm">{ALERT_LABEL[a.type] ?? a.type}</span>
                    {a.status === 'acknowledged' && <Badge>revisada</Badge>}
                  </div>
                  <p className="text-xs">{a.message}</p>
                  <p className="text-[11px] text-slate-500">
                    {fmtDate(a.createdAt)}
                    {a.deliveredTo?.map(d => ` · ${d.channel}: ${d.ok ? 'enviada' : `falló (${d.error ?? d.status})`}`)}
                  </p>
                </div>
                {a.status === 'open' && (
                  <Button variant="secondary" onClick={() => ack(a)}>
                    <Check className="w-3.5 h-3.5" aria-hidden /> Marcar como revisada
                  </Button>
                )}
              </div>
              {!!a.urls?.length && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold">{a.urls.length} URL(s)</summary>
                  <ul className="mt-1 font-mono text-[11px] max-h-40 overflow-auto bg-slate-50 dark:bg-slate-900 rounded p-2">
                    {a.urls.map(u => <li key={u} className="break-all">{u}</li>)}
                  </ul>
                  {a.details && <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-48 overflow-auto">{JSON.stringify(a.details, null, 2)}</pre>}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
