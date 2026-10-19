'use client';

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiGet, fmt, fmtDate } from '@/lib/api';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';
import { TimeChart } from './MonitorView';
import { ConsolidationPanel } from './ConsolidationPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function downloadCsv(name: string, lines: string[][]) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
}
function useData<T>(url: string | null) {
  const [d, setD] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!url) return;
    setD(null);
    setError(null);
    apiGet<T>(url).then(setD, setError);
  }, [url]);
  return { d, error };
}
function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg role="img" aria-label={label} width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-indigo-500" />
    </svg>
  );
}
const Url = ({ u }: { u: string }) => <a href={u} target="_blank" rel="noreferrer" className="font-mono text-[11px] break-all hover:underline">{path(u)}</a>;

// ---------------------------------------------------------------------------

function Duplicates({ siteId }: { siteId: string }) {
  const [threshold, setThreshold] = useState(85);
  const [minWords, setMinWords] = useState(200);
  const [view, setView] = useState<'near' | 'exact' | 'thin'>('exact');
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/content/duplicates?threshold=${threshold}&minWords=${minWords}`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.crawl) return <Empty>Haz un crawl del sitio para comparar el texto de sus páginas.</Empty>;
  const groups = view === 'exact' ? d.exact : d.near;
  const csv = () => {
    if (view === 'thin') return downloadCsv('poco-texto.csv', [['URL', 'Título', 'Palabras', 'Clics', 'Impresiones'], ...d.thin.map((p: any) => [p.url, p.title, p.words, p.clicks, p.impressions])]);
    downloadCsv(view === 'exact' ? 'duplicados-exactos.csv' : 'casi-duplicados.csv', [['Grupo', 'Similitud', 'URL', 'Rol', 'Palabras', 'Clics', 'Estado', 'Acción'], ...groups.flatMap((g: any, i: number) => [[i + 1, g.similarity, g.keeper.url, 'principal', g.keeper.words, g.keeper.clicks, '', 'Conservar'], ...g.pages.map((p: any) => [i + 1, g.similarity, p.url, 'copia', p.words, p.clicks, p.status, p.action])])]);
  };
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Compara solo el texto principal de cada página (sin menú, cabecera ni pie), del crawl del {fmtDate(d.crawl.startedAt)}. Para cada grupo se propone la página a conservar: la que más clics trae, luego la más enlazada.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Páginas comparadas" value={fmt(d.totals.pages)} />
        <Kpi label="Duplicados exactos" value={fmt(d.totals.exactGroups)} hint={`${fmt(d.totals.exactPages)} páginas`} tone={d.totals.exactGroups ? 'warn' : 'good'} />
        <Kpi label="Casi duplicados" value={fmt(d.totals.nearGroups)} hint={`${fmt(d.totals.nearPages)} páginas`} tone={d.totals.nearGroups ? 'warn' : 'good'} />
        <Kpi label="Poco texto" value={fmt(d.totals.thin)} hint={`menos de ${minWords} palabras`} tone={d.totals.thin ? 'warn' : 'good'} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div role="tablist" className="flex gap-1">
          {([['exact', 'Duplicados exactos'], ['near', 'Casi duplicados'], ['thin', 'Poco texto']] as const).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`px-3 py-1.5 rounded-lg border ${view === id ? 'bg-slate-800 text-white' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
          ))}
        </div>
        {view === 'near' && <label>Similitud mínima <select aria-label="Similitud mínima" className={inputCls} value={threshold} onChange={e => setThreshold(Number(e.target.value))}>{[70, 80, 85, 90, 95].map(v => <option key={v} value={v}>{v} %</option>)}</select></label>}
        {view === 'thin' && <label>Palabras mínimas <input aria-label="Palabras mínimas" type="number" min={10} className={`${inputCls} w-24`} value={minWords} onChange={e => setMinWords(Math.max(10, Number(e.target.value) || 10))} /></label>}
        <Button variant="secondary" onClick={csv}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
      </div>

      {view !== 'thin' && (!groups.length ? <Empty>{view === 'exact' ? 'No hay páginas con el mismo texto.' : 'No hay páginas casi iguales con esta similitud.'}</Empty> : (
        <ul className="space-y-2">
          {groups.map((g: any, i: number) => (
            <li key={i} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={g.pending ? 'warn' : 'good'}>{g.pending ? `${g.pending} por resolver` : 'Resuelto'}</Badge>
                <span className="text-slate-500">{view === 'near' ? `≈ ${g.similarity} % igual · ` : ''}{g.pages.length + 1} páginas</span>
              </div>
              <div><Badge tone="good">Conservar</Badge> <Url u={g.keeper.url} /> <span className="text-slate-500">· {fmt(g.keeper.words)} palabras{g.keeper.clicks !== null ? ` · ${fmt(g.keeper.clicks)} clics` : ''} · {g.keeper.inlinks} enlaces internos</span></div>
              <ul className="ml-4 space-y-1">
                {g.pages.map((p: any) => (
                  <li key={p.url}><Url u={p.url} /> <span className="text-slate-500">· {fmt(p.words)} palabras{p.clicks !== null ? ` · ${fmt(p.clicks)} clics` : ''}</span><div className={p.status === 'resuelto' ? 'text-emerald-700 dark:text-emerald-400' : ''}>{p.action}</div></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ))}

      {view === 'thin' && (!d.thin.length ? <Empty>Ninguna página indexable tiene menos de {minWords} palabras.</Empty> : (
        <>
          <p className="text-slate-500">Páginas indexables con poco texto propio. Amplíalas con información útil, júntalas con otra parecida o ponles noindex si no deben salir en Google (contacto, legales y similares pueden estar bien así).</p>
          <table className="w-full">
            <thead><tr className="text-slate-500 text-left"><th className="py-1">Página</th><th className="text-right">Palabras</th><th className="text-right">Clics</th><th className="text-right">Impresiones</th></tr></thead>
            <tbody>{d.thin.map((p: any) => <tr key={p.url} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1"><Url u={p.url} /><div className="text-slate-500">{p.title}</div></td><td className="text-right tabular-nums">{fmt(p.words)}</td><td className="text-right tabular-nums">{p.clicks === null ? '—' : fmt(p.clicks)}</td><td className="text-right tabular-nums">{p.impressions === null ? '—' : fmt(p.impressions)}</td></tr>)}</tbody>
          </table>
        </>
      ))}
    </div>
  );
}

function Declining({ siteId, go }: { siteId: string; go: GoFn }) {
  const [minClicks, setMinClicks] = useState(30);
  const [minDrop, setMinDrop] = useState(20);
  const [hideSeasonal, setHideSeasonal] = useState(false);
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/content/declining?minClicks=${minClicks}&minDrop=${minDrop}`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.ready) return <Empty>Hace falta el historial mensual de Search Console (al menos 4 meses). Se descarga solo en la próxima importación. <button className="text-indigo-600 underline" onClick={() => go('gsc')}>Ir a Search Console</button></Empty>;
  const pages = d.pages.filter((p: any) => !hideSeasonal || !p.seasonal);
  const per = (ms: string[]) => `${monthLabel(ms[0])} – ${monthLabel(ms[ms.length - 1])}`;
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Compara los clics de cada página en los últimos 3 meses completos ({per(d.periods.after)}) contra los 3 anteriores ({per(d.periods.before)}).{d.periods.yoy ? ' Si los clics están igual que hace un año, se marca como “de temporada”.' : ' Con 15 meses de historial también se descartan las caídas de temporada.'}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Kpi label="Páginas en declive" value={fmt(d.totals.pages)} tone={d.totals.pages ? 'warn' : 'good'} />
        <Kpi label="Clics perdidos (3 meses)" value={fmt(d.totals.lost)} tone={d.totals.lost ? 'bad' : 'good'} />
        <Kpi label="Probablemente de temporada" value={fmt(d.totals.seasonal)} />
      </div>
      <TimeChart title="Clics del sitio por mes" series={[{ label: 'Clics', points: d.site.map((s: any) => ({ x: +new Date(`${s.month}-15T12:00:00`), y: s.clicks })) }]} events={[]} />
      <div className="flex flex-wrap items-end gap-3">
        <label>Clics mínimos antes <input aria-label="Clics mínimos antes" type="number" min={1} className={`${inputCls} w-24`} value={minClicks} onChange={e => setMinClicks(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label>Caída mínima <select aria-label="Caída mínima" className={inputCls} value={minDrop} onChange={e => setMinDrop(Number(e.target.value))}>{[10, 20, 30, 50].map(v => <option key={v} value={v}>{v} %</option>)}</select></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideSeasonal} onChange={e => setHideSeasonal(e.target.checked)} /> Ocultar las de temporada</label>
        <Button variant="secondary" onClick={() => downloadCsv('contenido-en-declive.csv', [['URL', 'Clics antes', 'Clics después', 'Caída %', 'Posición antes', 'Posición después', 'De temporada', 'Meses bajando', 'Diagnóstico'], ...pages.map((p: any) => [p.page, p.before, p.after, p.drop, p.positionBefore, p.positionAfter, p.seasonal ? 'sí' : 'no', p.streak, p.reasons.join(' ')])])}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
      </div>
      {!pages.length ? <Empty>Ninguna página perdió clics con estos filtros.</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {pages.map((p: any) => (
            <li key={p.page} className="py-2.5 flex flex-wrap gap-3 items-start">
              <div className="flex-1 min-w-[16rem] space-y-0.5">
                <div className="flex flex-wrap items-center gap-2"><Url u={p.page} />{p.seasonal && <Badge>De temporada</Badge>}{p.streak >= 3 && <Badge tone="bad">{p.streak} meses bajando</Badge>}</div>
                {p.title && <div className="text-slate-500">{p.title}</div>}
                <ul className="list-disc ml-4">{p.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
              </div>
              <Spark values={p.series.map((s: any) => s.clicks)} label={`Clics por mes de ${path(p.page)}`} />
              <div className="w-40 text-right tabular-nums">
                <div className="text-rose-600 font-bold">−{p.drop} % ({fmt(p.before)} → {fmt(p.after)})</div>
                {p.positionBefore !== null && <div className="text-slate-500">posición {p.positionBefore} → {p.positionAfter}</div>}
                {p.yoy && p.yoy.change !== null && <div className="text-slate-500">vs. hace un año: {p.yoy.change > 0 ? '+' : ''}{p.yoy.change} %</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS: Record<string, [string, 'good' | 'warn' | 'bad']> = { claro: ['Página clara', 'good'], disperso: ['Disperso', 'warn'], 'sin-pagina-fuerte': ['Sin página fuerte', 'bad'] };

function Topics({ siteId, go }: { siteId: string; go: GoFn }) {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/content/topics`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.import) return <Empty>Importa datos de Search Console para agrupar tus búsquedas por tema. <button className="text-indigo-600 underline" onClick={() => go('gsc')}>Ir a Search Console</button></Empty>;
  const term = q.trim().toLowerCase();
  const rows = d.topics.filter((t: any) => (status === 'all' || t.status === status) && (!term || t.name.toLowerCase().includes(term) || t.queries.some((x: any) => x.query.toLowerCase().includes(term))));
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Las búsquedas de Search Console ({d.import.startDate} a {d.import.endDate}) agrupadas por tema: comparten palabras clave o Google las responde con las mismas páginas. Cada tema debería tener una página principal.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Temas" value={fmt(d.totals.topics)} hint={`${fmt(d.totals.queries)} búsquedas`} />
        <Kpi label="Dispersos" value={fmt(d.totals.scattered)} hint="varias páginas se reparten el tema" tone={d.totals.scattered ? 'warn' : 'good'} />
        <Kpi label="Sin página fuerte" value={fmt(d.totals.weak)} hint="posición media peor que 20" tone={d.totals.weak ? 'bad' : 'good'} />
        <Kpi label="Con página clara" value={fmt(d.totals.topics - d.totals.scattered - d.totals.weak)} tone="good" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>Estado <select aria-label="Estado del tema" className={inputCls} value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <input aria-label="Buscar tema" placeholder="Buscar tema o búsqueda" className={`${inputCls} flex-1 min-w-[12rem]`} value={q} onChange={e => setQ(e.target.value)} />
        <Button variant="secondary" onClick={() => downloadCsv('temas.csv', [['Tema', 'Búsqueda', 'Clics', 'Impresiones', 'Posición', 'Página principal', 'Estado'], ...rows.flatMap((t: any) => t.queries.map((x: any) => [t.name, x.query, x.clicks, x.impressions, x.position, t.target, STATUS[t.status][0]]))])}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
      </div>
      {!rows.length ? <Empty>Ningún tema con estos filtros.</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
          {rows.map((t: any) => (
            <li key={t.name} className="p-3">
              <button className="w-full flex flex-wrap items-center gap-3 text-left" aria-expanded={open === t.name} onClick={() => setOpen(open === t.name ? null : t.name)}>
                <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                <span className="font-semibold flex-1">{t.name}</span>
                <span className="tabular-nums text-slate-500">{t.queryCount} búsquedas · {fmt(t.clicks)} clics · {fmt(t.impressions)} impr. · pos. {t.position}</span>
              </button>
              {open === t.name && (
                <div className="mt-3 space-y-2">
                  <p><strong>Página principal:</strong> <Url u={t.target} /> ({t.targetShare} % de las impresiones){t.targetTitle ? ` — ${t.targetTitle}` : ''}</p>
                  <p>{t.advice}</p>
                  {t.opportunity > 0 && <p className="text-slate-500">{fmt(t.opportunity)} impresiones en búsquedas en posición 4–20: la oportunidad más cercana.</p>}
                  <div className="grid md:grid-cols-2 gap-3">
                    <table className="w-full">
                      <thead><tr className="text-slate-500 text-left"><th className="py-1">Búsqueda</th><th className="text-right">Clics</th><th className="text-right">Impr.</th><th className="text-right">Pos.</th></tr></thead>
                      <tbody>{t.queries.map((x: any) => <tr key={x.query} className="border-t border-slate-100 dark:border-slate-800"><td className="py-0.5">{x.query}</td><td className="text-right tabular-nums">{fmt(x.clicks)}</td><td className="text-right tabular-nums">{fmt(x.impressions)}</td><td className="text-right tabular-nums">{x.position}</td></tr>)}</tbody>
                    </table>
                    <table className="w-full">
                      <thead><tr className="text-slate-500 text-left"><th className="py-1">Páginas que aparecen</th><th className="text-right">Clics</th><th className="text-right">% impr.</th><th className="text-right">Pos.</th></tr></thead>
                      <tbody>{t.pages.map((p: any) => <tr key={p.page} className="border-t border-slate-100 dark:border-slate-800"><td className="py-0.5"><Url u={p.page} /></td><td className="text-right tabular-nums">{fmt(p.clicks)}</td><td className="text-right tabular-nums">{p.share}%</td><td className="text-right tabular-nums">{p.position}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Análisis de contenido: duplicates and thin pages, declining pages and keyword topics. */
export function ContentAuditView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [tab, setTab] = useState<'dup' | 'decline' | 'topics' | 'merge'>('dup');
  const TABS = [['dup', 'Duplicados y poco texto'], ['decline', 'En declive'], ['topics', 'Temas de keywords'], ['merge', 'Consolidación']] as const;
  return (
    <Card>
      <div role="tablist" aria-label="Análisis de contenido" className="flex flex-wrap gap-1 mb-4">
        {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>)}
      </div>
      {tab === 'dup' && <Duplicates siteId={siteId} />}
      {tab === 'decline' && <Declining siteId={siteId} go={go} />}
      {tab === 'topics' && <Topics siteId={siteId} go={go} />}
      {tab === 'merge' && <ConsolidationPanel siteId={siteId} go={go} />}
    </Card>
  );
}
