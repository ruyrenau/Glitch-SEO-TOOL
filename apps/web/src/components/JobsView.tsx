'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Square, Trash2 } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { JobRow, JobStatus, Site } from '@/lib/types';
import { ACTIVE_JOB } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

const TYPE_LABEL: Record<string, string> = { 'log-import': 'Importación de log', crawl: 'Crawl', retention: 'Limpieza por retención', performance: 'Core Web Vitals' };
const STATUS: Record<JobStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'default' }> = {
  QUEUED: { label: 'En cola', tone: 'default' },
  RUNNING: { label: 'Corriendo', tone: 'warn' },
  RETRYING: { label: 'Reintentando', tone: 'warn' },
  COMPLETED: { label: 'Completado', tone: 'good' },
  FAILED: { label: 'Fallido', tone: 'bad' },
  CANCELLED: { label: 'Cancelado', tone: 'default' }
};
const TRIGGER: Record<string, string> = { manual: 'manual', schedule: 'programado', system: 'sistema' };

interface Health {
  queue?: 'ok' | 'error';
  worker?: 'ok' | 'none';
  workerSeenAt?: string | null;
}

function duration(j: JobRow) {
  if (!j.startedAt) return '—';
  const ms = new Date(j.completedAt ?? Date.now()).getTime() - new Date(j.startedAt).getTime();
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

function summary(j: JobRow): string {
  const r = j.result as Record<string, number | string> | null;
  if (j.status === 'RUNNING' || j.status === 'RETRYING') {
    if (j.type === 'crawl') return `${fmt(j.progressDetail?.crawled ?? 0)} páginas…`;
    if (j.type === 'log-import') return `${fmt(j.progressDetail?.lines ?? 0)} líneas…`;
  }
  if (!r) return j.error ?? '';
  if (j.type === 'crawl') return `${fmt(Number(r.pages))} páginas, ${fmt(Number(r.issues))} tipos de issue`;
  if (j.type === 'log-import') return `${fmt(Number(r.validLines))} líneas válidas`;
  if (j.type === 'performance') return `${fmt(Number(r.measured))} mediciones${Number(r.failed) ? `, ${fmt(Number(r.failed))} fallidas` : ''}`;
  if (j.type === 'retention') return `${fmt(Number(r.logImportsDeleted))} logs, ${fmt(Number(r.sessionsPurged))} sesiones y ${fmt(Number(r.tempFilesDeleted))} archivos eliminados`;
  return '';
}

export function JobsView({ sites }: { sites: Site[] }) {
  const { can } = useAuth();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [filter, setFilter] = useState<{ status: string; type: string }>({ status: '', type: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const siteName = (id: string | null) => (id ? sites.find(s => s.id === id)?.name ?? 'sitio eliminado' : 'Todo el workspace');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ take: '200', ...(filter.status ? { status: filter.status } : {}), ...(filter.type ? { type: filter.type } : {}) });
      const [j, h] = await Promise.all([apiGet<JobRow[]>(`/api/v1/jobs?${qs}`), fetch(`${API_URL}/health/ready`).then(r => r.json()).catch(() => ({}))]);
      setJobs(j);
      setHealth(h);
    } catch (err) {
      setError(err);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const active = (jobs ?? []).filter(j => ACTIVE_JOB.includes(j.status)).length;
  const failed = (jobs ?? []).filter(j => j.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Redis (cola)" value={health?.queue === 'ok' ? 'Conectado' : 'Sin conexión'} tone={health?.queue === 'ok' ? 'good' : 'bad'} hint={health?.queue === 'ok' ? 'Los trabajos se pueden encolar.' : 'Inicia Redis: pnpm redis:local'} />
        <Kpi label="Worker" value={health?.worker === 'ok' ? 'Activo' : 'Detenido'} tone={health?.worker === 'ok' ? 'good' : 'bad'} hint={health?.worker === 'ok' ? `Último latido ${fmtDate(health.workerSeenAt ?? null)}` : 'Los trabajos esperan en cola. Inicia: pnpm worker'} />
        <Kpi label="En cola o corriendo" value={fmt(active)} tone={active ? 'warn' : 'default'} />
        <Kpi label="Fallidos (en la lista)" value={fmt(failed)} tone={failed ? 'bad' : 'default'} hint="Agotaron sus reintentos" />
      </div>

      <Card
        title="Trabajos en segundo plano"
        actions={
          <>
            <select aria-label="Filtrar por estado" className={inputCls} value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
              <option value="">Todos los estados</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select aria-label="Filtrar por tipo" className={inputCls} value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
              <option value="">Todos los tipos</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </>
        }
      >
        <p className="text-[11px] text-slate-500 mb-3">
          Importaciones de logs y crawls corren en el worker, no en la API: si cierras el navegador o reinicias la API, siguen. Los errores transitorios se reintentan con espera creciente; los que se
          agotan quedan como fallidos para revisarlos y reintentarlos a mano.
        </p>
        <ErrorBox error={error} />
        {msg && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">{msg}</p>}
        {!jobs ? (
          <Skeleton rows={4} />
        ) : !jobs.length ? (
          <Empty>No hay trabajos con este filtro. Se crean al subir un log, iniciar un crawl o con las tareas programadas.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {jobs.map(j => {
              const st = STATUS[j.status];
              const expanded = open === j.id;
              const isActive = ACTIVE_JOB.includes(j.status);
              return (
                <li key={j.id} className="py-3 text-xs">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
                    <button className="text-left space-y-1 min-w-0" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : j.id)}>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="font-semibold">{TYPE_LABEL[j.type] ?? j.type}</span>
                        <span className="text-slate-500">· {siteName(j.siteId)} · {TRIGGER[j.trigger] ?? j.trigger}</span>
                        {j.cancelRequested && isActive && <Badge>cancelando</Badge>}
                      </span>
                      <span className="block text-slate-500">
                        {fmtDate(j.createdAt)} · duración {duration(j)} · intento {j.attempts}/{j.maxAttempts} {summary(j) && `· ${summary(j)}`}
                      </span>
                    </button>
                    <div className="flex gap-2 shrink-0">
                      {isActive && can('seo:operate') && !j.cancelRequested && (
                        <Button variant="secondary" onClick={() => act(() => apiSend('POST', `/api/v1/jobs/${j.id}/cancel`), 'Cancelación solicitada.')}><Square className="w-3.5 h-3.5" aria-hidden /> Cancelar</Button>
                      )}
                      {(j.status === 'FAILED' || j.status === 'CANCELLED') && j.type !== 'log-import' && can('seo:operate') && (
                        <Button variant="secondary" onClick={() => act(() => apiSend('POST', `/api/v1/jobs/${j.id}/retry`), 'Trabajo encolado de nuevo.')}><RotateCcw className="w-3.5 h-3.5" aria-hidden /> Reintentar</Button>
                      )}
                    </div>
                  </div>
                  {(j.status === 'RUNNING' || j.status === 'RETRYING') && (
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress}>
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, j.progress)}%` }} />
                    </div>
                  )}
                  {expanded && (
                    <div className="mt-2 space-y-2">
                      {j.error && <p className="p-2 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300">{j.error}</p>}
                      {j.retryOfId && <p className="text-slate-500">Reintento manual del trabajo {j.retryOfId.slice(0, 8)}.</p>}
                      {j.logs?.length ? (
                        <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-48 overflow-auto">
                          {j.logs.map(l => `${new Date(l.at).toLocaleTimeString('es-MX')} ${l.level === 'warn' ? '⚠ ' : ''}${l.msg}`).join('\n')}
                        </pre>
                      ) : (
                        <p className="text-slate-500">Sin registro todavía.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Tareas automáticas">
        <ul className="text-xs space-y-2 text-slate-600 dark:text-slate-400">
          <li><strong>Crawls programados:</strong> se configuran por sitio en "Crawl y auditoría" → Crawl programado.</li>
          <li><strong>Limpieza diaria (03:30):</strong> borra importaciones de logs con más de 90 días (configurable con LOG_RETENTION_DAYS), sesiones expiradas, archivos temporales y el historial de trabajos terminados de más de 90 días. Cada borrado queda en el audit log.</li>
        </ul>
        {can('site:manage') && (
          <Button className="mt-3" variant="secondary" onClick={() => window.confirm('¿Ejecutar ahora la limpieza por retención? Borra permanentemente los datos que superan su periodo.') && act(() => apiSend('POST', '/api/v1/maintenance/retention'), 'Limpieza encolada.')}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Ejecutar limpieza ahora
          </Button>
        )}
      </Card>
    </div>
  );
}
