'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, Play } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

type Rating = 'good' | 'needs-improvement' | 'poor';
interface FieldMetric { p75: number; rating: Rating | null; distribution: [number, number, number] }
interface Run {
  id: string;
  url: string;
  finalUrl: string | null;
  strategy: 'mobile' | 'desktop';
  source: 'psi' | 'lighthouse-local';
  status: 'ok' | 'failed';
  error: string | null;
  performanceScore: number | null;
  lab: { LCP: number | null; CLS: number | null; TBT: number | null; FCP: number | null; SI: number | null; TTFB: number | null } | null;
  fieldStatus: 'available' | 'insufficient-data' | 'not-requested';
  fieldScope: 'url' | 'origin' | null;
  field: { collectionPeriod: { firstDate: string; lastDate: string } | null; metrics: Partial<Record<'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB', FieldMetric>> } | null;
  diagnostics: Array<{ id: string; title: string; score: number | null; displayValue: string | null; savingsMs: number | null; savingsBytes: number | null; items: number }> | null;
  resources: { totalBytes: number | null; requests: number | null } | null;
  lighthouseVersion: string | null;
  createdAt: string;
}
interface Item { latest: Run; history: Array<{ id: string; createdAt: string; status: string; performanceScore: number | null; labLcp: number | null; fieldLcp: number | null }> }

const T = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800], TBT: [200, 600], SI: [3400, 5800] } as const;
const rate = (k: keyof typeof T, v: number | null | undefined): Rating | null => (v === null || v === undefined ? null : v <= T[k][0] ? 'good' : v <= T[k][1] ? 'needs-improvement' : 'poor');
const RATING: Record<Rating, { label: string; tone: 'good' | 'warn' | 'bad' }> = { good: { label: 'Bueno', tone: 'good' }, 'needs-improvement': { label: 'Mejorable', tone: 'warn' }, poor: { label: 'Deficiente', tone: 'bad' } };
const show = (k: string, v: number | null | undefined) => (v === null || v === undefined ? '—' : k === 'CLS' ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const NAMES: Record<string, string> = { LCP: 'Largest Contentful Paint', INP: 'Interaction to Next Paint', CLS: 'Cumulative Layout Shift', FCP: 'First Contentful Paint', TTFB: 'Time to First Byte', TBT: 'Total Blocking Time', SI: 'Speed Index' };

function Metric({ k, v, extra }: { k: keyof typeof T; v: number | null | undefined; extra?: React.ReactNode }) {
  const r = rate(k, v);
  return (
    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
      <div className="text-[11px] text-slate-500" title={NAMES[k]}>{k}</div>
      <div className="text-lg font-black tabular-nums">{show(k, v)}</div>
      {r ? <Badge tone={RATING[r].tone}>{RATING[r].label}</Badge> : <span className="text-[11px] text-slate-400">sin dato</span>}
      {extra}
    </div>
  );
}

function RunDetail({ run }: { run: Run }) {
  if (run.status === 'failed') return <p className="text-xs text-rose-700 dark:text-rose-300">La medición falló: {run.error}</p>;
  const f = run.field;
  return (
    <div className="space-y-4 text-xs">
      <section aria-label="Datos de campo">
        <h4 className="font-semibold mb-1">Usuarios reales (CrUX, percentil 75, últimos 28 días)</h4>
        {run.fieldStatus === 'available' && f ? (
          <>
            <p className="text-slate-500 mb-2">
              {run.fieldScope === 'origin' ? 'Esta URL no tiene suficiente tráfico: se muestran datos de todo el sitio (origen).' : 'Datos de esta URL.'}
              {f.collectionPeriod && ` Periodo ${f.collectionPeriod.firstDate} → ${f.collectionPeriod.lastDate}.`}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const).map(k => (
                <Metric key={k} k={k} v={f.metrics[k]?.p75} extra={f.metrics[k] && <div className="text-[10px] text-slate-500 mt-1">{Math.round(f.metrics[k]!.distribution[0] * 100)}% visitas buenas</div>} />
              ))}
            </div>
          </>
        ) : (
          <Empty>
            {run.fieldStatus === 'insufficient-data'
              ? 'Datos insuficientes: Chrome no tiene suficientes visitas reales de esta URL ni del sitio para publicar métricas.'
              : 'Sin datos de campo: esta medición usó Lighthouse local. Configura PSI_API_KEY para obtener datos de usuarios reales (CrUX).'}
          </Empty>
        )}
      </section>

      <section aria-label="Datos de laboratorio">
        <h4 className="font-semibold mb-1">
          Laboratorio (simulado) · score {run.performanceScore ?? '—'}/100 · {run.source === 'psi' ? 'Lighthouse de PageSpeed Insights' : 'Lighthouse local'} {run.lighthouseVersion}
        </h4>
        <p className="text-slate-500 mb-2">Una carga simulada con red y CPU limitadas. Sirve para diagnosticar; no es lo que viven tus usuarios. INP no existe en laboratorio: TBT es su aproximación.</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {(['LCP', 'CLS', 'TBT', 'FCP', 'SI', 'TTFB'] as const).map(k => <Metric key={k} k={k} v={run.lab?.[k]} />)}
        </div>
        {run.resources && <p className="text-slate-500 mt-2">Peso total {run.resources.totalBytes !== null ? `${(run.resources.totalBytes / 1024).toFixed(0)} KB` : '—'} · {fmt(run.resources.requests)} solicitudes</p>}
      </section>

      {!!run.diagnostics?.length && (
        <section aria-label="Diagnósticos">
          <h4 className="font-semibold mb-1">Qué mejorar</h4>
          <ul className="space-y-1">
            {run.diagnostics.filter(d => d.score !== null && d.score < 0.9).map(d => (
              <li key={d.id} className="flex flex-wrap gap-2 items-center">
                <Badge tone={d.score === 0 ? 'bad' : 'warn'}>{d.score === 0 ? 'falla' : 'mejorable'}</Badge>
                <span>{d.title}</span>
                <span className="text-slate-500">
                  {[d.displayValue, d.savingsMs ? `ahorro ~${Math.round(d.savingsMs)} ms` : null, d.savingsBytes ? `~${Math.round(d.savingsBytes / 1024)} KB` : null, d.items ? `${d.items} elementos` : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
            {!run.diagnostics.some(d => d.score !== null && d.score < 0.9) && <li className="text-emerald-700 dark:text-emerald-400">Sin problemas relevantes en las auditorías revisadas.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}

export function PerformanceView({ siteId }: { siteId: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<{ config: { psiConfigured: boolean; source: string }; items: Item[] } | null>(null);
  const [candidates, setCandidates] = useState<Array<{ url: string; title: string | null }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState('');
  const [strategies, setStrategies] = useState<Set<'mobile' | 'desktop'>>(new Set(['mobile']));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<Record<string, 'mobile' | 'desktop'>>({});

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([apiGet<typeof data>(`/api/v1/sites/${siteId}/performance`), apiGet<Array<{ url: string; title: string | null }>>(`/api/v1/sites/${siteId}/performance/candidates`)]);
      setData(d);
      setCandidates(c);
      setPicked(p => (p.size ? p : new Set(c.slice(0, 3).map(x => x.url))));
    } catch (err) {
      setError(err);
    }
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const urls = [...picked, ...custom.split('\n').map(s => s.trim()).filter(Boolean)];
      const r = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/performance`, { urls, strategies: [...strategies] });
      const job = await waitForJob<JobRow>(r.jobId, j => {
        const d = j.progressDetail as { done?: number; total?: number; current?: string } | null;
        setStatus(j.status === 'QUEUED' ? 'En cola, esperando al worker…' : `Midiendo ${(d?.done ?? 0) + 1} de ${d?.total ?? '?'}: ${d?.current ?? ''}`);
      }, 2000);
      setStatus(job.status === 'COMPLETED' ? `✓ ${(job.result as { measured: number }).measured} mediciones guardadas.` : `La medición terminó con estado ${job.status}: ${job.error ?? ''}`);
      await load();
    } catch (err) {
      setError(err);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  const byUrl = new Map<string, Partial<Record<'mobile' | 'desktop', Item>>>();
  for (const it of data?.items ?? []) {
    const e = byUrl.get(it.latest.url) ?? {};
    e[it.latest.strategy] = it;
    byUrl.set(it.latest.url, e);
  }

  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center gap-2"><Gauge className="w-4 h-4" aria-hidden /> Medir Core Web Vitals</span>}>
        {data && (
          <p className="text-xs mb-4 text-slate-600 dark:text-slate-400">
            {data.config.psiConfigured ? (
              <>Fuente: <strong>PageSpeed Insights</strong>: datos de usuarios reales (CrUX) cuando existen, más una prueba de laboratorio de Google.</>
            ) : (
              <>
                Fuente: <strong>Lighthouse local</strong> (solo laboratorio, ~20 s por URL). Para datos de usuarios reales, crea una API key gratuita de PageSpeed Insights en Google Cloud y defínela como{' '}
                <code className="font-mono">PSI_API_KEY</code> en el servidor.
              </>
            )}
          </p>
        )}
        <form onSubmit={run} className="space-y-3 text-xs">
          <fieldset>
            <legend className="font-semibold mb-1">URLs (portada y páginas más enlazadas del último crawl)</legend>
            <div className="space-y-1">
              {candidates.map(c => (
                <label key={c.url} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.has(c.url)} onChange={() => setPicked(p => toggle(p, c.url))} />
                  <span className="font-mono text-[11px] break-all">{c.url}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block font-semibold space-y-1">
            <span>Otras URLs del sitio (una por línea)</span>
            <textarea rows={2} className={`${inputCls} font-mono`} value={custom} onChange={e => setCustom(e.target.value)} />
          </label>
          <fieldset className="flex gap-4">
            <legend className="sr-only">Dispositivos</legend>
            {(['mobile', 'desktop'] as const).map(s => (
              <label key={s} className="flex items-center gap-2">
                <input type="checkbox" checked={strategies.has(s)} onChange={() => setStrategies(p => toggle(p, s))} /> {s === 'mobile' ? 'Móvil' : 'Escritorio'}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={busy || !can('seo:operate') || !strategies.size || (!picked.size && !custom.trim())}><Play className="w-3.5 h-3.5" aria-hidden /> Medir</Button>
          {status && <p role="status" className="text-indigo-700 dark:text-indigo-300">{status}</p>}
          <ErrorBox error={error} />
        </form>
      </Card>

      {!data ? (
        <Skeleton rows={4} />
      ) : !byUrl.size ? (
        <Empty>Aún no hay mediciones para este sitio.</Empty>
      ) : (
        [...byUrl.entries()].map(([url, entries]) => {
          const strat = view[url] ?? (entries.mobile ? 'mobile' : 'desktop');
          const it = entries[strat] ?? entries.mobile ?? entries.desktop!;
          return (
            <Card
              key={url}
              title={<span className="font-mono text-xs break-all">{url}</span>}
              actions={
                <div role="tablist" aria-label="Dispositivo" className="flex gap-1">
                  {(['mobile', 'desktop'] as const).filter(s => entries[s]).map(s => (
                    <button key={s} role="tab" aria-selected={strat === s} onClick={() => setView(v => ({ ...v, [url]: s }))} className={`px-2 py-1 rounded-lg text-[11px] border ${strat === s ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`}>
                      {s === 'mobile' ? 'Móvil' : 'Escritorio'}
                    </button>
                  ))}
                </div>
              }
            >
              <p className="text-[11px] text-slate-500 mb-3">Medido {fmtDate(it.latest.createdAt)}</p>
              <RunDetail run={it.latest} />
              {it.history.length > 1 && (
                <div className="mt-4 text-xs">
                  <h4 className="font-semibold mb-1">Historial ({it.history.length} mediciones)</h4>
                  <ul className="flex flex-wrap gap-2">
                    {it.history.map(h => (
                      <li key={h.id} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 tabular-nums" title={fmtDate(h.createdAt)}>
                        {new Date(h.createdAt).toLocaleDateString('es-MX')}: {h.status === 'ok' ? `score ${h.performanceScore ?? '—'} · LCP ${show('LCP', h.fieldLcp ?? h.labLcp)}` : 'falló'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
