'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Play, Square } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import type { CrawlRun, CrawledPage, JobRow } from '@/lib/types';
import { ACTIVE_JOB } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';
import { DiffPanel } from './DiffPanel';

const statusTone = (s: CrawlRun['status']) => (s === 'completed' ? 'good' : s === 'running' ? 'warn' : s === 'failed' ? 'bad' : 'default');
const codeTone = (c: number) => (c === 0 ? 'bad' : c >= 500 ? 'bad' : c >= 400 ? 'warn' : c >= 300 ? 'default' : 'good');

export function CrawlView({ siteId, onFinished }: { siteId: string; onFinished: () => void }) {
  const [runs, setRuns] = useState<CrawlRun[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ maxUrls: 500, maxDepth: 5, concurrency: 2, rps: 2, respectRobots: true, seedFromSitemap: true, renderJs: false, exclude: '' });
  const [selected, setSelected] = useState<string>('');
  const [job, setJob] = useState<JobRow | null>(null);
  const { can } = useAuth();

  const load = useCallback(async () => {
    try {
      const [list, jobs] = await Promise.all([
        apiGet<CrawlRun[]>(`/api/v1/sites/${siteId}/crawls`),
        apiGet<JobRow[]>(`/api/v1/jobs?siteId=${siteId}&type=crawl&take=5`)
      ]);
      const active = jobs.find(j => ACTIVE_JOB.includes(j.status)) ?? null;
      setJob(prev => {
        if (prev && !active) onFinished();
        return active;
      });
      setRuns(list);
      setSelected(cur => cur || list.find(r => r.status !== 'running')?.id || '');
    } catch (err) {
      setError(err);
    }
  }, [siteId, onFinished]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a crawl job is queued or running in the worker.
  useEffect(() => {
    if (!job) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [job, load]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const exclude = form.exclude.split('\n').map(s => s.trim()).filter(Boolean);
      await apiSend('POST', `/api/v1/sites/${siteId}/crawls`, { ...form, exclude });
      setSelected('');
      await load();
    } catch (err) {
      setError(err);
    }
  };
  const cancel = async (jobId: string) => {
    try {
      await apiSend('POST', `/api/v1/jobs/${jobId}/cancel`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const num = (k: 'maxUrls' | 'maxDepth' | 'concurrency' | 'rps', label: string, min: number, max: number, step = 1) => (
    <label className="text-xs font-semibold space-y-1">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} className={inputCls} value={form[k]} onChange={e => setForm({ ...form, [k]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="space-y-6">
      <Card title="Nuevo crawl">
        <form onSubmit={start} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {num('maxUrls', 'Máx. URLs (≤ 5000)', 1, 5000)}
            {num('maxDepth', 'Profundidad máx.', 0, 20)}
            {num('concurrency', 'Concurrencia', 1, 8)}
            {num('rps', 'Solicitudes / segundo', 0.1, 20, 0.1)}
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.respectRobots} onChange={e => setForm({ ...form, respectRobots: e.target.checked })} /> Respetar robots.txt</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.seedFromSitemap} onChange={e => setForm({ ...form, seedFromSitemap: e.target.checked })} /> Usar URLs del sitemap como semillas</label>
            <label className="flex items-center gap-2" title="Abre cada página en Chrome/Edge sin ventana y analiza el resultado después de ejecutar JavaScript. Mucho más lento: úsalo en sitios hechos con React, Vue, Angular o similares."><input type="checkbox" checked={form.renderJs} onChange={e => setForm({ ...form, renderJs: e.target.checked })} /> Ejecutar JavaScript (más lento)</label>
          </div>
          <label className="block text-xs font-semibold space-y-1">
            <span>Excluir rutas (una expresión regular por línea). Logout, carrito, checkout, wp-admin y búsquedas internas ya se excluyen siempre.</span>
            <textarea rows={2} className={`${inputCls} font-mono`} placeholder="^/tag/" value={form.exclude} onChange={e => setForm({ ...form, exclude: e.target.value })} />
          </label>
          <div className="flex gap-2 items-center">
            <Button type="submit" disabled={!!job || !can('seo:operate')}><Play className="w-3.5 h-3.5" aria-hidden /> Iniciar crawl</Button>
            <span className="text-[11px] text-slate-500">Lo ejecuta el worker en segundo plano: puedes cerrar esta página. User agent identificable, sin JavaScript.</span>
          </div>
          <ErrorBox error={error} />
        </form>
      </Card>

      {job && (
        <Card
          title={job.status === 'QUEUED' ? 'Crawl en cola' : job.status === 'RETRYING' ? 'Crawl reintentando' : 'Crawl en curso'}
          actions={can('seo:operate') && <Button variant="danger" disabled={job.cancelRequested} onClick={() => cancel(job.id)}><Square className="w-3.5 h-3.5" aria-hidden /> {job.cancelRequested ? 'Cancelando…' : 'Cancelar'}</Button>}
        >
          <div role="status" aria-live="polite" className="text-xs space-y-2">
            {job.status === 'QUEUED' ? (
              <div>Esperando a que el worker lo tome. Si no avanza, revisa en "Jobs y automatizaciones" que el worker esté activo.</div>
            ) : (
              <>
                <div>{fmt(job.progressDetail?.crawled ?? 0)} páginas rastreadas · {fmt(job.progressDetail?.queued ?? 0)} en cola · intento {job.attempts} de {job.maxAttempts}</div>
                <div className="font-mono text-[11px] text-slate-500 truncate">{job.progressDetail?.current}</div>
              </>
            )}
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}>
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(job.status === 'QUEUED' ? 0 : 3, job.progress)}%` }} />
            </div>
          </div>
        </Card>
      )}

      <ScheduleCard siteId={siteId} editable={can('seo:operate')} />

      <Card title="Historial de crawls">
        {!runs ? (
          <Skeleton />
        ) : !runs.length ? (
          <Empty>Aún no hay crawls para este sitio.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Crawls</caption>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th scope="col" className="py-2">Inicio</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="text-right">Páginas</th>
                  <th scope="col" className="text-right">Tipos de issue</th>
                  <th scope="col">robots.txt</th>
                  <th scope="col" className="text-right"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {runs.map(r => (
                  <tr key={r.id} className={selected === r.id ? 'bg-indigo-500/5' : ''}>
                    <td className="py-2 whitespace-nowrap">{fmtDate(r.startedAt)}</td>
                    <td>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge> {r.config?.limitReached && <Badge tone="warn">límite de URLs</Badge>}
                      {r.error && <div className="text-[11px] text-rose-600">{r.error}</div>}
                    </td>
                    <td className="text-right tabular-nums">{fmt(r.urlsCrawled)}</td>
                    <td className="text-right tabular-nums">{fmt(r.issuesFound)}</td>
                    <td className="text-slate-500">{r.config?.robots ? (r.config.robots.found ? `encontrado${r.config.robots.crawlDelay ? `, crawl-delay ${r.config.robots.crawlDelay}s` : ''}` : `no (${r.config.robots.status ?? 'sin respuesta'})`) : '—'}</td>
                    <td className="text-right">{r.status !== 'running' && <Button variant="secondary" onClick={() => setSelected(r.id)} aria-pressed={selected === r.id}>Ver detalle</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && runs?.find(r => r.id === selected)?.status === 'completed' && <DiffPanel runId={selected} />}
      {selected && <PagesTable runId={selected} />}
    </div>
  );
}

function PagesTable({ runId }: { runId: string }) {
  const [filter, setFilter] = useState({ status: '', indexable: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: CrawledPage[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const pageSize = 50;

  useEffect(() => {
    setData(null);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filter.status) qs.set('status', filter.status);
    if (filter.indexable) qs.set('indexable', filter.indexable);
    if (filter.q) qs.set('q', filter.q);
    const t = setTimeout(() => apiGet<{ total: number; items: CrawledPage[] }>(`/api/v1/crawls/${runId}/pages?${qs}`).then(setData).catch(setError), 200);
    return () => clearTimeout(t);
  }, [runId, filter, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  return (
    <Card title={`Páginas rastreadas${data ? ` (${fmt(data.total)})` : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <label className="text-xs"><span className="sr-only">Buscar URL</span><input className={inputCls} placeholder="Buscar en la URL…" value={filter.q} onChange={e => { setPage(1); setFilter({ ...filter, q: e.target.value }); }} /></label>
        <label className="text-xs">
          <select aria-label="Estado HTTP" className={inputCls} value={filter.status} onChange={e => { setPage(1); setFilter({ ...filter, status: e.target.value }); }}>
            <option value="">Todos los estados</option><option value="ok">2xx</option><option value="redirect">3xx</option><option value="error">Errores</option><option value="blocked">Bloqueadas por robots</option>
          </select>
        </label>
        <label className="text-xs">
          <select aria-label="Indexabilidad" className={inputCls} value={filter.indexable} onChange={e => { setPage(1); setFilter({ ...filter, indexable: e.target.value }); }}>
            <option value="">Indexables y no indexables</option><option value="true">Indexables</option><option value="false">No indexables</option>
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <Skeleton rows={6} />
      ) : !data.items.length ? (
        <Empty>Ninguna página coincide con el filtro.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Páginas rastreadas</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th scope="col" className="py-2">URL</th>
                <th scope="col">HTTP</th>
                <th scope="col">Indexable</th>
                <th scope="col">Título</th>
                <th scope="col" className="text-right">Prof.</th>
                <th scope="col" className="text-right">Enlaces entrantes</th>
                <th scope="col" className="text-right">Palabras</th>
                <th scope="col" className="text-right">ms</th>
                <th scope="col">Sitemap / logs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map(p => {
                const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
                return (
                  <tr key={p.id}>
                    <td className="py-1.5 font-mono text-[11px] break-all pr-2" title={p.url}>{path}{p.finalUrl !== p.url && <div className="text-slate-500">→ {p.finalUrl}</div>}</td>
                    <td><Badge tone={codeTone(p.statusCode)}>{p.blockedByRobots ? 'robots' : p.statusCode || 'error'}</Badge></td>
                    <td>{p.isIndexable ? <Badge tone="good">sí</Badge> : <span className="text-[11px] text-slate-500">{p.indexabilityReason}</span>}</td>
                    <td className="max-w-[16rem] truncate" title={p.title ?? ''}>{p.title ?? <span className="text-slate-400">—</span>}</td>
                    <td className="text-right tabular-nums">{p.depth}</td>
                    <td className="text-right tabular-nums">{fmt(p.inlinks)}</td>
                    <td className="text-right tabular-nums">{p.wordCount ? fmt(p.wordCount) : '—'}</td>
                    <td className="text-right tabular-nums">{p.responseTimeMs || '—'}</td>
                    <td className="whitespace-nowrap">{p.inSitemap ? 'sitemap' : '—'} · {p.inLogs ? 'Googlebot' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <nav className="flex justify-between items-center mt-3 text-xs" aria-label="Paginación">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <span>Página {page} de {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </nav>
    </Card>
  );
}

const PRESETS: Array<[string, string]> = [
  ['', 'Desactivado'],
  ['0 3 * * *', 'Diario a las 03:00'],
  ['0 3 * * 1', 'Semanal: lunes 03:00'],
  ['0 3 1 * *', 'Mensual: día 1, 03:00']
];

function ScheduleCard({ siteId, editable }: { siteId: string; editable: boolean }) {
  const [sched, setSched] = useState<{ cron: string | null; timezone: string; nextRuns: string[] } | null>(null);
  const [cron, setCron] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ cron: string | null; timezone: string; nextRuns: string[] }>(`/api/v1/sites/${siteId}/schedule`)
      .then(s => {
        setSched(s);
        setCron(s.cron ?? '');
      })
      .catch(setError);
  }, [siteId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const s = await apiSend<{ cron: string | null; timezone: string; nextRuns: string[] }>('PUT', `/api/v1/sites/${siteId}/schedule`, { cron: cron.trim() || null });
      setSched(s);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4" aria-hidden /> Crawl programado</span>}>
      <form onSubmit={save} className="flex flex-col md:flex-row gap-2 md:items-end text-xs">
        <label className="font-semibold space-y-1">
          <span>Frecuencia</span>
          <select aria-label="Frecuencia predefinida" className={inputCls} disabled={!editable} value={PRESETS.some(([v]) => v === cron) ? cron : 'custom'} onChange={e => e.target.value !== 'custom' && setCron(e.target.value)}>
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value="custom">Personalizada (cron)</option>
          </select>
        </label>
        <label className="font-semibold space-y-1 flex-1">
          <span>Expresión cron (minuto hora día mes día-semana), zona {sched?.timezone ?? 'UTC'}</span>
          <input className={`${inputCls} font-mono`} disabled={!editable} placeholder="0 3 * * 1" value={cron} onChange={e => setCron(e.target.value)} />
        </label>
        {editable && <Button type="submit">Guardar</Button>}
      </form>
      <div className="mt-3 text-xs space-y-1" aria-live="polite">
        <ErrorBox error={error} />
        {saved && <p className="text-emerald-700 dark:text-emerald-400">✓ Programación guardada.</p>}
        {sched?.cron ? (
          <p className="text-slate-600 dark:text-slate-400">Próximas ejecuciones: {sched.nextRuns.map(d => fmtDate(d)).join(' · ')}. Usa las opciones por defecto (500 URLs, 2 solicitudes/segundo); cada crawl genera alertas si algo cambió.</p>
        ) : (
          <p className="text-slate-500">Sin programación. Un crawl semanal detecta regresiones después de cada deploy sin tener que acordarte.</p>
        )}
      </div>
    </Card>
  );
}
