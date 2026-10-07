'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, Download, ExternalLink, Search, WrapText } from 'lucide-react';
import { API_URL, apiGet, fmt, fmtDate } from '@/lib/api';
import type { CrawlRun } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

interface Column { key: string; label: string; type?: 'number' | 'text' | 'url' }
interface Rows { tab: { id: string; label: string; columns: Column[] }; total: number; page: number; pageSize: number; rows: Array<Record<string, unknown> & { pageId?: string; url?: string }> }
interface Summary { totals: { urls: number; html: number; images: number; resources?: number; external?: number }; fileTypes?: Array<{ kind: string; label: string; count: number }>; tabs: Array<{ id: string; label: string; filters: Array<{ id: string; label: string; count: number }> }> }
interface Detail {
  page: Record<string, unknown> & { url: string; finalUrl: string; title: string | null; metaDescription: string | null; statusCode: number; images: Array<{ src: string; alt: string | null; width: string | null; height: string | null }> | null; headers: Record<string, string> | null; h1All: string[] | null; h2: string[] | null; og: Record<string, string | null> | null; redirectChain: Array<{ url: string; status: number }> | null };
  inlinks: Array<{ sourceUrl: string; anchor: string; nofollow: boolean }>;
  outlinks: Array<{ targetUrl: string; anchor: string; internal: boolean; nofollow: boolean; status: number | null }>;
  issues: Array<{ code: string; title: string; severity: string }>;
  source: string | null;
}

const path = (u: unknown) => {
  if (typeof u !== 'string' || !u) return '';
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

function Cell({ col, value }: { col: Column; value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">—</span>;
  if (col.type === 'url') return <span className="font-mono text-[11px] break-all" title={String(value)}>{path(value)}</span>;
  if (col.type === 'number') return <span className="tabular-nums">{fmt(Number(value))}</span>;
  return <span className="line-clamp-2" title={String(value)}>{String(value)}</span>;
}

/** Google-style result preview with approximate truncation (characters, not pixels). */
function SerpPreview({ url, title, desc }: { url: string; title: string | null; desc: string | null }) {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  let crumbs = url;
  try {
    const u = new URL(url);
    crumbs = [u.hostname, ...u.pathname.split('/').filter(Boolean)].join(' › ');
  } catch {
    /* keep raw */
  }
  return (
    <div className="max-w-xl p-4 rounded-xl bg-white text-left border border-slate-200 font-[arial,sans-serif]">
      <div className="text-[12px] text-[#202124] truncate">{crumbs}</div>
      <div className="text-[18px] leading-6 text-[#1a0dab] mt-0.5">{title ? cut(title, 60) : <em className="text-slate-400">Sin título</em>}</div>
      <div className="text-[13px] leading-5 text-[#4d5156] mt-1">{desc ? cut(desc, 155) : <em className="text-slate-400">Sin meta description: Google tomará texto de la página.</em>}</div>
      <p className="text-[10px] text-slate-500 mt-2">Aproximación por caracteres (Google corta por píxeles y a veces reescribe el título y la descripción).</p>
    </div>
  );
}

const DETAIL_TABS = [
  ['info', 'Información'],
  ['inlinks', 'Enlaces entrantes'],
  ['outlinks', 'Enlaces salientes'],
  ['images', 'Imágenes'],
  ['serp', 'Vista en Google'],
  ['source', 'Código fuente'],
  ['headers', 'Cabeceras'],
  ['issues', 'Issues'],
  ['edit', 'Editar en WordPress']
] as const;

function DetailPanel({ crawlId, pageId, extra }: { crawlId: string; pageId: string; extra?: (d: Detail) => React.ReactNode }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number][0]>('info');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setD(null);
    apiGet<Detail>(`/api/v1/crawls/${crawlId}/explorer/pages/${pageId}`).then(setD).catch(setError);
  }, [crawlId, pageId]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={3} />;
  const p = d.page;
  const info: Array<[string, unknown]> = [
    ['Dirección', p.url],
    ['URL final', p.finalUrl !== p.url ? p.finalUrl : ''],
    ['Código', p.statusCode],
    ['Tipo de contenido', p.mimeType],
    ['Tamaño', `${fmt(Math.round(Number(p.sizeBytes) / 1024))} KB`],
    ['Respuesta', `${p.responseTimeMs} ms`],
    ['Indexable', p.isIndexable ? 'Sí' : `No (${p.indexabilityReason})`],
    ['Título', p.title],
    ['Meta description', p.metaDescription],
    ['Meta keywords', p.metaKeywords],
    ['Canonical', p.canonical],
    ['Meta robots', p.robotsMeta],
    ['X-Robots-Tag', p.xRobotsTag],
    ['H1', (p.h1All ?? []).join(' | ')],
    ['H2', (p.h2 ?? []).slice(0, 5).join(' | ')],
    ['Idioma', p.lang],
    ['og:title', p.og?.title],
    ['og:image', p.og?.image],
    ['Datos estructurados', Array.isArray(p.schemaTypes) ? (p.schemaTypes as string[]).join(', ') : ''],
    ['Palabras', p.wordCount],
    ['Profundidad', p.depth],
    ['En sitemap', p.inSitemap ? 'Sí' : 'No'],
    ['Visitada por Googlebot (último log)', p.inLogs ? 'Sí' : 'No'],
    ['Redirecciones', p.redirectChain?.map(h => `${h.status} ${h.url}`).join(' → ')]
  ];
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Detalle de la URL" className="flex flex-wrap gap-1">
        {DETAIL_TABS.filter(([id]) => id !== 'edit' || extra).map(([id, label]) => {
          const n = id === 'inlinks' ? d.inlinks.length : id === 'outlinks' ? d.outlinks.length : id === 'images' ? p.images?.length ?? 0 : id === 'issues' ? d.issues.length : null;
          return (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-2 py-1 rounded-lg text-[11px] border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`}>
              {label}{n !== null ? ` (${n})` : ''}
            </button>
          );
        })}
        <a href={p.finalUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 underline">Abrir <ExternalLink className="w-3 h-3" aria-hidden /></a>
      </div>
      {tab === 'edit' && extra?.(d)}
      <div className="text-xs max-h-80 overflow-auto">
        {tab === 'info' && (
          <dl className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-x-4 gap-y-1">
            {info.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all">{String(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {tab === 'inlinks' && (d.inlinks.length ? (
          <table className="w-full text-left"><thead><tr className="text-slate-500"><th className="py-1">Desde</th><th>Texto ancla</th><th>Rel</th></tr></thead>
            <tbody>{d.inlinks.map((l, i) => <tr key={i}><td className="font-mono text-[11px] break-all py-0.5">{path(l.sourceUrl)}</td><td>{l.anchor || <span className="text-slate-400">(sin texto)</span>}</td><td>{l.nofollow ? 'nofollow' : ''}</td></tr>)}</tbody></table>
        ) : <Empty>Ninguna página rastreada enlaza aquí.</Empty>)}
        {tab === 'outlinks' && (d.outlinks.length ? (
          <table className="w-full text-left"><thead><tr className="text-slate-500"><th className="py-1">Hacia</th><th>Texto ancla</th><th>Tipo</th><th>Estado</th></tr></thead>
            <tbody>{d.outlinks.map((l, i) => <tr key={i}><td className="font-mono text-[11px] break-all py-0.5">{l.internal ? path(l.targetUrl) : l.targetUrl}</td><td>{l.anchor || <span className="text-slate-400">(sin texto)</span>}</td><td>{l.internal ? 'interno' : 'externo'}{l.nofollow ? ' · nofollow' : ''}</td><td>{l.status !== null ? <Badge tone={l.status >= 400 || l.status === 0 ? 'bad' : l.status >= 300 ? 'warn' : 'good'}>{l.status || 'error'}</Badge> : ''}</td></tr>)}</tbody></table>
        ) : <Empty>Sin enlaces salientes.</Empty>)}
        {tab === 'images' && (p.images?.length ? (
          <table className="w-full text-left"><thead><tr className="text-slate-500"><th className="py-1">Imagen</th><th>Alt</th><th>Dimensiones</th></tr></thead>
            <tbody>{p.images.map((im, i) => <tr key={i}><td className="font-mono text-[11px] break-all py-0.5">{im.src}</td><td>{im.alt === null ? <Badge tone="bad">sin alt</Badge> : im.alt || <span className="text-slate-400">(vacío)</span>}</td><td>{im.width && im.height ? `${im.width}×${im.height}` : <Badge tone="warn">faltan</Badge>}</td></tr>)}</tbody></table>
        ) : <Empty>Sin imágenes.</Empty>)}
        {tab === 'serp' && <SerpPreview url={p.url} title={p.title} desc={p.metaDescription} />}
        {tab === 'source' && (d.source ? <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 p-2 rounded">{d.source}</pre> : <Empty>No se guardó el código de esta URL (no es HTML 2xx).</Empty>)}
        {tab === 'headers' && (p.headers && Object.keys(p.headers).length ? (
          <dl className="grid grid-cols-[12rem_1fr] gap-1 font-mono text-[11px]">{Object.entries(p.headers).map(([k, v]) => <React.Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="break-all">{v}</dd></React.Fragment>)}</dl>
        ) : <Empty>Sin cabeceras guardadas.</Empty>)}
        {tab === 'issues' && (d.issues.length ? (
          <ul className="space-y-1">{d.issues.map(i => <li key={i.code} className="flex gap-2 items-center"><Badge tone={i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'bad' : 'warn'}>{i.severity}</Badge>{i.title}</li>)}</ul>
        ) : <Empty>Esta URL no aparece en ningún issue abierto.</Empty>)}
      </div>
    </div>
  );
}

// Per-tab column layout (widths in px + hidden keys), remembered in this browser.
type Layout = { widths: Record<string, number>; hidden: string[] };
const LAYOUT_KEY = 'glitch.explorer.layout';
const readLayouts = (): Record<string, Layout> => {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const defaultWidth = (c: Column) => (c.key === 'url' || c.key === 'src' ? 320 : c.type === 'number' ? 90 : 180);

function ColumnPicker({ columns, hidden, onToggle, onReset }: { columns: Column[]; hidden: string[]; onToggle: (k: string) => void; onReset: () => void }) {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
        <Columns3 className="w-3.5 h-3.5" aria-hidden /> Columnas ({columns.length - hidden.filter(h => columns.some(c => c.key === h)).length}/{columns.length})
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 max-h-80 overflow-y-auto p-2 rounded-xl border shadow-lg bg-white border-slate-200 dark:bg-[#151824] dark:border-slate-700 text-xs">
        {columns.map(c => (
          <label key={c.key} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <input type="checkbox" checked={!hidden.includes(c.key)} disabled={c.key === 'url' || c.key === 'src'} onChange={() => onToggle(c.key)} />
            {c.label}
          </label>
        ))}
        <button className="mt-1 w-full text-left px-1.5 py-1 text-indigo-600 dark:text-indigo-400 hover:underline" onClick={onReset}>Restablecer columnas y anchos</button>
      </div>
    </details>
  );
}

export function ExplorerView({ siteId, detailExtra }: { siteId: string; detailExtra?: (d: Detail, crawlId: string) => React.ReactNode }) {
  const [runs, setRuns] = useState<CrawlRun[] | null>(null);
  const [crawlId, setCrawlId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState({ tab: 'internal', filter: 'all', q: '', sort: 'url', dir: 'asc' as 'asc' | 'desc', page: 1 });
  const [rows, setRows] = useState<Rows | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [wrap, setWrap] = useState(false);
  useEffect(() => setLayouts(readLayouts()), []);
  const saveLayout = (tab: string, l: Layout) =>
    setLayouts(all => {
      const next = { ...all, [tab]: l };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const layout: Layout = layouts[state.tab] ?? { widths: {}, hidden: [] };
  const visibleCols = rows ? rows.tab.columns.filter(c => !layout.hidden.includes(c.key)) : [];
  const widthOf = (c: Column) => layout.widths[c.key] ?? defaultWidth(c);
  const startResize = (e: React.PointerEvent, c: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widthOf(c);
    const tab = state.tab;
    const move = (ev: PointerEvent) => saveLayout(tab, { ...layout, widths: { ...layout.widths, [c.key]: Math.max(50, Math.round(w0 + ev.clientX - x0)) } });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    apiGet<CrawlRun[]>(`/api/v1/sites/${siteId}/crawls`)
      .then(list => {
        const done = list.filter(r => r.status === 'completed');
        setRuns(done);
        setCrawlId(done[0]?.id ?? '');
      })
      .catch(setError);
  }, [siteId]);

  useEffect(() => {
    if (!crawlId) return;
    setSummary(null);
    apiGet<Summary>(`/api/v1/crawls/${crawlId}/explorer/summary`).then(setSummary).catch(setError);
  }, [crawlId]);

  const qs = useMemo(() => new URLSearchParams({ tab: state.tab, filter: state.filter, sort: state.sort, dir: state.dir, page: String(state.page), pageSize: '100', ...(state.q ? { q: state.q } : {}) }), [state]);

  const load = useCallback(async () => {
    if (!crawlId) return;
    try {
      setRows(await apiGet<Rows>(`/api/v1/crawls/${crawlId}/explorer?${qs}`));
    } catch (err) {
      setError(err);
    }
  }, [crawlId, qs]);
  useEffect(() => {
    load();
  }, [load]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setState(s => (s.q === q ? s : { ...s, q, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [q]);

  const go = (tab: string, filter = 'all') => {
    setSelected(null);
    setState(s => ({ ...s, tab, filter, page: 1, sort: tab === 'images' ? 'src' : 'url', dir: 'asc' }));
    setQ('');
  };
  const sortBy = (k: string) => setState(s => ({ ...s, sort: k, dir: s.sort === k && s.dir === 'asc' ? 'desc' : 'asc', page: 1 }));
  const tabSummary = summary?.tabs.find(t => t.id === state.tab);
  const pages = rows ? Math.max(1, Math.ceil(rows.total / rows.pageSize)) : 1;

  if (error && !runs) return <ErrorBox error={error} />;
  if (!runs) return <Skeleton rows={6} />;
  if (!runs.length) return <Empty>Este sitio no tiene crawls completados. Ejecuta uno en "Crawl y auditoría" para explorar sus URLs.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="font-semibold">Crawl</span>
          <select aria-label="Crawl" className={inputCls} value={crawlId} onChange={e => { setCrawlId(e.target.value); setSelected(null); }}>
            {runs.map(r => <option key={r.id} value={r.id}>{fmtDate(r.startedAt)} · {fmt(r.urlsCrawled)} URLs</option>)}
          </select>
        </label>
        {summary && <span className="text-slate-500">{fmt(summary.totals.urls)} URLs · {fmt(summary.totals.html)} HTML 200 · {fmt(summary.totals.images)} imágenes · {fmt(summary.totals.resources ?? 0)} archivos · {fmt(summary.totals.external ?? 0)} externos</span>}
      </div>

      <div role="tablist" aria-label="Pestañas del explorador" className="flex gap-1 overflow-x-auto pb-1">
        {(summary?.tabs ?? []).map(t => (
          <button key={t.id} role="tab" aria-selected={state.tab === t.id} onClick={() => go(t.id)} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border ${state.tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-[#151824] border-slate-200 dark:border-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_17rem] gap-4">
        <Card
          title={rows ? `${rows.tab.label} · ${fmt(rows.total)}` : 'Cargando…'}
          actions={
            <>
              <select aria-label="Filtro" className={inputCls} value={state.filter} onChange={e => setState(s => ({ ...s, filter: e.target.value, page: 1 }))}>
                {(tabSummary?.filters ?? []).map(f => <option key={f.id} value={f.id}>{f.label} ({fmt(f.count)})</option>)}
              </select>
              <label className="relative">
                <span className="sr-only">Buscar</span>
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className={`${inputCls} pl-7 w-48`} placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
              </label>
              {rows && (
                <ColumnPicker
                  columns={rows.tab.columns}
                  hidden={layout.hidden}
                  onToggle={k => saveLayout(state.tab, { ...layout, hidden: layout.hidden.includes(k) ? layout.hidden.filter(h => h !== k) : [...layout.hidden, k] })}
                  onReset={() => saveLayout(state.tab, { widths: {}, hidden: [] })}
                />
              )}
              <button title="Mostrar el texto completo en varias líneas" aria-pressed={wrap} onClick={() => setWrap(w => !w)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${wrap ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>
                <WrapText className="w-3.5 h-3.5" aria-hidden /> Ajustar texto
              </button>
              <a className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:bg-slate-800 dark:border-slate-700" href={`${API_URL}/api/v1/crawls/${crawlId}/explorer.csv?${qs}`}>
                <Download className="w-3.5 h-3.5" aria-hidden /> CSV
              </a>
            </>
          }
        >
          {!rows ? (
            <Skeleton rows={8} />
          ) : !rows.rows.length ? (
            <Empty>Ninguna URL coincide con este filtro.</Empty>
          ) : (
            <div className="overflow-auto max-h-[32rem] resize-y">
              <table className="text-left text-xs table-fixed" style={{ width: 40 + visibleCols.reduce((n, c) => n + widthOf(c), 0) }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  {visibleCols.map(c => <col key={c.key} style={{ width: widthOf(c) }} />)}
                </colgroup>
                <caption className="sr-only">{rows.tab.label}</caption>
                <thead className="sticky top-0 bg-white dark:bg-[#151824] z-10">
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th scope="col" className="py-2">#</th>
                    {visibleCols.map(c => (
                      <th key={c.key} scope="col" className="relative pr-3 border-r border-slate-100 dark:border-slate-800" aria-sort={state.sort === c.key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button className="flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-white w-full min-w-0 py-2" onClick={() => sortBy(c.key)} title={c.label}>
                          <span className="truncate">{c.label}</span>
                          {state.sort === c.key && (state.dir === 'asc' ? <ArrowUp className="w-3 h-3 shrink-0" aria-hidden /> : <ArrowDown className="w-3 h-3 shrink-0" aria-hidden />)}
                        </button>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Ajustar ancho de ${c.label}`}
                          title="Arrastra para cambiar el ancho · doble clic para restablecer"
                          onPointerDown={e => startResize(e, c)}
                          onDoubleClick={() => saveLayout(state.tab, { ...layout, widths: Object.fromEntries(Object.entries(layout.widths).filter(([k]) => k !== c.key)) })}
                          className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.rows.map((r, i) => {
                    const id = `${r.pageId}-${i}`;
                    const active = selected === r.pageId;
                    return (
                      <tr key={id} onClick={() => setSelected(r.pageId ?? null)} className={`cursor-pointer ${active ? 'bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'}`} aria-selected={active}>
                        <td className="py-1.5 text-slate-400 tabular-nums">{(rows.page - 1) * rows.pageSize + i + 1}</td>
                        {visibleCols.map(c => (
                          <td key={c.key} className={`py-1.5 pr-3 align-top ${wrap ? 'break-words' : 'truncate'}`} title={wrap || r[c.key] == null ? undefined : String(r[c.key])}>
                            {c.key === 'url' ? <button className="text-left" onClick={() => setSelected(r.pageId ?? null)}><Cell col={c} value={r[c.key]} /></button> : <Cell col={c} value={r[c.key]} />}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <nav className="flex justify-between items-center mt-3 text-xs" aria-label="Paginación">
            <Button variant="secondary" disabled={state.page <= 1} onClick={() => setState(s => ({ ...s, page: s.page - 1 }))}>Anterior</Button>
            <span>Página {state.page} de {pages}</span>
            <Button variant="secondary" disabled={state.page >= pages} onClick={() => setState(s => ({ ...s, page: s.page + 1 }))}>Siguiente</Button>
          </nav>
        </Card>

        <Card title="Resumen">
          {!summary ? (
            <Skeleton rows={6} />
          ) : (
            <ul className="text-xs space-y-3 max-h-[34rem] overflow-y-auto">
              {!!summary.fileTypes?.length && (
                <li>
                  <span className="font-semibold">Tipos de archivo (internos)</span>
                  <ul className="mt-1 space-y-0.5">
                    {summary.fileTypes.map(f => {
                      const total = summary.fileTypes!.reduce((n, x) => n + x.count, 0) || 1;
                      return (
                        <li key={f.kind}>
                          <button onClick={() => (f.kind === 'html' ? go('internal', 'html') : go('resources', f.kind))} className="w-full px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                            <span className="flex justify-between gap-2">
                              <span className="text-slate-600 dark:text-slate-400">{f.label}</span>
                              <span className="tabular-nums font-semibold">{fmt(f.count)} <span className="font-normal text-slate-400">({Math.round((f.count / total) * 100)}%)</span></span>
                            </span>
                            <span className="block h-1 mt-0.5 rounded bg-slate-100 dark:bg-slate-800"><span className="block h-1 rounded bg-indigo-500" style={{ width: `${(f.count / total) * 100}%` }} /></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              )}
              {summary.tabs.map(t => (
                <li key={t.id}>
                  <button className={`font-semibold ${state.tab === t.id ? 'text-indigo-600 dark:text-indigo-400' : ''}`} onClick={() => go(t.id)}>{t.label}</button>
                  <ul className="mt-1 space-y-0.5">
                    {t.filters.filter(f => f.id !== 'all').map(f => (
                      <li key={f.id}>
                        <button onClick={() => go(t.id, f.id)} className={`w-full flex justify-between gap-2 px-1.5 py-0.5 rounded ${state.tab === t.id && state.filter === f.id ? 'bg-indigo-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                          <span className="text-left text-slate-600 dark:text-slate-400">{f.label}</span>
                          <span className={`tabular-nums ${f.count ? 'font-semibold' : 'text-slate-400'}`}>{fmt(f.count)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {selected && crawlId && (
        <Card title="Detalle de la URL">
          <DetailPanel crawlId={crawlId} pageId={selected} extra={detailExtra ? d => detailExtra(d, crawlId) : undefined} />
        </Card>
      )}
    </div>
  );
}

export type { Detail as ExplorerDetail };
