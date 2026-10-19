'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FlaskConical, RefreshCw, Trash2 } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

type Stats = { days: number; clicks: number; impressions: number; ctr: number | null; position: number | null };
type Analysis = {
  before: { from: string; to: string };
  after: { from: string; to: string };
  daysAfter: number;
  test: { before: Stats; after: Stats };
  control: { before: Stats; after: Stats; kind: 'site' | 'pages' };
  effect: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  pValue: number | null;
  verdict: 'positive' | 'negative' | 'inconclusive' | 'waiting' | 'low_data';
  series: Array<{ date: string; test: number | null; control: number | null }>;
  pagesWithData: number;
};
type Experiment = { id: string; name: string; hypothesis: string | null; notes: string | null; changeDate: string; testUrls: string[]; controlUrls: string[]; windowDays: number; analysis: Analysis | null; analyzedAt: string | null; createdBy: { name: string | null; email: string } | null };

const VERDICT: Record<Analysis['verdict'], [string, 'good' | 'bad' | 'warn' | 'default', string]> = {
  positive: ['Funcionó', 'good', 'Las páginas cambiadas mejoraron más que el grupo de control, y la diferencia es estadísticamente significativa (p < 0.05).'],
  negative: ['Empeoró', 'bad', 'Las páginas cambiadas cayeron frente al grupo de control, y la diferencia es significativa. Considera revertir el cambio.'],
  inconclusive: ['Sin efecto claro', 'warn', 'La diferencia frente al control puede ser ruido. Espera más días o prueba con más páginas.'],
  waiting: ['Esperando datos', 'default', 'Hace falta al menos una semana de datos después del cambio (Search Console publica con 2–3 días de retraso).'],
  low_data: ['Poco tráfico', 'warn', 'Las páginas tienen muy pocos clics para sacar conclusiones. Usa páginas con más tráfico o mide impresiones y posición.']
};
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`);
const pos = (v: number | null) => (v === null ? '—' : v.toFixed(1));
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

/** Test vs control, 7-day rolling clicks indexed to the before-period (= 100). */
function IndexChart({ a, changeDate }: { a: Analysis; changeDate: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = a.series;
  if (pts.length < 2) return null;
  const W = 640;
  const H = 200;
  const pad = { l: 36, r: 64, t: 10, b: 22 };
  const vals = pts.flatMap(p => [p.test, p.control]).filter((v): v is number => v !== null);
  const lo = Math.min(80, ...vals);
  const hi = Math.max(120, ...vals);
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (k: 'test' | 'control') => pts.map((p, i) => (p[k] === null ? '' : `${i && pts[i - 1][k] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]!).toFixed(1)}`)).join('');
  const ci = pts.findIndex(p => p.date >= changeDate);
  const ticks = [lo, 100, hi].map(v => Math.round(v));
  const last = pts[pts.length - 1];
  const h = hover !== null ? pts[hover] : null;
  return (
    <figure className="space-y-1">
      <figcaption className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>Clics (promedio de 7 días), antes del cambio = 100</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-indigo-600" aria-hidden /> Páginas cambiadas</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-slate-400" aria-hidden /> Control</span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Clics indexados: páginas cambiadas terminan en ${last.test ?? '—'} y el control en ${last.control ?? '—'}`} onMouseLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 100 ? 0.35 : 0.12} strokeDasharray={t === 100 ? '4 3' : undefined} className="text-slate-500" />
              <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" className="text-slate-500">{t}</text>
            </g>
          ))}
          {ci > 0 && (
            <g>
              <line x1={x(ci)} x2={x(ci)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.5} className="text-slate-500" />
              <text x={x(ci) + 4} y={pad.t + 9} fontSize="10" fill="currentColor" className="text-slate-500">cambio {changeDate}</text>
            </g>
          )}
          <path d={line('control')} fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinejoin="round" />
          <path d={line('test')} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" />
          {last.test !== null && <text x={W - pad.r + 4} y={y(last.test) + 3} fontSize="10" fill="currentColor" className="text-slate-700 dark:text-slate-200">Cambiadas {Math.round(last.test)}</text>}
          {last.control !== null && <text x={W - pad.r + 4} y={y(last.control) + 3} fontSize="10" fill="currentColor" className="text-slate-500">Control {Math.round(last.control)}</text>}
          <text x={pad.l} y={H - 6} fontSize="10" fill="currentColor" className="text-slate-500">{pts[0].date}</text>
          <text x={W - pad.r} y={H - 6} fontSize="10" textAnchor="end" fill="currentColor" className="text-slate-500">{last.date}</text>
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.3} className="text-slate-500" />
              {h?.test != null && <circle cx={x(hover)} cy={y(h.test)} r={4} fill="#4f46e5" stroke="white" strokeWidth={2} />}
              {h?.control != null && <circle cx={x(hover)} cy={y(h.control)} r={4} fill="#94a3b8" stroke="white" strokeWidth={2} />}
            </g>
          )}
          {pts.map((p, i) => <rect key={p.date} x={x(i) - (W - pad.l - pad.r) / pts.length / 2} y={0} width={(W - pad.l - pad.r) / pts.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {h && (
          <div role="tooltip" className="absolute top-1 left-12 text-[11px] bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 shadow-sm pointer-events-none">
            <strong>{h.date}</strong> · Cambiadas {h.test ?? '—'} · Control {h.control ?? '—'}
          </div>
        )}
      </div>
    </figure>
  );
}

function ExperimentCard({ e, onChange, onError }: { e: Experiment; onChange: () => void; onError: (x: unknown) => void }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(e.notes ?? '');
  const a = e.analysis;
  const analyze = async () => {
    setBusy(true);
    onError(null);
    try {
      await apiSend('POST', `/api/v1/experiments/${e.id}/analyze`);
      onChange();
    } catch (x) {
      onError(x);
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, s: { before: Stats; after: Stats }, k: 'clicks' | 'impressions') => (
    <tr>
      <td className="py-1">{label}</td>
      <td className="tabular-nums">{fmt(Math.round(s.before[k] / Math.max(1, s.before.days)))}</td>
      <td className="tabular-nums">{fmt(Math.round(s.after[k] / Math.max(1, s.after.days)))}</td>
      <td className="tabular-nums">{pct(s.before.days && s.after.days && s.before[k] ? s.after[k] / s.after.days / (s.before[k] / s.before.days) - 1 : null)}</td>
    </tr>
  );
  return (
    <Card title={<span className="flex items-center gap-2">{e.name} {a && <Badge tone={VERDICT[a.verdict][1]}>{VERDICT[a.verdict][0]}</Badge>}</span>}>
      <div className="space-y-3 text-xs">
        <p className="text-slate-500">
          Cambio el {e.changeDate} · {e.testUrls.length} página(s) · control: {e.controlUrls.length ? `${e.controlUrls.length} página(s) elegidas` : 'el resto del sitio'} · ventana de {e.windowDays} días{e.createdBy ? ` · ${e.createdBy.name ?? e.createdBy.email}` : ''}
        </p>
        {e.hypothesis && <p><strong>Hipótesis:</strong> {e.hypothesis}</p>}
        <details>
          <summary className="cursor-pointer">Páginas cambiadas</summary>
          <ul className="font-mono text-[11px] mt-1">{e.testUrls.map(u => <li key={u}>{path(u)}</li>)}</ul>
        </details>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant={a ? 'secondary' : 'primary'} disabled={busy || !can('seo:operate')} onClick={analyze}><RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden /> {busy ? 'Consultando Search Console…' : a ? 'Actualizar resultados' : 'Analizar'}</Button>
          {e.analyzedAt && <span className="text-slate-500">Analizado {fmtDate(e.analyzedAt)}</span>}
        </div>
        {a && (
          <>
            <p className="text-slate-600 dark:text-slate-300">{VERDICT[a.verdict][2]}</p>
            <div className="grid md:grid-cols-4 gap-2">
              <Kpi label="Efecto neto en clics" value={pct(a.effect.clicks)} tone={a.verdict === 'positive' ? 'good' : a.verdict === 'negative' ? 'bad' : 'default'} hint="frente al control" />
              <Kpi label="Efecto en impresiones" value={pct(a.effect.impressions)} />
              <Kpi label="Efecto en CTR" value={pct(a.effect.ctr)} />
              <Kpi label="Cambio de posición" value={a.effect.position === null ? '—' : `${a.effect.position > 0 ? '+' : ''}${a.effect.position.toFixed(1)}`} hint="negativo = sube en Google" tone={a.effect.position !== null && a.effect.position < -0.3 ? 'good' : a.effect.position !== null && a.effect.position > 0.3 ? 'bad' : 'default'} />
            </div>
            <IndexChart a={a} changeDate={e.changeDate} />
            <table className="w-full text-left" aria-label="Antes y después por día">
              <thead><tr className="text-slate-500"><th className="py-1">Por día</th><th>Antes ({a.before.from} a {a.before.to})</th><th>Después ({a.daysAfter} días)</th><th>Cambio</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {row('Clics · páginas cambiadas', a.test, 'clicks')}
                {row(`Clics · control (${a.control.kind === 'site' ? 'resto del sitio' : 'páginas elegidas'})`, a.control, 'clicks')}
                {row('Impresiones · páginas cambiadas', a.test, 'impressions')}
                {row('Impresiones · control', a.control, 'impressions')}
                <tr><td className="py-1">Posición media · cambiadas</td><td>{pos(a.test.before.position)}</td><td>{pos(a.test.after.position)}</td><td /></tr>
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500">p = {a.pValue === null ? '—' : a.pValue < 0.001 ? '< 0.001' : a.pValue.toFixed(3)} · {a.pagesWithData} de {e.testUrls.length} páginas con datos en Search Console. El efecto neto descuenta lo que se movió el control (temporada, actualizaciones de Google).</p>
          </>
        )}
        <label className="block space-y-1">
          <span className="font-semibold">Notas</span>
          <textarea aria-label={`Notas de ${e.name}`} rows={2} className={`${inputCls} w-full`} value={notes} disabled={!can('seo:operate')} onChange={x => setNotes(x.target.value)} onBlur={() => notes !== (e.notes ?? '') && apiSend('PATCH', `/api/v1/experiments/${e.id}`, { notes: notes || null }).catch(onError)} />
        </label>
        {can('seo:operate') && (
          <button className="text-rose-600 flex items-center gap-1" onClick={() => confirm(`¿Borrar el experimento "${e.name}"?`) && apiSend('DELETE', `/api/v1/experiments/${e.id}`).then(onChange, onError)}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Borrar experimento
          </button>
        )}
      </div>
    </Card>
  );
}

/** Experimentos SEO: record a change and measure it in Search Console against a control group. */
export function ExperimentsView({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<{ gscReady: boolean; items: Experiment[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ name: '', hypothesis: '', changeDate: new Date().toISOString().slice(0, 10), testUrls: '', controlUrls: '', windowDays: 28 });
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => apiGet<typeof d>(`/api/v1/sites/${siteId}/experiments`).then(setD, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const create = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiSend('POST', `/api/v1/sites/${siteId}/experiments`, { name: form.name, hypothesis: form.hypothesis || null, changeDate: form.changeDate, testUrls: lines(form.testUrls), controlUrls: lines(form.controlUrls), windowDays: form.windowDays });
      setForm(f => ({ ...f, name: '', hypothesis: '', testUrls: '', controlUrls: '' }));
      await load();
    } catch (x) {
      setError(x);
    } finally {
      setSaving(false);
    }
  };
  if (!d) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center gap-2"><FlaskConical className="w-4 h-4" aria-hidden /> Nuevo experimento</span>}>
        <p className="text-xs text-slate-500 mb-3">Anota qué cambiaste, en qué páginas y cuándo. La herramienta compara los clics de Search Console antes y después contra un grupo de control (por defecto, el resto del sitio), así la temporada y las actualizaciones de Google no te engañan.</p>
        {!d.gscReady && <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">Para analizar necesitas Search Console conectado con la propiedad del sitio. <button className="underline" onClick={() => go('gsc')}>Ir a Search Console</button></p>}
        <form onSubmit={create} className="grid md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1"><span className="block font-semibold">Nombre</span><input required aria-label="Nombre del experimento" className={`${inputCls} w-full`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Precio en los títulos de servicios" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="block font-semibold">Fecha del cambio</span><input required type="date" aria-label="Fecha del cambio" max={new Date().toISOString().slice(0, 10)} className={`${inputCls} w-full`} value={form.changeDate} onChange={e => setForm({ ...form, changeDate: e.target.value })} /></label>
            <label className="space-y-1"><span className="block font-semibold">Ventana</span><select aria-label="Ventana" className={`${inputCls} w-full`} value={form.windowDays} onChange={e => setForm({ ...form, windowDays: Number(e.target.value) })}><option value={14}>14 días</option><option value={28}>28 días</option><option value={56}>56 días</option><option value={90}>90 días</option></select></label>
          </div>
          <label className="space-y-1 md:col-span-2"><span className="block font-semibold">Hipótesis (opcional)</span><input aria-label="Hipótesis" className={`${inputCls} w-full`} value={form.hypothesis} onChange={e => setForm({ ...form, hypothesis: e.target.value })} placeholder="Poner el precio en el título sube el CTR" /></label>
          <label className="space-y-1"><span className="block font-semibold">Páginas cambiadas (una por línea)</span><textarea required aria-label="Páginas cambiadas" rows={5} className={`${inputCls} w-full font-mono`} value={form.testUrls} onChange={e => setForm({ ...form, testUrls: e.target.value })} /></label>
          <label className="space-y-1"><span className="block font-semibold">Grupo de control (opcional)</span><textarea aria-label="Grupo de control" rows={5} className={`${inputCls} w-full font-mono`} value={form.controlUrls} onChange={e => setForm({ ...form, controlUrls: e.target.value })} placeholder="Vacío = el resto del sitio. Mejor: páginas parecidas que NO cambiaste." /></label>
          <div className="md:col-span-2"><Button type="submit" disabled={saving || !can('seo:operate')}>{saving ? 'Guardando…' : 'Guardar experimento'}</Button></div>
        </form>
      </Card>
      <ErrorBox error={error} />
      {!d.items.length ? <Empty>Todavía no hay experimentos. Guarda el primero cuando hagas un cambio (o anota uno que ya hiciste: puedes poner una fecha pasada).</Empty> : d.items.map(e => <ExperimentCard key={e.id + (e.analyzedAt ?? '')} e={e} onChange={load} onError={setError} />)}
    </div>
  );
}
