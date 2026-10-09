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

const NO_LIMITS = { maxUrlsPerFolder: '', maxFolderDepth: '', maxUrlLength: '', maxQueryParams: '', maxLinksPerPage: '', maxRedirects: '', maxPageSizeKb: '', stayInStartFolder: false };
const SKIP_LABEL: Record<string, string> = {
  maxUrls: 'límite de URLs',
  maxDepth: 'profundidad',
  maxUrlLength: 'URL muy larga',
  maxFolderDepth: 'carpetas profundas',
  maxUrlsPerFolder: 'por carpeta',
  maxQueryParams: 'parámetros',
  maxLinksPerPage: 'enlaces por página',
  outsideStartFolder: 'fuera de la carpeta',
  excluded: 'excluidas',
  notInInclude: 'no incluidas'
};

export function CrawlView({ siteId, onFinished }: { siteId: string; onFinished: () => void }) {
  const [runs, setRuns] = useState<CrawlRun[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'site' | 'list'>('site');
  const [list, setList] = useState('');
  const [limits, setLimits] = useState<typeof NO_LIMITS>(NO_LIMITS);
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
      const listUrls = mode === 'list' ? [...new Set(list.split(/\s+/).map(s => s.trim()).filter(Boolean))] : undefined;
      if (mode === 'list' && !listUrls?.length) throw new Error('Pega al menos una URL en la lista.');
      const lim = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== '' && v !== false).map(([k, v]) => [k, typeof v === 'string' ? Number(v) : v]));
      await apiSend('POST', `/api/v1/sites/${siteId}/crawls`, { ...form, exclude, ...(listUrls ? { listUrls, maxUrls: Math.max(listUrls.length, 1) } : {}), ...lim });
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

  const URL_LIMITS = [500, 1000, 2500, 5000, 10000, 50000, 100000];
  const limitField = (k: keyof typeof limits, label: string, help: string, min: number, max: number) => (
    <label className="text-xs space-y-1" title={help}>
      <span className="font-semibold block">{label}</span>
      <input type="number" min={min} max={max} placeholder="Sin límite" aria-label={label} className={`${inputCls} w-full`} value={limits[k] as string} onChange={e => setLimits({ ...limits, [k]: e.target.value })} />
      <span className="block text-[10px] text-slate-500">{help}</span>
    </label>
  );
  const activeLimits = Object.values(limits).filter(v => v !== '' && v !== false).length;
  const estMinutes = Math.ceil(form.maxUrls / Math.max(form.rps, 0.1) / 60);
  const estTime = estMinutes >= 90 ? `${(estMinutes / 60).toFixed(1)} horas` : `${estMinutes} min`;
  const estDisk = form.maxUrls * 26 * 1024 >= 1024 ** 3 ? `${((form.maxUrls * 26) / 1024 ** 2).toFixed(1)} GB` : `${Math.ceil((form.maxUrls * 26) / 1024)} MB`;

  return (
    <div className="space-y-6">
      <Card title="Nuevo crawl">
        <form onSubmit={start} className="space-y-4">
          <div role="radiogroup" aria-label="Modo de crawl" className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
            {([['site', 'Rastrear el sitio'], ['list', 'Lista de URLs']] as const).map(([id, label]) => (
              <button type="button" key={id} role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={`px-3 py-1.5 rounded-lg font-semibold ${mode === id ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</button>
            ))}
          </div>
          {mode === 'list' && (
            <label className="block text-xs space-y-1">
              <span className="font-semibold">URLs a revisar (una por línea, del mismo dominio)</span>
              <textarea rows={5} aria-label="URLs a revisar" className={`${inputCls} w-full font-mono`} placeholder={'https://www.misitio.com/pagina-1\nhttps://www.misitio.com/pagina-2'} value={list} onChange={e => setList(e.target.value)} />
              <span className="block text-slate-500">Se revisan solo estas URLs, sin seguir enlaces (como el modo "List" de Screaming Frog). No modifica los issues ni las alertas del sitio. {list.trim() ? `${new Set(list.split(/\s+/).filter(Boolean)).size} URLs.` : ''}</span>
            </label>
          )}
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${mode === 'list' ? 'hidden' : ''}`}>
            <label className="text-xs font-semibold space-y-1">
              <span>Máx. URLs</span>
              <select aria-label="Máx. URLs" className={inputCls} value={form.maxUrls} onChange={e => setForm({ ...form, maxUrls: Number(e.target.value) })}>
                {URL_LIMITS.map(n => <option key={n} value={n}>{n.toLocaleString('es-MX')}{n === 100000 ? ' (máximo)' : ''}</option>)}
              </select>
            </label>
            {num('maxDepth', 'Profundidad máx.', 0, 20)}
            {num('concurrency', 'Concurrencia', 1, 8)}
            {num('rps', 'Solicitudes / segundo', 0.1, 20, 0.1)}
          </div>
          {form.maxUrls >= 10000 && (
            <div role={form.maxUrls >= 100000 ? 'alert' : 'status'} className={`flex gap-2 p-3 rounded-xl border text-xs ${form.maxUrls >= 100000 ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
              <span>
                {form.maxUrls >= 100000 && <strong>Crawl muy grande. </strong>}
                Si el sitio tiene {form.maxUrls.toLocaleString('es-MX')} URLs, a {form.rps} solicitudes por segundo tardará unos <strong>{estTime}</strong>{form.renderJs ? ' (bastante más con JavaScript)' : ''} y ocupará cerca de <strong>{estDisk}</strong> en disco.
                {form.maxUrls >= 100000 && ' Usa una velocidad que el servidor aguante, de preferencia en un sitio propio o con permiso, y en horario de poco tráfico.'}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.respectRobots} onChange={e => setForm({ ...form, respectRobots: e.target.checked })} /> Respetar robots.txt</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.seedFromSitemap} onChange={e => setForm({ ...form, seedFromSitemap: e.target.checked })} /> Usar URLs del sitemap como semillas</label>
            <label className="flex items-center gap-2" title="Abre cada página en Chrome/Edge sin ventana y analiza el resultado después de ejecutar JavaScript. Mucho más lento: úsalo en sitios hechos con React, Vue, Angular o similares."><input type="checkbox" checked={form.renderJs} onChange={e => setForm({ ...form, renderJs: e.target.checked })} /> Ejecutar JavaScript (más lento)</label>
          </div>
          {mode === 'site' && (
            <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs" open={activeLimits > 0}>
              <summary className="cursor-pointer font-semibold">Límites avanzados (como Screaming Frog){activeLimits ? ` · ${activeLimits} activos` : ''}</summary>
              <p className="text-slate-500 mt-2 mb-3">Déjalos vacíos para no limitar. Útiles en sitios grandes: revisar una muestra de cada sección, evitar URLs con filtros o parámetros infinitos, o auditar solo una carpeta. Al terminar, el historial muestra cuántas URLs omitió cada límite.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {limitField('maxUrlsPerFolder', 'URLs por carpeta', 'Máximo por carpeta de primer nivel (/blog/, /productos/…).', 1, 100000)}
                {limitField('maxFolderDepth', 'Profundidad de carpetas', 'Segmentos de la ruta: /a/b/c = 3.', 0, 50)}
                {limitField('maxUrlLength', 'Largo máx. de URL', 'Caracteres. Evita URLs generadas sin fin.', 20, 10000)}
                {limitField('maxQueryParams', 'Parámetros máx. en la URL', '0 = no rastrear URLs con "?" (filtros, orden, sesiones).', 0, 50)}
                {limitField('maxLinksPerPage', 'Enlaces a seguir por página', 'Solo los primeros N enlaces internos de cada página.', 1, 10000)}
                {limitField('maxRedirects', 'Redirecciones a seguir', 'Saltos antes de marcar error (por defecto 10).', 0, 20)}
                {limitField('maxPageSizeKb', 'Peso máx. de página (KB)', 'Las páginas más pesadas se cortan (por defecto 5,120 KB).', 16, 51200)}
                <label className="flex items-start gap-2 self-center" title="Si empiezas en https://misitio.com/blog/, solo se rastrea lo que está dentro de /blog/.">
                  <input type="checkbox" className="mt-0.5" checked={limits.stayInStartFolder} onChange={e => setLimits({ ...limits, stayInStartFolder: e.target.checked })} />
                  <span><span className="font-semibold block">Quedarse en la carpeta inicial</span><span className="text-[10px] text-slate-500">Solo URLs dentro de la carpeta de la URL del sitio.</span></span>
                </label>
              </div>
              {activeLimits > 0 && <p className="mt-3 text-amber-700 dark:text-amber-400">Con límites activos el crawl es parcial: no se reportarán como "eliminadas" las páginas que queden fuera.</p>}
              {activeLimits > 0 && <button type="button" className="mt-2 text-indigo-600 dark:text-indigo-400 underline" onClick={() => setLimits(NO_LIMITS)}>Quitar todos los límites</button>}
            </details>
          )}
          <label className={`block text-xs font-semibold space-y-1 ${mode === 'list' ? 'hidden' : ''}`}>
            <span>Excluir rutas (una expresión regular por línea). Logout, carrito, checkout, wp-admin y búsquedas internas ya se excluyen siempre.</span>
            <textarea rows={2} className={`${inputCls} font-mono`} placeholder="^/tag/" value={form.exclude} onChange={e => setForm({ ...form, exclude: e.target.value })} />
          </label>
          <div className="flex gap-2 items-center">
            <Button type="submit" disabled={!!job || !can('seo:operate')}><Play className="w-3.5 h-3.5" aria-hidden /> Iniciar crawl</Button>
            <span className="text-[11px] text-slate-500">Lo ejecuta el worker en segundo plano: puedes cerrar esta página. User agent identificable, {form.renderJs ? 'ejecutando JavaScript' : 'sin JavaScript'}.</span>
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
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge> {r.mode === 'list' && <Badge>lista</Badge>} {r.config?.limitReached && <Badge tone="warn">límite de URLs</Badge>}
                      {r.config?.skipped && Object.keys(r.config.skipped).length > 0 && (
                        <span className="block text-[10px] text-slate-500 mt-0.5" title="URLs encontradas que no se rastrearon, por límite">
                          Omitidas: {Object.entries(r.config.skipped).map(([k, v]) => `${SKIP_LABEL[k] ?? k} ${v}`).join(' · ')}
                        </span>
                      )}
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
