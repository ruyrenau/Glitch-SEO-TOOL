'use client';

import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { Badge, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

type Point = { date: string; p75: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null; good: number | null; ni: number | null; poor: number | null };
type History = { scope: 'url' | 'origin'; key: string; formFactor: string; metrics: Partial<Record<Metric, Point[]>> };
type Metric = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
type Res = { configured: boolean; origin: History | null; url: History | null };

const META: Record<Metric, { label: string; good: number; poor: number; unit: string; core: boolean }> = {
  LCP: { label: 'LCP · carga del contenido principal', good: 2500, poor: 4000, unit: 'ms', core: true },
  INP: { label: 'INP · respuesta al interactuar', good: 200, poor: 500, unit: 'ms', core: true },
  CLS: { label: 'CLS · estabilidad visual', good: 0.1, poor: 0.25, unit: '', core: true },
  FCP: { label: 'FCP · primer contenido', good: 1800, poor: 3000, unit: 'ms', core: false },
  TTFB: { label: 'TTFB · respuesta del servidor', good: 800, poor: 1800, unit: 'ms', core: false }
};
const RATING: Record<string, [string, 'good' | 'warn' | 'bad']> = { good: ['Bueno', 'good'], 'needs-improvement': ['Mejorable', 'warn'], poor: ['Malo', 'bad'] };
const val = (m: Metric, v: number | null) => (v === null ? '—' : m === 'CLS' ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** One metric over time: p75 line with the good / poor thresholds as reference lines. */
function Trend({ m, points }: { m: Metric; points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const meta = META[m];
  const W = 280;
  const H = 90;
  const pad = { l: 4, r: 4, t: 8, b: 4 };
  const vals = points.map(p => p.p75).filter((v): v is number => v !== null);
  const max = Math.max(meta.poor * 1.15, ...vals);
  const x = (i: number) => pad.l + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  // Break the line at weeks without data instead of bridging them.
  const segs: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.p75 === null) {
      if (cur) segs.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p75).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const last = [...points].reverse().find(p => p.p75 !== null) ?? null;
  const first = points.find(p => p.p75 !== null) ?? null;
  const shown = hover !== null ? points[hover] : last;
  const delta = first && last && first !== last && first.p75 ? (last.p75! - first.p75) / first.p75 : null;
  return (
    <figure className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1" aria-label={`${m}: tendencia de 28 días`}>
      <figcaption className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold">{meta.label}</span>
        {last?.rating && <Badge tone={RATING[last.rating][1]}>{RATING[last.rating][0]}</Badge>}
      </figcaption>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-black tabular-nums">{val(m, shown?.p75 ?? null)}</span>
        <span className="text-[11px] text-slate-500">p75 {hover !== null ? `al ${shown?.date}` : 'actual'}</span>
        {delta !== null && hover === null && <span className={`text-[11px] ${delta < 0 ? 'text-emerald-700 dark:text-emerald-400' : delta > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500'}`}>{delta < 0 ? '▼' : delta > 0 ? '▲' : ''} {Math.abs(Math.round(delta * 100))}% desde {first?.date}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[90px]" role="img" aria-label={`p75 de ${m} por semana, de ${points[0]?.date} a ${points[points.length - 1]?.date}`} onMouseLeave={() => setHover(null)}>
        {[meta.good, meta.poor].map((t, i) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" className="text-slate-500" />
            <text x={W - pad.r} y={y(t) - 2} textAnchor="end" fontSize="9" fill="currentColor" className="text-slate-500">{i ? 'malo' : 'bueno'} {val(m, t)}</text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.3} className="text-slate-500" />}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {shown?.p75 != null && <circle cx={x(points.indexOf(shown))} cy={y(shown.p75)} r={4} fill="#4f46e5" stroke="var(--card-bg, white)" strokeWidth={2} />}
        {points.map((p, i) => (
          <rect key={p.date} x={x(i) - W / points.length / 2} y={0} width={W / points.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)}>
            <title>{`${p.date}: ${val(m, p.p75)}`}</title>
          </rect>
        ))}
      </svg>
      {shown && shown.good !== null && (
        <p className="text-[11px] text-slate-500">Visitas: {pct(shown.good)} buenas · {pct(shown.ni)} mejorables · {pct(shown.poor)} malas</p>
      )}
    </figure>
  );
}

function HistoryBlock({ h, title }: { h: History; title: string }) {
  const metrics = (Object.keys(META) as Metric[]).filter(m => h.metrics[m]?.some(p => p.p75 !== null));
  const core = metrics.filter(m => META[m].core);
  const passes = core.length === 3 && core.every(m => [...h.metrics[m]!].reverse().find(p => p.p75 !== null)?.rating === 'good');
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="font-mono text-[11px] text-slate-500 break-all">{h.key}</span>
        {core.length === 3 && <Badge tone={passes ? 'good' : 'bad'}>{passes ? 'Aprueba Core Web Vitals' : 'No aprueba Core Web Vitals'}</Badge>}
      </div>
      <div className="grid md:grid-cols-3 gap-2">{metrics.map(m => <Trend key={m} m={m} points={h.metrics[m]!} />)}</div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">Ver como tabla</summary>
        <div className="overflow-auto">
          <table className="w-full text-left mt-1">
            <thead><tr className="text-slate-500"><th className="py-1">Semana (fin)</th>{metrics.map(m => <th key={m}>{m} p75</th>)}</tr></thead>
            <tbody>{h.metrics[metrics[0]]?.map((p, i) => <tr key={p.date}><td className="py-0.5 tabular-nums">{p.date}</td>{metrics.map(m => <td key={m} className="tabular-nums">{val(m, h.metrics[m]![i]?.p75 ?? null)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Real-user Core Web Vitals from the Chrome UX Report, with weekly history. */
export function CruxPanel({ siteId, urls }: { siteId: string; urls: string[] }) {
  const [form, setForm] = useState<'PHONE' | 'DESKTOP' | 'ALL'>('PHONE');
  const [url, setUrl] = useState('');
  const [d, setD] = useState<Res | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setD(null);
    setError(null);
    apiGet<Res>(`/api/v1/sites/${siteId}/crux?formFactor=${form}${url ? `&url=${encodeURIComponent(url)}` : ''}`).then(setD, setError);
  }, [siteId, form, url]);
  return (
    <Card title={<span className="flex items-center gap-2"><Users className="w-4 h-4" aria-hidden /> Datos reales de usuarios (CrUX)</span>}>
      <p className="text-xs text-slate-500 mb-3">Lo que viven los visitantes reales que usan Chrome, según el Chrome UX Report de Google. Es lo que Google usa para la señal de Core Web Vitals. Cada punto es el percentil 75 de los últimos 28 días, semana a semana. Los cambios tardan hasta 4 semanas en reflejarse por completo.</p>
      <div className="flex flex-wrap gap-2 items-end mb-3 text-xs">
        <label className="space-y-1"><span className="block font-semibold">Dispositivo</span>
          <select aria-label="Dispositivo" className={inputCls} value={form} onChange={e => setForm(e.target.value as typeof form)}><option value="PHONE">Celular</option><option value="DESKTOP">Escritorio</option><option value="ALL">Todos</option></select>
        </label>
        <label className="space-y-1 flex-1 min-w-[16rem]"><span className="block font-semibold">Página (opcional)</span>
          <select aria-label="Página para CrUX" className={`${inputCls} w-full`} value={url} onChange={e => setUrl(e.target.value)}>
            <option value="">Solo el sitio completo</option>
            {urls.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {!d ? !error && <Skeleton rows={3} /> : !d.configured ? (
        <Empty>Agrega PSI_API_KEY (o CRUX_API_KEY) en el archivo .env y habilita la "Chrome UX Report API" en tu proyecto de Google Cloud. Es gratis y usa la misma clave de PageSpeed.</Empty>
      ) : (
        <div className="space-y-5">
          {d.origin ? <HistoryBlock h={d.origin} title="Sitio completo" /> : <Empty>Google no tiene datos reales de este sitio: necesita suficientes visitas desde Chrome. Usa las mediciones de laboratorio de arriba.</Empty>}
          {url && (d.url ? <HistoryBlock h={d.url} title="Esta página" /> : <Empty>Esta página no tiene suficientes visitas en Chrome para tener datos propios; Google la evalúa con los del sitio completo.</Empty>)}
        </div>
      )}
    </Card>
  );
}
