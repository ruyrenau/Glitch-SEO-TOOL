'use client';

import React, { useEffect, useState } from 'react';
import { TimeChart } from './MonitorView';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Snap = any;

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: d }));
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const TONE: Record<string, [string, string]> = { bad: ['Atención', 'bg-rose-50 border-rose-200 text-rose-800'], warn: ['Revisar', 'bg-amber-50 border-amber-200 text-amber-800'], good: ['Mejora', 'bg-emerald-50 border-emerald-200 text-emerald-800'], info: ['Contexto', 'bg-slate-50 border-slate-200 text-slate-700'] };
const SEV: Record<string, string> = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo', INFO: 'Info' };
const TREND: Record<string, string> = { mejoro: '↑', empeoro: '↓', neutral: '=', primera: '·' };
const vitalColor = (k: 'lcp' | 'cls' | 'inp', v: number | null) => {
  if (v === null || v === undefined) return '';
  const t = { lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500] }[k];
  return v <= t[0] ? 'text-emerald-700' : v <= t[1] ? 'text-amber-700' : 'text-rose-700';
};
const day = (d: string) => +new Date(`${d.slice(0, 10)}T12:00:00`);

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="break-inside-avoid-page space-y-3 pt-6">
      <h2 className="text-lg font-bold text-slate-900 border-b-2 border-[#EDFA07] pb-1 inline-block">{title}</h2>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {children}
    </section>
  );
}
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-3 rounded-xl border border-slate-200 bg-white">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-2xl font-black tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}
function Table({ head, rows, num = [] }: { head: string[]; rows: React.ReactNode[][]; num?: number[] }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead><tr className="text-slate-500 text-left border-b border-slate-200">{head.map((h, i) => <th key={i} className={`py-1.5 pr-2 font-semibold ${num.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-100 break-inside-avoid">{r.map((c, j) => <td key={j} className={`py-1.5 pr-2 align-top ${num.includes(j) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** The client report: a printable, light-theme page built only from the frozen snapshot. */
export function ReportDocument({ title, createdAt, snapshot: s, printMode = false }: { title: string; createdAt: string; snapshot: Snap; printMode?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const engines: Record<string, string> = s.ai?.engines ?? {};
  return (
    <div {...(ready ? { 'data-report-ready': '' } : {})} className="bg-white text-slate-800 min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8 print:px-0 print:py-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-slate-900">{title}</h1>
            <p className="text-sm text-slate-600">{s.site.name} · <span className="font-mono text-xs">{s.site.url}</span></p>
            <p className="text-xs text-slate-500">Datos al {date(s.generatedAt ?? createdAt)}</p>
          </div>
          <img src="/brand/logo-dark.png" alt="G.SEO" className="h-10 w-auto" />
        </header>
        {!printMode && (
          <div className="print:hidden mt-4 flex justify-end">
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">Imprimir / guardar como PDF</button>
          </div>
        )}

        {s.summary && (
          <Section title="Resumen" note="Cambios más grandes que la variación normal del sitio. Lo de “al mismo tiempo” es contexto, no una causa comprobada.">
            {!s.summary.insights.length ? <p className="text-sm">Sin cambios relevantes: todo se movió dentro de lo normal.</p> : (
              <ul className="space-y-2">
                {s.summary.insights.map((i: any, k: number) => (
                  <li key={k} className={`p-3 rounded-lg border text-xs break-inside-avoid ${TONE[i.tone][1]}`}>
                    <div className="font-semibold text-sm"><span className="text-[10px] uppercase tracking-wide mr-2">{TONE[i.tone][0]}</span>{i.title}</div>
                    <p className="mt-0.5">{i.detail}</p>
                    {i.related?.length > 0 && <p className="mt-0.5 opacity-80">Al mismo tiempo: {i.related.join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {'gsc' in s && (
          <Section title="Search Console" note={s.gsc ? `Periodo: ${s.gsc.startDate} a ${s.gsc.endDate}. Google publica los datos con 2–3 días de retraso.` : undefined}>
            {!s.gsc ? <p className="text-sm text-slate-500">Este sitio todavía no tiene datos de Search Console conectados.</p> : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Kpi label="Clics" value={fmt(s.gsc.totals.clicks)} />
                  <Kpi label="Impresiones" value={fmt(s.gsc.totals.impressions)} hint="Veces que apareció en Google" />
                  <Kpi label="CTR medio" value={`${fmt(s.gsc.totals.ctr, 2)} %`} />
                  <Kpi label="Posición media" value={fmt(s.gsc.totals.position, 1)} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <TimeChart title="Clics por día" series={[{ label: 'Clics', points: s.gsc.daily.map((d: any) => ({ x: day(d.date), y: d.clicks })) }]} events={[]} />
                  <TimeChart title="Impresiones por día" series={[{ label: 'Impresiones', points: s.gsc.daily.map((d: any) => ({ x: day(d.date), y: d.impressions })) }]} events={[]} />
                </div>
                <h3 className="font-semibold text-sm">Consultas principales</h3>
                <Table head={['Consulta', 'Clics', 'Impresiones', 'CTR', 'Posición']} num={[1, 2, 3, 4]} rows={(s.gsc.topQueries ?? []).map((q: any) => [q.query, fmt(q.clicks), fmt(q.impressions), `${q.ctr} %`, q.position])} />
                <h3 className="font-semibold text-sm">Páginas principales</h3>
                <Table head={['Página', 'Clics', 'Impresiones', 'CTR', 'Posición']} num={[1, 2, 3, 4]} rows={(s.gsc.topPages ?? []).map((p: any) => [<span key="p" className="font-mono text-[11px] break-all">{path(p.page)}</span>, fmt(p.clicks), fmt(p.impressions), `${p.ctr} %`, p.position])} />
                {s.gsc.opportunities?.length > 0 && (
                  <>
                    <h3 className="font-semibold text-sm">Oportunidades (posición 4 a 15 con demanda)</h3>
                    <Table head={['Consulta', 'Impresiones', 'Posición']} num={[1, 2]} rows={s.gsc.opportunities.map((q: any) => [q.query, fmt(q.impressions), q.position])} />
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {s.crawl !== undefined && (
          <Section title="Salud técnica" note={s.crawl ? `Último crawl: ${date(s.crawl.date)}.` : undefined}>
            {!s.crawl ? <p className="text-sm text-slate-500">Todavía no hay un crawl completo de este sitio.</p> : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Kpi label="URLs revisadas" value={fmt(s.crawl.urls)} />
                  <Kpi label="Indexables" value={fmt(s.crawl.indexable)} />
                  <Kpi label="Páginas rotas (4xx)" value={fmt(s.crawl.errors4xx)} />
                  <Kpi label="Errores de servidor (5xx)" value={fmt(s.crawl.errors5xx)} />
                </div>
                {s.crawl.issues.length > 0 && <Table head={['Problema', 'Gravedad', 'URLs']} num={[2]} rows={s.crawl.issues.map((i: any) => [i.title, SEV[i.severity] ?? i.severity, fmt(i.affectedUrlsCount)])} />}
              </>
            )}
          </Section>
        )}

        {s.monitor && (
          <Section title="Evolución">
            <div className="grid md:grid-cols-2 gap-4">
              <TimeChart title="Páginas indexables por crawl" series={[{ label: 'Indexables', points: s.monitor.crawl.map((c: any) => ({ x: +new Date(c.date), y: c.indexable })) }]} events={[]} />
              <TimeChart title="Páginas con error por crawl" series={[{ label: '4xx', points: s.monitor.crawl.map((c: any) => ({ x: +new Date(c.date), y: c.errors4xx })) }, { label: '5xx', points: s.monitor.crawl.map((c: any) => ({ x: +new Date(c.date), y: c.errors5xx })) }]} events={[]} />
              <TimeChart title="LCP mediano" unit="ms" series={[{ label: 'Móvil', points: s.monitor.vitals.filter((v: any) => v.strategy === 'mobile').map((v: any) => ({ x: day(v.date), y: v.fieldLcp ?? v.labLcp })) }, { label: 'Escritorio', points: s.monitor.vitals.filter((v: any) => v.strategy === 'desktop').map((v: any) => ({ x: day(v.date), y: v.fieldLcp ?? v.labLcp })) }]} events={[]} />
            </div>
          </Section>
        )}

        {s.vitals !== undefined && (
          <Section title="Velocidad (Core Web Vitals)" note="Verde: bueno · ámbar: mejorable · rojo: deficiente. LCP: cuándo aparece lo principal; CLS: cuánto se mueve el contenido; INP: respuesta al tocar (usuarios reales).">
            {!s.vitals?.length ? <p className="text-sm text-slate-500">Todavía no hay mediciones.</p> : (
              <Table head={['Página', 'Dispositivo', 'Nota', 'Rendimiento', 'LCP', 'CLS', 'INP (real)']} num={[3, 4, 5, 6]} rows={s.vitals.map((v: any) => [
                <span key="u" className="font-mono text-[11px] break-all">{path(v.url)}</span>,
                v.strategy === 'mobile' ? 'Móvil' : 'Escritorio',
                <strong key="g">{v.grade ?? '—'}</strong>,
                v.score ?? '—',
                <span key="l" className={vitalColor('lcp', v.fieldLcp ?? v.labLcp)}>{ms(v.fieldLcp ?? v.labLcp)}</span>,
                <span key="c" className={vitalColor('cls', v.fieldCls ?? v.labCls)}>{v.fieldCls ?? v.labCls ?? '—'}</span>,
                <span key="i" className={vitalColor('inp', v.fieldInp)}>{v.fieldInp ? `${Math.round(v.fieldInp)} ms` : '—'}</span>
              ])} />
            )}
          </Section>
        )}

        {s.ai !== undefined && (
          <Section title="Visibilidad en IA" note="Puntos por revisión, de 0 a 8: mención directa (1.er lugar 5, top 3 4, más abajo 3) + citación (1.er lugar 3, top 3 2, más abajo 1). Flecha: cambio contra la revisión anterior.">
            {!s.ai ? <p className="text-sm text-slate-500">Todavía no hay revisiones de visibilidad en IA.</p> : (
              <>
                <Table head={['Pregunta', 'Keyword', ...Object.values(engines)]} num={Object.keys(engines).map((_, i) => i + 2)} rows={s.ai.rows.map((r: any) => [r.text, r.keyword, ...Object.keys(engines).map(e => (r.cells[e] ? `${r.cells[e].total}/8 ${TREND[r.cells[e].trend]}` : '—'))])} />
                {s.ai.evolution.length > 1 && <TimeChart title="Promedio semanal de puntos" series={[{ label: 'Todos los motores', points: s.ai.evolution.map((w: any) => ({ x: day(w.week), y: w.all })) }]} events={[]} />}
              </>
            )}
          </Section>
        )}

        <footer className="mt-10 pt-4 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between gap-4">
          <span>Generado con G.SEO el {date(createdAt)}. Los datos corresponden a esa fecha.</span>
          <img src="/brand/icon.png" alt="" className="h-6 w-6 rounded" />
        </footer>
      </div>
    </div>
  );
}
