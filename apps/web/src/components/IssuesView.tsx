'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import type { Issue } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

const SEV_TONE = { CRITICAL: 'bad', HIGH: 'bad', MEDIUM: 'warn', LOW: 'default', INFO: 'default' } as const;
const SEV_LABEL = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', INFO: 'Info' } as const;
const STATUS_LABEL = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', ignored: 'Ignorado' } as const;

export function IssuesView({ siteId, go }: { siteId: string; go: (nav: string) => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | Issue['status'] | 'all'>('active');
  const [sev, setSev] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      setIssues(await apiGet<Issue[]>(`/api/v1/sites/${siteId}/issues`));
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => {
    setIssues(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const visible = useMemo(
    () =>
      (issues ?? []).filter(
        i =>
          (statusFilter === 'all' || (statusFilter === 'active' ? i.status === 'open' || i.status === 'in_progress' : i.status === statusFilter)) &&
          (!sev || i.severity === sev)
      ),
    [issues, statusFilter, sev]
  );

  const setStatus = async (i: Issue, status: Issue['status']) => {
    try {
      await apiSend('POST', `/api/v1/issues/${i.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  if (error && !issues) return <ErrorBox error={error} />;
  if (!issues) return <Skeleton rows={6} />;
  if (!issues.length)
    return (
      <Empty>
        No hay issues todavía. <button className="underline font-semibold" onClick={() => go('crawler')}>Ejecuta un crawl</button> para auditar el sitio.
      </Empty>
    );

  const active = issues.filter(i => i.status === 'open' || i.status === 'in_progress');
  const count = (s: Issue['severity']) => active.filter(i => i.severity === s).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Tipos de issue activos" value={fmt(active.length)} />
        <Kpi label="Críticos" value={fmt(count('CRITICAL'))} tone={count('CRITICAL') ? 'bad' : 'default'} />
        <Kpi label="Altos" value={fmt(count('HIGH'))} tone={count('HIGH') ? 'warn' : 'default'} />
        <Kpi label="URLs afectadas (suma)" value={fmt(active.reduce((a, i) => a + i.affectedUrlsCount, 0))} hint="Una URL puede contar en varios issues" />
      </div>

      <Card
        title="Issues técnicos"
        actions={
          <>
            <label className="text-xs">
              <select aria-label="Estado" className={inputCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="active">Activos</option><option value="open">Abiertos</option><option value="in_progress">En progreso</option><option value="resolved">Resueltos</option><option value="ignored">Ignorados</option><option value="all">Todos</option>
              </select>
            </label>
            <label className="text-xs">
              <select aria-label="Severidad" className={inputCls} value={sev} onChange={e => setSev(e.target.value)}>
                <option value="">Toda severidad</option>
                {Object.entries(SEV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </>
        }
      >
        <p className="text-[11px] text-slate-500 mb-3">
          Orden: primero severidad, luego prioridad. Prioridad = impacto × confianza × factor de URLs afectadas × peso de severidad ÷ (esfuerzo × riesgo), × 10. Es una heurística para ordenar trabajo, no una medida de tráfico perdido.
        </p>
        <ErrorBox error={error} />
        {!visible.length ? (
          <Empty>Ningún issue con este filtro.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map(i => {
              const expanded = open === i.id;
              return (
                <li key={i.id} className="py-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <button className="flex-1 flex items-start gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i.id)}>
                      {expanded ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
                      <span className="space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={SEV_TONE[i.severity]}>{SEV_LABEL[i.severity]}</Badge>
                          <span className="font-semibold text-sm">{i.title}</span>
                          <span className="font-mono text-[10px] text-slate-500">{i.code}</span>
                        </span>
                        <span className="block text-xs text-slate-500">{fmt(i.affectedUrlsCount)} URLs · {i.category} · {STATUS_LABEL[i.status]}</span>
                      </span>
                    </button>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-lg font-black tabular-nums text-indigo-600 dark:text-indigo-400">{i.priorityScore}</div>
                        <div className="text-[10px] text-slate-500">prioridad</div>
                      </div>
                      <label className="text-xs">
                        <select aria-label={`Cambiar estado de ${i.title}`} className={inputCls} value={i.status} onChange={e => setStatus(i, e.target.value as Issue['status'])}>
                          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3 ml-6 space-y-3 text-xs">
                      <p>{i.description}</p>
                      <p><strong>Recomendación:</strong> {i.recommendation}</p>
                      <p className="text-slate-500">
                        Impacto {i.impact}/10 · esfuerzo {i.effort}/10 · riesgo {i.risk}/10 · confianza {Math.round(i.confidence * 100)}% · detectado {fmtDate(i.createdAt)} · visto por última vez {fmtDate(i.lastSeenAt)}
                      </p>
                      {i.affectedUrls && (
                        <div>
                          <h4 className="font-semibold mb-1">URLs afectadas{i.affectedUrlsCount > i.affectedUrls.length ? ` (primeras ${i.affectedUrls.length} de ${fmt(i.affectedUrlsCount)})` : ''}</h4>
                          <ul className="font-mono text-[11px] max-h-48 overflow-auto bg-slate-50 dark:bg-slate-900 rounded p-2 space-y-0.5">
                            {i.affectedUrls.map(u => <li key={u} className="break-all">{u}</li>)}
                          </ul>
                        </div>
                      )}
                      {i.evidence && (
                        <details>
                          <summary className="cursor-pointer font-semibold">Evidencia</summary>
                          <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-64 overflow-auto">{JSON.stringify(i.evidence, null, 2)}</pre>
                        </details>
                      )}
                      <Button variant="secondary" onClick={() => setOpen(null)}>Cerrar</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
