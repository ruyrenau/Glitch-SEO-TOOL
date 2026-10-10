'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Info, Loader2, Play, TrendingDown, TrendingUp } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

type Tone = 'bad' | 'warn' | 'good' | 'info';
interface Insight { id: string; tone: Tone; area: string; title: string; detail: string; related: string[]; link: { nav: string; explorer?: { tab: string; filter?: string } } | null }
interface MonitorEvent { date: string; kind: 'crawl' | 'alert' | 'change'; label: string; severity?: string }
interface Overview {
  site: { name: string; crawlSchedule: string | null; gscProperty: string | null };
  gsc: { importedAt: string | null; daily: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }> };
  crawl: Array<{ id: string; date: string; urls: number; indexable: number; errors4xx: number; errors5xx: number; issues: number; avgResponseMs: number; partial: boolean }>;
  vitals: Array<{ date: string; strategy: 'mobile' | 'desktop'; pages: number; score: number | null; labLcp: number | null; fieldLcp: number | null; fieldInp: number | null; fieldCls: number | null }>;
  events: MonitorEvent[];
  insights: Insight[];
}
interface State {
  crawl: { enabled: boolean; frequency: string | null; nextRuns: string[]; maxUrls: number };
  gsc: { enabled: boolean; configured: boolean; connected: boolean; property: string | null };
  vitals: { enabled: boolean; frequency: string | null; nextRuns: string[]; urlMode: 'top' | 'manual'; urls: string[]; count: number; strategies: Array<'mobile' | 'desktop'>; willMeasure: string[]; source: string };
}

// ---------------------------------------------------------------- chart
// One y-axis per chart (two measures of different scale go in two charts). Colors validated for CVD in both themes.
const SERIES = ['stroke-indigo-600 dark:stroke-indigo-500', 'stroke-teal-600 dark:stroke-teal-600'];
const SWATCH = ['bg-indigo-600 dark:bg-indigo-500', 'bg-teal-600'];
type Pt = { x: number; y: number | null };
const fmtNum = (v: number, unit?: string) => (unit === 'ms' ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) : unit === 'pos' ? v.toFixed(1) : fmt(Math.round(v)));

function TimeChart({ title, series, events, unit, invert }: { title: string; series: Array<{ label: string; points: Pt[] }>; events: MonitorEvent[]; unit?: 'ms' | 'pos'; invert?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap(s => s.points).filter(p => p.y !== null) as Array<{ x: number; y: number }>;
  if (all.length < 2) return <figure className="text-xs"><figcaption className="font-semibold mb-1">{title}</figcaption><p className="text-slate-500 py-6">Aún no hay suficientes datos.</p></figure>;
  const W = 600;
  const H = 150;
  const pad = { l: 44, r: 12, t: 8, b: 20 };
  const xs = all.map(p => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ys = all.map(p => p.y);
  const yMin = unit === 'pos' ? Math.min(...ys) : 0;
  const yMax = Math.max(...ys) * 1.08 || 1;
  const sx = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => (invert ? pad.t + ((y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - pad.t - pad.b) : H - pad.b - ((y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - pad.t - pad.b));
  const ticks = [0, 0.5, 1].map(f => yMin + (yMax - yMin) * f);
  const xsUnique = [...new Set(xs)].sort((a, b) => a - b);
  const evs = events.filter(e => e.kind !== 'crawl').map(e => ({ ...e, x: +new Date(e.date) })).filter(e => e.x >= x0 && e.x <= x1);
  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = xsUnique[0];
    for (const x of xsUnique) if (Math.abs(sx(x) - px) < Math.abs(sx(best) - px)) best = x;
    setHover(best);
  };
  const hovered = hover !== null ? series.map(s => ({ label: s.label, y: s.points.find(p => p.x === hover)?.y ?? null })) : [];
  const hoverEvents = hover !== null ? evs.filter(e => Math.abs(e.x - hover) < 86400_000 * 1.5) : [];
  return (
    <figure className="text-xs space-y-1">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {series.length > 1 && (
          <span className="flex gap-3 text-slate-600 dark:text-slate-300">
            {series.map((s, i) => <span key={s.label} className="flex items-center gap-1"><span className={`inline-block w-3 h-0.5 ${SWATCH[i]}`} />{s.label}</span>)}
          </span>
        )}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 overflow-visible" role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
              <text x={pad.l - 6} y={sy(t) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">{fmtNum(t, unit)}</text>
            </g>
          ))}
          <text x={pad.l} y={H - 4} className="fill-slate-500 text-[10px]">{new Date(x0).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</text>
          <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-slate-500 text-[10px]">{new Date(x1).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</text>
          {evs.map((e, i) => (
            <g key={i}>
              <line x1={sx(e.x)} x2={sx(e.x)} y1={pad.t} y2={H - pad.b} strokeDasharray="3 3" strokeWidth="1" className={e.kind === 'alert' ? 'stroke-rose-500' : 'stroke-emerald-500'} />
              <text x={sx(e.x)} y={pad.t + 8} textAnchor="middle" className={`text-[10px] font-bold ${e.kind === 'alert' ? 'fill-rose-500' : 'fill-emerald-600'}`}>{e.kind === 'alert' ? '!' : '✓'}</text>
            </g>
          ))}
          {series.map((s, i) => {
            const pts = s.points.filter(p => p.y !== null) as Array<{ x: number; y: number }>;
            return (
              <g key={s.label}>
                <polyline fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className={SERIES[i]} points={pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
                {pts.length <= 25 && pts.map(p => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r="3" className={`${SERIES[i]} fill-white dark:fill-[#151824]`} strokeWidth="2" />)}
              </g>
            );
          })}
          {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} className="stroke-slate-400" strokeWidth="1" />}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151824] shadow p-2 text-[11px] space-y-0.5 max-w-xs" style={{ left: `min(calc(${(sx(hover) / W) * 100}% + 8px), calc(100% - 14rem))` }}>
            <div className="font-semibold">{new Date(hover).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
            {hovered.map((h, i) => <div key={h.label} className="flex items-center gap-1.5"><span className={`inline-block w-2 h-2 rounded-sm ${SWATCH[i]}`} />{h.label}: <strong className="tabular-nums">{h.y === null ? '—' : fmtNum(h.y, unit)}</strong></div>)}
            {hoverEvents.map((e, i) => <div key={i} className={e.kind === 'alert' ? 'text-rose-600' : 'text-emerald-600'}>{e.kind === 'alert' ? '! ' : '✓ '}{e.label}</div>)}
          </div>
        )}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- view
const TONE: Record<Tone, { icon: React.ComponentType<{ className?: string }>; badge: 'bad' | 'warn' | 'good' | 'default'; label: string; ring: string }> = {
  bad: { icon: TrendingDown, badge: 'bad', label: 'Atención', ring: 'border-rose-500/40' },
  warn: { icon: AlertTriangle, badge: 'warn', label: 'Revisar', ring: 'border-amber-500/40' },
  good: { icon: TrendingUp, badge: 'good', label: 'Mejora', ring: 'border-emerald-500/40' },
  info: { icon: Info, badge: 'default', label: 'Contexto', ring: 'border-slate-200 dark:border-slate-800' }
};

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative w-10 h-6 rounded-full transition shrink-0 disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export function MonitorView({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<State | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualUrls, setManualUrls] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([apiGet<State>(`/api/v1/sites/${siteId}/monitor`), apiGet<Overview>(`/api/v1/sites/${siteId}/monitor/overview`)]);
      setState(s);
      setDraft(s);
      setManualUrls(s.vitals.urls.join('\n'));
      setOv(o);
    } catch (e) {
      setError(e);
    }
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(state) || manualUrls !== (state?.vitals.urls ?? []).join('\n'), [draft, state, manualUrls]);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const s = await apiSend<State>('PUT', `/api/v1/sites/${siteId}/monitor`, {
        crawl: { enabled: draft.crawl.enabled, frequency: draft.crawl.frequency === 'daily' ? 'daily' : 'weekly', maxUrls: draft.crawl.maxUrls },
        gsc: { enabled: draft.gsc.enabled },
        vitals: { enabled: draft.vitals.enabled, frequency: draft.vitals.frequency === 'daily' ? 'daily' : 'weekly', urlMode: draft.vitals.urlMode, urls: draft.vitals.urlMode === 'manual' ? manualUrls.split(/\s+/).filter(Boolean) : [], count: draft.vitals.count, strategies: draft.vitals.strategies }
      });
      setState(s);
      setDraft(s);
      setMsg('Guardado.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await apiSend<{ queued: Record<string, string> }>('POST', `/api/v1/sites/${siteId}/monitor/run`, {});
      const names: Record<string, string> = { crawl: 'crawl', gsc: 'importación de Search Console', vitals: 'medición de Core Web Vitals' };
      setMsg(`En marcha: ${Object.keys(r.queued).map(k => names[k]).join(', ')}. Los resultados aparecerán aquí al terminar (puedes seguir en "Jobs y automatizaciones").`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!state || !draft) return error ? <ErrorBox error={error} /> : <Skeleton rows={6} />;
  const set = <K extends keyof State>(k: K, v: Partial<State[K]>) => setDraft(d => (d ? { ...d, [k]: { ...d[k], ...v } } : d));
  const canEdit = can('seo:operate');
  const activeCount = [state.crawl.enabled, state.gsc.enabled, state.vitals.enabled].filter(Boolean).length;

  const gscEvents = ov?.events ?? [];
  const day = (d: string) => +new Date(`${d}T12:00:00`);
  const bad = ov?.insights.filter(i => i.tone === 'bad').length ?? 0;
  const warn = ov?.insights.filter(i => i.tone === 'warn').length ?? 0;
  const good = ov?.insights.filter(i => i.tone === 'good').length ?? 0;
  const vit = (s: 'mobile' | 'desktop') => (ov?.vitals ?? []).filter(v => v.strategy === s);

  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden /> Qué se ejecuta automáticamente</span>}>
        <p className="text-xs text-slate-500 mb-4">Todo está apagado hasta que lo actives. Lo programado corre mientras la herramienta esté encendida; si estaba apagada, se ejecuta al volver a abrirla.</p>
        <div className="space-y-3 text-xs">
          {/* Crawl */}
          <div className="flex flex-wrap items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <Switch checked={draft.crawl.enabled} onChange={v => set('crawl', { enabled: v })} label="Crawl automático" disabled={!canEdit} />
            <div className="flex-1 min-w-[16rem] space-y-1">
              <div className="font-semibold text-sm">Crawl</div>
              <p className="text-slate-500">Recorre el sitio y detecta páginas rotas, noindex, cambios de títulos o canonicals. Compara cada crawl con el anterior y genera alertas.</p>
              {state.crawl.enabled && state.crawl.nextRuns[0] && <p className="text-slate-500">Próximo: {fmtDate(state.crawl.nextRuns[0])}</p>}
            </div>
            <label className="space-y-1"><span className="block font-semibold">Frecuencia</span>
              <select aria-label="Frecuencia del crawl" className={inputCls} disabled={!draft.crawl.enabled} value={draft.crawl.frequency === 'daily' ? 'daily' : 'weekly'} onChange={e => set('crawl', { frequency: e.target.value })}>
                <option value="weekly">Semanal (lunes 3:00)</option><option value="daily">Diario (3:00)</option>
              </select>
            </label>
            <label className="space-y-1"><span className="block font-semibold">Máx. URLs</span>
              <select aria-label="Máximo de URLs del crawl automático" className={inputCls} disabled={!draft.crawl.enabled} value={draft.crawl.maxUrls} onChange={e => set('crawl', { maxUrls: Number(e.target.value) })}>
                {[500, 1000, 2500, 5000, 10000].map(n => <option key={n} value={n}>{n.toLocaleString('es-MX')}</option>)}
              </select>
            </label>
          </div>
          {/* Search Console */}
          <div className="flex flex-wrap items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <Switch checked={draft.gsc.enabled} onChange={v => set('gsc', { enabled: v })} label="Importación diaria de Search Console" disabled={!canEdit || !state.gsc.property} />
            <div className="flex-1 min-w-[16rem] space-y-1">
              <div className="font-semibold text-sm">Search Console</div>
              <p className="text-slate-500">Importa cada mañana clics, impresiones y posición de los últimos 3 meses.</p>
              {!state.gsc.property && (
                <p className="text-amber-700 dark:text-amber-400">Primero conecta tu cuenta de Google y elige la propiedad de este sitio. <button className="underline" onClick={() => go('gsc')}>Ir a Search Console</button></p>
              )}
            </div>
            <span className="text-slate-500 self-center">Diario (6:15)</span>
          </div>
          {/* Core Web Vitals */}
          <div className="flex flex-wrap items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <Switch checked={draft.vitals.enabled} onChange={v => set('vitals', { enabled: v })} label="Core Web Vitals automático" disabled={!canEdit} />
            <div className="flex-1 min-w-[16rem] space-y-2">
              <div className="font-semibold text-sm">Core Web Vitals</div>
              <p className="text-slate-500">Mide la velocidad de las páginas importantes con {state.vitals.source === 'psi' ? 'PageSpeed Insights (incluye usuarios reales)' : 'Lighthouse en esta computadora'} y avisa si alguna empeora.</p>
              <div className="flex flex-wrap gap-3 items-end">
                <label className="space-y-1"><span className="block font-semibold">Qué páginas</span>
                  <select aria-label="Qué páginas medir" className={inputCls} disabled={!draft.vitals.enabled} value={draft.vitals.urlMode} onChange={e => set('vitals', { urlMode: e.target.value as 'top' | 'manual' })}>
                    <option value="top">Las de más clics en Search Console</option><option value="manual">Las que yo elija</option>
                  </select>
                </label>
                {draft.vitals.urlMode === 'top' && (
                  <label className="space-y-1"><span className="block font-semibold">Cuántas</span>
                    <select aria-label="Cuántas páginas medir" className={inputCls} disabled={!draft.vitals.enabled} value={draft.vitals.count} onChange={e => set('vitals', { count: Number(e.target.value) })}>
                      {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                <fieldset className="flex gap-3 pb-2"><legend className="sr-only">Dispositivos</legend>
                  {(['mobile', 'desktop'] as const).map(s => (
                    <label key={s} className="flex items-center gap-1.5"><input type="checkbox" disabled={!draft.vitals.enabled} checked={draft.vitals.strategies.includes(s)} onChange={e => set('vitals', { strategies: e.target.checked ? [...new Set([...draft.vitals.strategies, s])] : draft.vitals.strategies.filter(x => x !== s) })} />{s === 'mobile' ? 'Móvil' : 'Escritorio'}</label>
                  ))}
                </fieldset>
              </div>
              {draft.vitals.urlMode === 'manual' && <textarea aria-label="URLs a medir" rows={3} className={`${inputCls} w-full font-mono`} disabled={!draft.vitals.enabled} placeholder="Una URL por línea (máximo 20)" value={manualUrls} onChange={e => setManualUrls(e.target.value)} />}
              {draft.vitals.urlMode === 'top' && <p className="text-slate-500">Ahora se medirían: <span className="font-mono">{state.vitals.willMeasure.map(u => { try { return new URL(u).pathname; } catch { return u; } }).join(', ')}</span></p>}
              {state.vitals.enabled && state.vitals.nextRuns[0] && <p className="text-slate-500">Próxima medición: {fmtDate(state.vitals.nextRuns[0])} · {draft.vitals.strategies.length * (draft.vitals.urlMode === 'manual' ? manualUrls.split(/\s+/).filter(Boolean).length : draft.vitals.count)} mediciones</p>}
            </div>
            <label className="space-y-1"><span className="block font-semibold">Frecuencia</span>
              <select aria-label="Frecuencia de Core Web Vitals" className={inputCls} disabled={!draft.vitals.enabled} value={draft.vitals.frequency === 'daily' ? 'daily' : 'weekly'} onChange={e => set('vitals', { frequency: e.target.value })}>
                <option value="weekly">Semanal (lunes 5:00)</option><option value="daily">Diario (5:00)</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 text-xs">
          <Button disabled={!canEdit || !dirty || busy} onClick={save}>Guardar</Button>
          <Button variant="secondary" disabled={!canEdit || busy || !activeCount || dirty} onClick={runNow} title={dirty ? 'Guarda primero los cambios' : undefined}><Play className="w-3.5 h-3.5" aria-hidden /> Ejecutar ahora lo activo</Button>
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
          {msg && <span role="status" className="text-emerald-700 dark:text-emerald-400">{msg}</span>}
          {!canEdit && <span className="text-slate-500">Tu rol puede ver, pero no cambiar la configuración.</span>}
        </div>
        <div className="mt-2"><ErrorBox error={error} /></div>
      </Card>

      <Card title="Análisis de cambios">
        {!ov ? <Skeleton rows={4} /> : !ov.insights.length ? (
          <Empty>{activeCount || ov.crawl.length || ov.gsc.daily.length ? 'Sin cambios relevantes: todo se movió dentro de lo normal para este sitio.' : 'Activa al menos una automatización (o haz un crawl e importa Search Console) para empezar a ver la evolución.'}</Empty>
        ) : (
          <>
            <p className="text-sm mb-3">
              {bad + warn ? <><strong>{bad + warn} {bad + warn === 1 ? 'cosa a revisar' : 'cosas a revisar'}</strong>{good ? ` y ${good} ${good === 1 ? 'mejora' : 'mejoras'}` : ''}.</> : <><CheckCircle2 className="inline w-4 h-4 text-emerald-500" aria-hidden /> Nada preocupante{good ? `, ${good} ${good === 1 ? 'mejora' : 'mejoras'}` : ''}.</>}
              <span className="text-xs text-slate-500"> Solo se marcan los cambios más grandes que la variación normal del sitio. Lo de "Al mismo tiempo" es contexto, no una causa comprobada.</span>
            </p>
            <ul className="space-y-2">
              {ov.insights.map((i, idx) => {
                // The same context under every item is noise: show it once, then refer back to it.
                const seenBefore = i.related.length > 0 && ov.insights.slice(0, idx).some(p => JSON.stringify(p.related) === JSON.stringify(i.related));
                const t = TONE[i.tone];
                const Icon = t.icon;
                return (
                  <li key={i.id} className={`p-3 rounded-xl border ${t.ring} text-xs space-y-1.5`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="w-4 h-4" aria-hidden />
                      <Badge tone={t.badge}>{t.label}</Badge>
                      <span className="font-semibold text-sm">{i.title}</span>
                      {i.link && <button className="ml-auto inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => go(i.link!.nav, i.link!.explorer)}>Ver detalle <ArrowRight className="w-3 h-3" aria-hidden /></button>}
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{i.detail}</p>
                    {seenBefore && <p className="text-slate-500 italic">Al mismo tiempo: lo mismo que arriba.</p>}
                    {i.related.length > 0 && !seenBefore && (
                      <div className="text-slate-500"><span className="font-semibold">Al mismo tiempo:</span>
                        <ul className="list-disc ml-5">{i.related.slice(0, 5).map(r => <li key={r}>{r}</li>)}</ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {ov && (
        <Card title="Evolución">
          <p className="text-xs text-slate-500 mb-4"><span className="text-rose-500 font-bold">!</span> alerta · <span className="text-emerald-600 font-bold">✓</span> cambio SEO aplicado. Pasa el mouse por las gráficas para ver cada día.</p>
          <div className="grid lg:grid-cols-2 gap-6">
            <TimeChart title="Clics (Search Console)" series={[{ label: 'Clics', points: ov.gsc.daily.map(d => ({ x: day(d.date), y: d.clicks })) }]} events={gscEvents} />
            <TimeChart title="Impresiones (Search Console)" series={[{ label: 'Impresiones', points: ov.gsc.daily.map(d => ({ x: day(d.date), y: d.impressions })) }]} events={gscEvents} />
            <TimeChart title="Posición media (más arriba es mejor)" unit="pos" invert series={[{ label: 'Posición', points: ov.gsc.daily.map(d => ({ x: day(d.date), y: d.position || null })) }]} events={gscEvents} />
            <TimeChart title="Páginas indexables por crawl" series={[{ label: 'Indexables', points: ov.crawl.map(c => ({ x: +new Date(c.date), y: c.indexable })) }]} events={gscEvents} />
            <TimeChart title="Páginas con error por crawl" series={[{ label: '4xx', points: ov.crawl.map(c => ({ x: +new Date(c.date), y: c.errors4xx })) }, { label: '5xx', points: ov.crawl.map(c => ({ x: +new Date(c.date), y: c.errors5xx })) }]} events={gscEvents} />
            <TimeChart title="LCP mediano (usuarios reales si hay; si no, laboratorio)" unit="ms" series={[{ label: 'Móvil', points: vit('mobile').map(v => ({ x: day(v.date), y: v.fieldLcp ?? v.labLcp })) }, { label: 'Escritorio', points: vit('desktop').map(v => ({ x: day(v.date), y: v.fieldLcp ?? v.labLcp })) }]} events={gscEvents} />
          </div>
          {ov.gsc.importedAt && <p className="text-[11px] text-slate-500 mt-3">Search Console importado {fmtDate(ov.gsc.importedAt)} (Google publica con 2–3 días de retraso).</p>}
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer font-semibold">Ver los datos en tabla</summary>
            <div className="overflow-auto max-h-72 mt-2">
              <table className="w-full text-left">
                <thead><tr className="text-slate-500"><th className="py-1">Crawl</th><th className="text-right">URLs</th><th className="text-right">Indexables</th><th className="text-right">4xx</th><th className="text-right">5xx</th><th className="text-right">Issues</th><th className="text-right">Resp. media</th></tr></thead>
                <tbody>{ov.crawl.slice().reverse().map(c => <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1">{fmtDate(c.date)}{c.partial ? ' (parcial)' : ''}</td><td className="text-right tabular-nums">{fmt(c.urls)}</td><td className="text-right tabular-nums">{fmt(c.indexable)}</td><td className="text-right tabular-nums">{fmt(c.errors4xx)}</td><td className="text-right tabular-nums">{fmt(c.errors5xx)}</td><td className="text-right tabular-nums">{fmt(c.issues)}</td><td className="text-right tabular-nums">{c.avgResponseMs} ms</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </Card>
      )}

      {ov && ov.events.length > 0 && (
        <Card title="Qué pasó y cuándo">
          <ul className="text-xs space-y-1 max-h-72 overflow-auto">
            {ov.events.slice().reverse().map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-500 tabular-nums shrink-0 w-32">{fmtDate(e.date)}</span>
                <span className={e.kind === 'alert' ? 'text-rose-600' : e.kind === 'change' ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-300'}>{e.kind === 'alert' ? '! ' : e.kind === 'change' ? '✓ ' : '• '}{e.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
