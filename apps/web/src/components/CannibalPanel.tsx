'use client';

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiGet, fmt } from '@/lib/api';
import { Badge, Button, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

interface CPage { page: string; clicks: number; impressions: number; share: number; position: number; title: string | null; indexable: boolean | null }
interface Conflict { query: string; impressions: number; clicks: number; ctr: number; severity: 'alta' | 'media' | 'baja'; winner: string; pages: CPage[]; actions: Array<{ page: string; action: string }> }
interface Pair { a: string; b: string; count: number; impressions: number; queries: string[]; titleSimilarity: number }
interface Data { import: { startDate: string; endDate: string } | null; crawl: { startedAt: string } | null; totals: { conflicts: number; high: number; impressions: number; clicks: number; pagesInvolved: number } | null; conflicts: Conflict[]; pairs: Pair[] }

const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const TONE = { alta: 'bad', media: 'warn', baja: 'default' } as const;

/** Keyword cannibalization: several pages of the site competing for the same Google search. */
export function CannibalPanel({ siteId }: { siteId: string }) {
  const [minImpressions, setMinImpressions] = useState(30);
  const [minShare, setMinShare] = useState(10);
  const [sev, setSev] = useState<'all' | 'alta' | 'media' | 'baja'>('all');
  const [view, setView] = useState<'queries' | 'pairs'>('queries');
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    apiGet<Data>(`/api/v1/sites/${siteId}/gsc/cannibalization?minImpressions=${minImpressions}&minShare=${minShare}`).then(setD, setError);
  }, [siteId, minImpressions, minShare]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={4} />;
  if (!d.import || !d.totals) return <Empty>Importa datos de Search Console para detectar canibalización.</Empty>;
  const rows = d.conflicts.filter(c => sev === 'all' || c.severity === sev);

  const csv = () => {
    const lines = [['Consulta', 'Gravedad', 'Impresiones', 'Clics', 'Página', 'Principal', 'Clics página', 'Impresiones página', '% impresiones', 'Posición', 'Acción']];
    for (const c of rows) for (const p of c.pages) lines.push([c.query, c.severity, String(c.impressions), String(c.clicks), p.page, p.page === c.winner ? 'sí' : 'no', String(p.clicks), String(p.impressions), String(p.share), String(p.position), c.actions.find(a => a.page === p.page)?.action ?? 'Página principal: refuérzala.']);
    const blob = new Blob(['﻿' + lines.map(l => l.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'canibalizacion.csv';
    a.click();
  };

  return (
    <div className="space-y-3">
      <p className="text-slate-500"><strong>Varias páginas compiten por la misma búsqueda.</strong> Google alterna entre ellas y ninguna sube. Para cada caso se propone la página principal (la que más clics trae) y qué hacer con las demás.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Búsquedas en conflicto" value={fmt(d.totals.conflicts)} />
        <Kpi label="Gravedad alta" value={fmt(d.totals.high)} tone={d.totals.high ? 'bad' : 'good'} />
        <Kpi label="Páginas involucradas" value={fmt(d.totals.pagesInvolved)} />
        <Kpi label="Impresiones afectadas" value={fmt(d.totals.impressions)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div role="tablist" className="flex gap-1">
          <button role="tab" aria-selected={view === 'queries'} onClick={() => setView('queries')} className={`px-3 py-1.5 rounded-lg border ${view === 'queries' ? 'bg-slate-800 text-white' : 'border-slate-200 dark:border-slate-700'}`}>Por búsqueda</button>
          <button role="tab" aria-selected={view === 'pairs'} onClick={() => setView('pairs')} className={`px-3 py-1.5 rounded-lg border ${view === 'pairs' ? 'bg-slate-800 text-white' : 'border-slate-200 dark:border-slate-700'}`}>Pares de páginas</button>
        </div>
        <label>Gravedad <select aria-label="Gravedad" className={inputCls} value={sev} onChange={e => setSev(e.target.value as typeof sev)}><option value="all">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
        <label>Impresiones mínimas <input aria-label="Impresiones mínimas" type="number" min={1} className={`${inputCls} w-24`} value={minImpressions} onChange={e => setMinImpressions(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label>% mínimo por página <input aria-label="Porcentaje mínimo por página" type="number" min={1} max={50} className={`${inputCls} w-20`} value={minShare} onChange={e => setMinShare(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} /></label>
        <Button variant="secondary" onClick={csv} disabled={!rows.length}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
      </div>
      {!d.crawl && <p className="text-amber-700 dark:text-amber-400">Sin crawl del sitio las recomendaciones no pueden comparar títulos ni enlaces. Haz un crawl para afinarlas.</p>}

      {view === 'queries' && (!rows.length ? <Empty>No hay búsquedas en conflicto con estos filtros.</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
          {rows.map(c => (
            <li key={c.query} className="p-3">
              <button className="w-full flex flex-wrap items-center gap-3 text-left" aria-expanded={open === c.query} onClick={() => setOpen(open === c.query ? null : c.query)}>
                <Badge tone={TONE[c.severity]}>{c.severity}</Badge>
                <span className="font-semibold flex-1">{c.query}</span>
                <span className="tabular-nums text-slate-500">{fmt(c.impressions)} impr. · {fmt(c.clicks)} clics · {c.pages.length} páginas</span>
              </button>
              {open === c.query && (
                <div className="mt-3 space-y-2">
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-500 text-left"><th className="py-1">Página</th><th className="text-right">Clics</th><th className="text-right">Impresiones</th><th className="text-right">% impr.</th><th className="text-right">Posición</th></tr></thead>
                    <tbody>{c.pages.map(p => (
                      <tr key={p.page} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 font-mono text-[11px] break-all">{path(p.page)} {p.page === c.winner && <Badge tone="good">principal</Badge>}{p.indexable === false && <Badge tone="warn">no indexable</Badge>}<div className="font-sans text-slate-500">{p.title}</div></td>
                        <td className="text-right tabular-nums">{fmt(p.clicks)}</td><td className="text-right tabular-nums">{fmt(p.impressions)}</td><td className="text-right tabular-nums">{p.share}%</td><td className="text-right tabular-nums">{p.position}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <ul className="space-y-1">
                    {c.actions.map(a => <li key={a.page}><span className="font-mono text-[11px]">{path(a.page)}</span>: {a.action}</li>)}
                    <li className="text-slate-500">Principal ({path(c.winner)}): refuerza su contenido para esta búsqueda y recibe los enlaces internos.</li>
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}

      {view === 'pairs' && (!d.pairs.length ? <Empty>Ningún par de páginas compite en 2 o más búsquedas.</Empty> : (
        <>
          <p className="text-slate-500">Páginas que compiten entre sí en varias búsquedas. Suelen ser el mismo tema escrito dos veces: el mejor candidato para fusionar.</p>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 text-left"><th className="py-1">Página A</th><th>Página B</th><th className="text-right">Búsquedas</th><th className="text-right">Impresiones</th><th className="text-right">Títulos parecidos</th></tr></thead>
            <tbody>{d.pairs.map(p => (
              <tr key={p.a + p.b} className="border-t border-slate-100 dark:border-slate-800 align-top">
                <td className="py-1 font-mono text-[11px] break-all">{path(p.a)}</td><td className="font-mono text-[11px] break-all">{path(p.b)}</td>
                <td className="text-right tabular-nums" title={p.queries.join(', ')}>{p.count}</td><td className="text-right tabular-nums">{fmt(p.impressions)}</td><td className="text-right tabular-nums">{p.titleSimilarity}%</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      ))}
    </div>
  );
}
