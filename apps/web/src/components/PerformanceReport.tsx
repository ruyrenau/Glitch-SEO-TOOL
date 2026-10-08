'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { apiGet, fmt, fmtDate } from '@/lib/api';
import { Badge, ErrorBox, Skeleton, inputCls } from './ui';

type Metric = 'FCP' | 'LCP' | 'TBT' | 'CLS';
type Impact = 'Alto' | 'Medio' | 'Medio-bajo' | 'Bajo';
type Group = 'HTML' | 'JS' | 'CSS' | 'IMG' | 'Video' | 'Font' | 'XHR' | 'Other';
interface Report {
  screenshot: string | null;
  filmstrip: Array<{ timing: number; data: string }>;
  grade: { letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null; value: number | null; performance: number | null; structure: number | null };
  issues: Array<{ id: string; title: string; description: string; displayValue: string | null; score: number; impact: Impact; metrics: Metric[]; savingsMs: number | null; savingsBytes: number | null; itemCount: number; items: Array<{ label: string; url: string | null; wastedBytes: number | null; wastedMs: number | null; totalBytes: number | null }> }>;
  breakdown: Array<{ group: Group; bytes: number; requests: number }>;
  totals: { bytes: number; requests: number; fullyLoadedMs: number | null };
  markers: { fcp: number | null; lcp: number | null; domContentLoaded: number | null; load: number | null };
  waterfall: Array<{ url: string; group: Group; mimeType: string; status: number; start: number; end: number; transferSize: number; resourceSize: number; priority: string | null; protocol: string | null; domain: string | null }>;
  waterfallTruncated: boolean;
  lcpElement: string | null;
}
interface FullRun {
  id: string;
  url: string;
  finalUrl: string | null;
  strategy: 'mobile' | 'desktop';
  source: 'psi' | 'lighthouse-local';
  lighthouseVersion: string | null;
  createdAt: string;
  lab: { LCP: number | null; CLS: number | null; TBT: number | null; FCP: number | null; SI: number | null; TTFB: number | null } | null;
  report: Report | null;
}

const GRADE_COLOR: Record<string, string> = { A: 'text-emerald-500', B: 'text-lime-500', C: 'text-yellow-500', D: 'text-amber-500', E: 'text-orange-500', F: 'text-rose-500' };
const pctColor = (v: number | null) => (v === null ? 'text-slate-400' : v >= 90 ? 'text-emerald-500' : v >= 50 ? 'text-amber-500' : 'text-rose-500');
const IMPACT_STYLE: Record<Impact, string> = { Alto: 'bg-rose-500 text-white', Medio: 'bg-amber-500 text-white', 'Medio-bajo': 'bg-lime-500 text-white', Bajo: 'bg-emerald-600 text-white' };
const GROUP_COLOR: Record<Group, string> = { HTML: 'bg-sky-600', JS: 'bg-amber-500', CSS: 'bg-violet-500', IMG: 'bg-emerald-500', Video: 'bg-indigo-800', Font: 'bg-pink-500', XHR: 'bg-teal-500', Other: 'bg-slate-400' };
const GROUP_LABEL: Record<Group, string> = { HTML: 'HTML', JS: 'JS', CSS: 'CSS', IMG: 'Imágenes', Video: 'Vídeo', Font: 'Fuentes', XHR: 'XHR', Other: 'Otros' };
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${(b / 1024).toFixed(b < 10240 ? 2 : 0)} KB`);
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const vital = (k: 'LCP' | 'TBT' | 'CLS', v: number | null | undefined) => {
  if (v === null || v === undefined) return 'text-slate-400';
  const t = { LCP: [2500, 4000], TBT: [200, 600], CLS: [0.1, 0.25] }[k];
  return v <= t[0] ? 'text-emerald-500' : v <= t[1] ? 'text-amber-500' : 'text-rose-500';
};
const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    const last = x.pathname.split('/').filter(Boolean).pop() ?? x.hostname;
    return `${last}${x.search}`.slice(0, 80) || x.hostname;
  } catch {
    return u.slice(0, 80);
  }
};

function Bars({ items, value, label }: { items: Report['breakdown']; value: 'bytes' | 'requests'; label: (b: Report['breakdown'][number]) => string }) {
  const total = items.reduce((s, b) => s + b[value], 0) || 1;
  return (
    <div className="flex h-12 rounded-lg overflow-hidden text-[10px] text-white font-semibold">
      {items.map(b => {
        const pct = (b[value] / total) * 100;
        return (
          <div key={b.group} className={`${GROUP_COLOR[b.group]} flex flex-col items-center justify-center min-w-0 px-0.5`} style={{ width: `${pct}%` }} title={`${GROUP_LABEL[b.group]}: ${label(b)} (${pct.toFixed(1)} %)`}>
            {pct > 8 && (<><span className="truncate">{GROUP_LABEL[b.group]}</span><span className="truncate font-normal">{label(b)}</span></>)}
          </div>
        );
      })}
    </div>
  );
}

const WF_FILTERS: Array<['all' | Group, string]> = [['all', 'Todas'], ['HTML', 'HTML'], ['JS', 'JS'], ['CSS', 'CSS'], ['IMG', 'Imágenes'], ['Video', 'Vídeo'], ['XHR', 'XHR'], ['Font', 'Fuentes'], ['Other', 'Otros']];

function Waterfall({ r }: { r: Report }) {
  const [group, setGroup] = useState<'all' | Group>('all');
  const [q, setQ] = useState('');
  const rows = r.waterfall.filter(w => (group === 'all' || w.group === group) && (!q || w.url.toLowerCase().includes(q.toLowerCase())));
  // Include the FCP/LCP/onload markers: on fast pages they come after the last request.
  const span = Math.max(r.totals.fullyLoadedMs ?? 0, r.markers.fcp ?? 0, r.markers.lcp ?? 0, r.markers.load ?? 0, ...r.waterfall.map(w => w.end), 1) * 1.05;
  const marker = (v: number | null, cls: string, label: string) => (v === null ? null : <span className={`absolute top-0 bottom-0 w-px ${cls}`} style={{ left: `${(v / span) * 100}%` }} title={`${label}: ${ms(v)}`} />);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Filtrar peticiones</span>
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className={`${inputCls} pl-7 w-56`} placeholder="Filtrar peticiones…" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div role="tablist" aria-label="Tipo de petición" className="flex flex-wrap gap-0.5">
          {WF_FILTERS.map(([id, label]) => {
            const count = id === 'all' ? r.waterfall.length : r.waterfall.filter(w => w.group === id).length;
            if (id !== 'all' && !count) return null;
            return (
              <button key={id} role="tab" aria-selected={group === id} onClick={() => setGroup(id)} className={`px-2.5 py-1 text-[11px] font-semibold ${group === id ? 'bg-sky-800 text-white' : 'bg-sky-600/80 text-white hover:bg-sky-700'} first:rounded-l-lg last:rounded-r-lg`}>
                {label} ({count})
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-slate-500 flex items-center gap-2">
          <span className="inline-block w-3 h-0.5 bg-emerald-500" /> FCP <span className="inline-block w-3 h-0.5 bg-rose-500" /> LCP <span className="inline-block w-3 h-0.5 bg-sky-500" /> onload
        </span>
      </div>
      <div className="overflow-auto max-h-[28rem] border border-slate-200 dark:border-slate-800 rounded-xl">
        <table className="w-full text-left text-[11px] table-fixed min-w-[820px]">
          <colgroup><col style={{ width: '30%' }} /><col style={{ width: 52 }} /><col style={{ width: '16%' }} /><col style={{ width: 70 }} /><col /></colgroup>
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900 z-10">
            <tr className="text-slate-500"><th className="py-1.5 px-2">URL</th><th>Estado</th><th>Dominio</th><th className="text-right pr-2">Tamaño</th><th className="px-2">Línea de tiempo</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((w, i) => {
              const left = (w.start / span) * 100;
              const width = Math.max(0.4, ((w.end - w.start) / span) * 100);
              return (
                <tr key={`${w.url}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="py-1 px-2 truncate font-mono" title={w.url}><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${GROUP_COLOR[w.group]}`} />{shortUrl(w.url)}</td>
                  <td className={w.status >= 400 || w.status === 0 ? 'text-rose-600 font-semibold' : w.status >= 300 ? 'text-amber-600' : ''}>{w.status || 'error'}</td>
                  <td className="truncate text-slate-500" title={w.domain ?? ''}>{w.domain}</td>
                  <td className="text-right pr-2 tabular-nums">{kb(w.transferSize)}</td>
                  <td className="px-2">
                    <div className="relative h-4">
                      {marker(r.markers.fcp, 'bg-emerald-500', 'FCP')}
                      {marker(r.markers.lcp, 'bg-rose-500', 'LCP')}
                      {marker(r.markers.load, 'bg-sky-500', 'onload')}
                      <div className={`absolute top-1 h-2 rounded-sm ${GROUP_COLOR[w.group]}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${ms(w.start)} → ${ms(w.end)} (${ms(w.end - w.start)})`} />
                      <span className="absolute top-0 text-[10px] text-slate-500 tabular-nums whitespace-nowrap" style={{ left: `calc(${Math.min(left + width, 88)}% + 4px)` }}>{ms(w.end - w.start)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">{fmt(rows.length)} de {fmt(r.totals.requests)} peticiones.{r.waterfallTruncated && ' Se guardan las primeras 400 por orden de inicio.'} Los tiempos son los observados en esta medición, sin la simulación de red lenta que usa Lighthouse para las métricas.</p>
    </div>
  );
}

const METRIC_FILTERS: Array<['all' | Metric, string]> = [['all', 'Todos'], ['FCP', 'FCP'], ['LCP', 'LCP'], ['TBT', 'TBT'], ['CLS', 'CLS']];

function Issues({ r, limit }: { r: Report; limit?: number }) {
  const [metric, setMetric] = useState<'all' | Metric>('all');
  const [open, setOpen] = useState<string | null>(null);
  const list = r.issues.filter(i => metric === 'all' || i.metrics.includes(metric));
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Filtrar por métrica" className="flex gap-1">
        {METRIC_FILTERS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={metric === id} onClick={() => setMetric(id)} className={`px-3 py-1 rounded-lg text-[11px] font-semibold border ${metric === id ? 'bg-sky-800 text-white border-sky-800' : 'border-slate-300 dark:border-slate-700'}`}>{label}</button>
        ))}
      </div>
      {!shown.length ? (
        <p className="text-xs text-slate-500 p-3">Sin problemas {metric === 'all' ? '' : `que afecten ${metric}`} en esta medición.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map(i => {
            const isOpen = open === i.id;
            return (
              <li key={i.id} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                <button className="w-full flex items-stretch text-left text-xs" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.id)}>
                  <span className={`w-24 shrink-0 flex items-center justify-center font-semibold ${IMPACT_STYLE[i.impact]}`}>{i.impact}</span>
                  <span className="flex-1 flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60">
                    <span className="font-semibold text-sky-700 dark:text-sky-300">{i.title}</span>
                    {i.metrics.map(m => <span key={m} className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-semibold">{m}</span>)}
                    {i.displayValue && <span className="text-slate-500">{i.displayValue}</span>}
                  </span>
                  <span className="w-10 flex items-center justify-center bg-slate-100 dark:bg-slate-800">{isOpen ? <ChevronDown className="w-4 h-4" aria-hidden /> : <ChevronRight className="w-4 h-4" aria-hidden />}</span>
                </button>
                {isOpen && (
                  <div className="p-3 text-xs space-y-2 border-t border-slate-200 dark:border-slate-800">
                    <p className="text-slate-600 dark:text-slate-300">{i.description}</p>
                    {(i.savingsMs || i.savingsBytes) && <p className="text-slate-500">Ahorro estimado: {i.savingsMs ? ms(i.savingsMs) : ''}{i.savingsMs && i.savingsBytes ? ' · ' : ''}{i.savingsBytes ? kb(i.savingsBytes) : ''}</p>}
                    {i.items.length > 0 && (
                      <table className="w-full text-[11px]">
                        <thead><tr className="text-slate-500 text-left"><th className="py-1">Elemento</th><th className="text-right">Tamaño</th><th className="text-right">Ahorro</th></tr></thead>
                        <tbody>
                          {i.items.map((it, k) => (
                            <tr key={k} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="py-1 font-mono break-all">{it.label || '—'}</td>
                              <td className="text-right tabular-nums">{it.totalBytes ? kb(it.totalBytes) : ''}</td>
                              <td className="text-right tabular-nums">{it.wastedBytes ? kb(it.wastedBytes) : it.wastedMs ? ms(it.wastedMs) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {i.itemCount > i.items.length && <p className="text-slate-500">…y {i.itemCount - i.items.length} más.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {limit && list.length > limit && <p className="text-[11px] text-slate-500">Se muestran los {limit} principales de {list.length}. Abajo, en "Todos los problemas", está la lista completa.</p>}
    </div>
  );
}

const TABS = [
  ['summary', 'Resumen'],
  ['issues', 'Todos los problemas'],
  ['waterfall', 'Cascada'],
  ['filmstrip', 'Carga visual']
] as const;

/** GTmetrix-style report for one measurement (loaded on demand: screenshots and waterfalls are heavy). */
export function PerformanceReportView({ runId }: { runId: string }) {
  const [run, setRun] = useState<FullRun | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('summary');
  useEffect(() => {
    setRun(null);
    setError(null);
    apiGet<FullRun>(`/api/v1/performance-runs/${runId}`).then(setRun).catch(setError);
  }, [runId]);
  const r = run?.report ?? null;
  const breakdown = useMemo(() => r?.breakdown ?? [], [r]);

  if (error) return <ErrorBox error={error} />;
  if (!run) return <Skeleton rows={6} />;
  if (!r) return <p className="text-xs text-slate-500">Esta medición es antigua o se hizo antes del reporte detallado: solo se guardan captura y cascada de las últimas 5 mediciones por URL y dispositivo. Mide de nuevo para verlo.</p>;

  const lab = run.lab;
  return (
    <div className="space-y-5">
      {/* Header: screenshot + what was measured */}
      <div className="grid md:grid-cols-[18rem_1fr] gap-5 items-start">
        {r.screenshot ? (
          <img src={r.screenshot} alt={`Captura de ${run.finalUrl ?? run.url}`} className="w-full rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
        ) : (
          <div className="aspect-video rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs text-slate-500">Sin captura</div>
        )}
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-sky-700 dark:text-sky-300">Reporte de rendimiento</h3>
          <p className="font-mono text-sm break-all">{run.finalUrl ?? run.url}</p>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-xs">
            <dt className="text-slate-500">Generado</dt><dd>{fmtDate(run.createdAt)}</dd>
            <dt className="text-slate-500">Dispositivo</dt><dd>{run.strategy === 'mobile' ? 'Móvil (red y CPU simuladas como un teléfono de gama media)' : 'Escritorio'}</dd>
            <dt className="text-slate-500">Medido desde</dt><dd>{run.source === 'psi' ? 'Servidores de Google (PageSpeed Insights)' : 'Esta computadora (Lighthouse local)'}</dd>
            <dt className="text-slate-500">Herramienta</dt><dd>Lighthouse {run.lighthouseVersion ?? ''}</dd>
          </dl>
        </div>
      </div>

      {/* Grade + Web Vitals */}
      <div className="grid lg:grid-cols-2 gap-4">
        <section aria-label="Nota" className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <h4 className="px-4 py-2 text-sm font-bold text-sky-700 dark:text-sky-300 bg-slate-50 dark:bg-slate-900/60" title="70 % rendimiento + 30 % estructura, como GTmetrix. La estructura sale de las auditorías de Lighthouse, así que la nota puede diferir un poco de la de GTmetrix.">Nota</h4>
          <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-4 flex items-center justify-center"><span className={`text-6xl font-black ${GRADE_COLOR[r.grade.letter ?? ''] ?? 'text-slate-400'}`}>{r.grade.letter ?? '—'}</span></div>
            <div className="p-4"><div className="text-xs text-slate-500" title="Puntuación de rendimiento de Lighthouse">Rendimiento</div><div className={`text-3xl font-bold ${pctColor(r.grade.performance)}`}>{r.grade.performance ?? '—'}%</div></div>
            <div className="p-4"><div className="text-xs text-slate-500" title="Qué tan bien está construida la página: proporción de auditorías de Lighthouse que pasan">Estructura</div><div className={`text-3xl font-bold ${pctColor(r.grade.structure)}`}>{r.grade.structure ?? '—'}%</div></div>
          </div>
        </section>
        <section aria-label="Web Vitals" className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <h4 className="px-4 py-2 text-sm font-bold text-sky-700 dark:text-sky-300 bg-slate-50 dark:bg-slate-900/60">Web Vitals</h4>
          <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-4"><div className="text-xs text-slate-500" title="Largest Contentful Paint: cuándo aparece el elemento más grande">LCP</div><div className={`text-3xl font-bold ${vital('LCP', lab?.LCP)}`}>{ms(lab?.LCP)}</div></div>
            <div className="p-4"><div className="text-xs text-slate-500" title="Total Blocking Time: tiempo en que la página no responde">TBT</div><div className={`text-3xl font-bold ${vital('TBT', lab?.TBT)}`}>{ms(lab?.TBT)}</div></div>
            <div className="p-4"><div className="text-xs text-slate-500" title="Cumulative Layout Shift: cuánto se mueve el contenido al cargar">CLS</div><div className={`text-3xl font-bold ${vital('CLS', lab?.CLS)}`}>{lab?.CLS === null || lab?.CLS === undefined ? '—' : Number(lab.CLS.toFixed(3))}</div></div>
          </div>
        </section>
      </div>

      <div role="tablist" aria-label="Secciones del reporte" className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${tab === id ? 'border-sky-600 text-sky-700 dark:text-sky-300' : 'border-transparent text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="grid lg:grid-cols-[1fr_22rem] gap-6">
          <section>
            <h4 className="text-base font-bold mb-1">Principales problemas</h4>
            <p className="text-xs text-slate-500 mb-3">Lo que más afecta el rendimiento. Filtra por la métrica que quieras mejorar y abre cada uno para ver qué archivos lo causan.</p>
            <Issues r={r} limit={6} />
          </section>
          <section className="space-y-4 text-xs">
            <h4 className="text-base font-bold">Detalles de la página</h4>
            <div className="text-center">
              <div className="text-2xl font-bold">{ms(r.totals.fullyLoadedMs)}</div>
              <div className="text-[11px] text-slate-500" title="Fin de la última petición observada">Carga completa</div>
            </div>
            <div>
              <div className="font-bold mb-1">Peso total: {kb(r.totals.bytes)}</div>
              <Bars items={breakdown} value="bytes" label={b => kb(b.bytes)} />
            </div>
            <div>
              <div className="font-bold mb-1">Peticiones: {fmt(r.totals.requests)}</div>
              <Bars items={[...breakdown].sort((a, b) => b.requests - a.requests)} value="requests" label={b => `${b.requests}`} />
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {breakdown.map(b => (
                <li key={b.group} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-sm ${GROUP_COLOR[b.group]}`} />{GROUP_LABEL[b.group]}: {kb(b.bytes)} · {b.requests}</li>
              ))}
            </ul>
            {r.lcpElement && (
              <div>
                <div className="font-bold mb-1">Elemento LCP</div>
                <code className="block p-2 rounded bg-slate-100 dark:bg-slate-900 break-all text-[11px]">{r.lcpElement}</code>
              </div>
            )}
          </section>
        </div>
      )}
      {tab === 'issues' && <Issues r={r} />}
      {tab === 'waterfall' && <Waterfall r={r} />}
      {tab === 'filmstrip' && (
        !r.filmstrip.length ? <p className="text-xs text-slate-500">Lighthouse no generó la secuencia de carga en esta medición.</p> : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Cómo se ve la página mientras carga. Marcas: FCP {ms(r.markers.fcp)} · LCP {ms(lab?.LCP)}.</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {r.filmstrip.map(f => (
                <figure key={f.timing} className="shrink-0 w-32 text-center">
                  <img src={f.data} alt={`Página a los ${ms(f.timing)}`} className="w-full rounded border border-slate-200 dark:border-slate-800" />
                  <figcaption className="text-[11px] text-slate-500 mt-1 tabular-nums">{ms(f.timing)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )
      )}
      <p className="text-[11px] text-slate-500"><Badge>Nota</Badge> La medición se hace desde {run.source === 'psi' ? 'los servidores de Google' : 'esta computadora y su conexión'}, no desde las ubicaciones de GTmetrix: compara mediciones de esta herramienta entre sí.</p>
    </div>
  );
}
