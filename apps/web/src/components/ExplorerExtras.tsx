'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Plus, Play, Trash2 } from 'lucide-react';
import { apiGet, apiSend, fmt } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

// ---------------------------------------------------------------- Structure

interface Node {
  path: string;
  name: string;
  total: number;
  indexable: number;
  errors: number;
  redirects: number;
  page: { id: string; url: string; statusCode: number; isIndexable: boolean; title: string | null; inlinks: number; depth: number } | null;
  children: Node[];
}
interface Structure {
  tree: Node;
  depth: Array<{ depth: number; total: number; indexable: number; errors: number }>;
  stats: { urls: number; maxDepth: number; deepPages: number; noInlinks: number };
}

function TreeRow({ node, level, max, onOpen }: { node: Node; level: number; max: number; onOpen: (pageId: string) => void }) {
  const [open, setOpen] = useState(level < 1);
  const has = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-50 dark:hover:bg-slate-900/60" style={{ paddingLeft: level * 16 }}>
        <button className="w-4 h-4 shrink-0 text-slate-400" aria-label={open ? `Contraer ${node.name}` : `Expandir ${node.name}`} aria-expanded={has ? open : undefined} disabled={!has} onClick={() => setOpen(o => !o)}>
          {has ? open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" /> : null}
        </button>
        <span className="font-mono text-[11px] min-w-0 truncate flex-1" title={node.path}>
          {node.page ? (
            <button className="text-left text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => onOpen(node.page!.id)}>
              {level === 0 ? '/' : node.name}
            </button>
          ) : (
            <span>{level === 0 ? '/' : `${node.name}/`}</span>
          )}
        </span>
        {node.page && node.page.statusCode !== 200 && <Badge tone={node.page.statusCode >= 400 || node.page.statusCode === 0 ? 'bad' : 'warn'}>{node.page.statusCode || 'error'}</Badge>}
        {node.errors > 0 && <span className="text-[10px] text-rose-600">{node.errors} con error</span>}
        <span className="w-28 hidden md:block h-1.5 rounded bg-slate-100 dark:bg-slate-800" title={`${node.total} URLs`}>
          <span className="block h-1.5 rounded bg-indigo-500" style={{ width: `${(node.total / max) * 100}%` }} />
        </span>
        <span className="w-16 text-right tabular-nums text-[11px]">{fmt(node.total)}</span>
        <span className="w-20 text-right tabular-nums text-[11px] text-slate-500">{fmt(node.indexable)} index.</span>
      </div>
      {has && open && (
        <ul>
          {node.children.slice(0, 300).map(c => <TreeRow key={c.path} node={c} level={level + 1} max={max} onOpen={onOpen} />)}
          {node.children.length > 300 && <li className="text-[11px] text-slate-500" style={{ paddingLeft: (level + 1) * 16 + 24 }}>…y {node.children.length - 300} más</li>}
        </ul>
      )}
    </li>
  );
}

export function StructurePanel({ crawlId, onOpen }: { crawlId: string; onOpen: (pageId: string) => void }) {
  const [s, setS] = useState<Structure | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setS(null);
    apiGet<Structure>(`/api/v1/crawls/${crawlId}/explorer/structure`).then(setS).catch(setError);
  }, [crawlId]);
  if (error) return <ErrorBox error={error} />;
  if (!s) return <Skeleton rows={8} />;
  const maxDepth = Math.max(...s.depth.map(d => d.total), 1);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-4">
      <Card title={`Estructura por carpetas · ${fmt(s.stats.urls)} URLs`}>
        <p className="text-xs text-slate-500 mb-2">Cada carpeta muestra cuántas URLs hay dentro y cuántas son indexables. Haz clic en una URL para ver su detalle.</p>
        <ul className="text-xs max-h-[36rem] overflow-auto">
          <TreeRow node={s.tree} level={0} max={s.tree.total || 1} onOpen={onOpen} />
        </ul>
      </Card>
      <Card title="Profundidad de rastreo">
        <p className="text-xs text-slate-500 mb-3">Clics desde la portada. Las páginas importantes deberían estar a 3 clics o menos.</p>
        <ul className="space-y-1.5 text-xs">
          {s.depth.map(d => (
            <li key={d.depth}>
              <div className="flex justify-between"><span>{d.depth === 0 ? 'Portada' : `${d.depth} clic${d.depth > 1 ? 's' : ''}`}</span><span className="tabular-nums font-semibold">{fmt(d.total)}</span></div>
              <div className="h-2 rounded bg-slate-100 dark:bg-slate-800 flex overflow-hidden">
                <span className={`block h-2 ${d.depth > 3 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${((d.total - d.errors) / maxDepth) * 100}%` }} />
                <span className="block h-2 bg-rose-500" style={{ width: `${(d.errors / maxDepth) * 100}%` }} title={`${d.errors} con error`} />
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 text-xs grid grid-cols-[1fr_auto] gap-y-1">
          <dt className="text-slate-500">Profundidad máxima</dt><dd className="font-semibold tabular-nums">{s.stats.maxDepth}</dd>
          <dt className="text-slate-500">Páginas a más de 3 clics</dt><dd className="font-semibold tabular-nums">{fmt(s.stats.deepPages)}</dd>
          <dt className="text-slate-500">Páginas sin enlaces entrantes</dt><dd className="font-semibold tabular-nums">{fmt(s.stats.noInlinks)}</dd>
        </dl>
        <p className="mt-2 text-[11px] text-slate-500"><span className="inline-block w-2 h-2 bg-rose-500 rounded-sm" /> con error · <span className="inline-block w-2 h-2 bg-amber-500 rounded-sm" /> a más de 3 clics</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Custom search / extraction

type SearchRule = { name: string; mode: 'contains' | 'not_contains' | 'regex' | 'not_regex'; pattern: string; scope: 'html' | 'text' };
type ExtractRule = { name: string; kind: 'css' | 'regex'; selector: string; attr: string };
interface CustomResult {
  columns: Array<{ key: string; label: string; type?: string }>;
  scanned: number;
  matched: number;
  rows: Array<Record<string, unknown> & { pageId: string; url: string; _match: boolean }>;
}
const RULES_KEY = 'glitch.explorer.custom';
const EXAMPLES: { search: SearchRule[]; extract: ExtractRule[] } = {
  search: [{ name: 'Google Analytics', mode: 'contains', pattern: 'gtag(', scope: 'html' }],
  extract: [{ name: 'Autor', kind: 'css', selector: 'meta[name=author]', attr: 'content' }]
};

export function CustomSearchPanel({ crawlId, onOpen }: { crawlId: string; onOpen: (pageId: string) => void }) {
  const [search, setSearch] = useState<SearchRule[]>(EXAMPLES.search);
  const [extract, setExtract] = useState<ExtractRule[]>(EXAMPLES.extract);
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [res, setRes] = useState<CustomResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null');
      if (saved?.search) setSearch(saved.search);
      if (saved?.extract) setExtract(saved.extract);
    } catch {}
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify({ search, extract }));
    } catch {}
    try {
      setRes(await apiSend<CustomResult>('POST', `/api/v1/crawls/${crawlId}/explorer/custom`, { search, extract: extract.map(e => ({ ...e, attr: e.kind === 'css' ? e.attr || 'text' : undefined })) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const rows = res ? res.rows.filter(r => !onlyMatches || r._match) : [];
  const csv = () => {
    if (!res) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const text = [res.columns.map(c => esc(c.label)).join(','), ...rows.map(r => res.columns.map(c => esc(r[c.key])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'busqueda-personalizada.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <Card title="Búsqueda y extracción personalizada">
        <p className="text-xs text-slate-500 mb-3">
          Se ejecuta sobre el HTML guardado en este crawl, así que no se vuelve a rastrear el sitio. Si el crawl ejecutó JavaScript, se usa el HTML ya renderizado. Hasta 10 búsquedas y 10 extracciones.
        </p>
        <div className="grid lg:grid-cols-2 gap-4 text-xs">
          <section className="space-y-2">
            <h4 className="font-semibold">Buscar</h4>
            {search.map((r, i) => (
              <div key={i} className="grid grid-cols-[8rem_9rem_1fr_6rem_auto] gap-1.5 items-center">
                <input aria-label="Nombre de la búsqueda" className={inputCls} value={r.name} onChange={e => setSearch(s => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nombre" />
                <select aria-label="Tipo de búsqueda" className={inputCls} value={r.mode} onChange={e => setSearch(s => s.map((x, j) => (j === i ? { ...x, mode: e.target.value as SearchRule['mode'] } : x)))}>
                  <option value="contains">Contiene</option>
                  <option value="not_contains">No contiene</option>
                  <option value="regex">Regex coincide</option>
                  <option value="not_regex">Regex no coincide</option>
                </select>
                <input aria-label="Texto a buscar" className={`${inputCls} font-mono`} value={r.pattern} onChange={e => setSearch(s => s.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))} placeholder="Texto o expresión" />
                <select aria-label="Dónde buscar" className={inputCls} value={r.scope} onChange={e => setSearch(s => s.map((x, j) => (j === i ? { ...x, scope: e.target.value as SearchRule['scope'] } : x)))}>
                  <option value="html">Código</option>
                  <option value="text">Texto visible</option>
                </select>
                <button aria-label="Quitar búsqueda" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => setSearch(s => s.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {search.length < 10 && <Button variant="secondary" onClick={() => setSearch(s => [...s, { name: `Búsqueda ${s.length + 1}`, mode: 'contains', pattern: '', scope: 'html' }])}><Plus className="w-3.5 h-3.5" /> Agregar búsqueda</Button>}
          </section>
          <section className="space-y-2">
            <h4 className="font-semibold">Extraer</h4>
            {extract.map((r, i) => (
              <div key={i} className="grid grid-cols-[8rem_7rem_1fr_6rem_auto] gap-1.5 items-center">
                <input aria-label="Nombre de la extracción" className={inputCls} value={r.name} onChange={e => setExtract(s => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nombre" />
                <select aria-label="Tipo de extracción" className={inputCls} value={r.kind} onChange={e => setExtract(s => s.map((x, j) => (j === i ? { ...x, kind: e.target.value as ExtractRule['kind'] } : x)))}>
                  <option value="css">Selector CSS</option>
                  <option value="regex">Regex</option>
                </select>
                <input aria-label="Selector o expresión" className={`${inputCls} font-mono`} value={r.selector} onChange={e => setExtract(s => s.map((x, j) => (j === i ? { ...x, selector: e.target.value } : x)))} placeholder={r.kind === 'css' ? 'div.precio, meta[name=author]' : '"sku":"([^"]+)"'} />
                <input aria-label="Atributo a extraer" className={inputCls} disabled={r.kind !== 'css'} value={r.kind === 'css' ? r.attr : ''} onChange={e => setExtract(s => s.map((x, j) => (j === i ? { ...x, attr: e.target.value } : x)))} placeholder="text" title="text, html o un atributo (href, content, src…)" />
                <button aria-label="Quitar extracción" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => setExtract(s => s.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {extract.length < 10 && <Button variant="secondary" onClick={() => setExtract(s => [...s, { name: `Extracción ${s.length + 1}`, kind: 'css', selector: '', attr: 'text' }])}><Plus className="w-3.5 h-3.5" /> Agregar extracción</Button>}
          </section>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
          <Button disabled={busy || (!search.length && !extract.length)} onClick={run}><Play className="w-3.5 h-3.5" /> {busy ? 'Analizando…' : 'Ejecutar'}</Button>
          <label className="flex items-center gap-2"><input type="checkbox" checked={onlyMatches} onChange={e => setOnlyMatches(e.target.checked)} /> Solo páginas con resultado</label>
          {res && <span className="text-slate-500">{fmt(res.matched)} de {fmt(res.scanned)} páginas con resultado</span>}
          {res && <Button variant="secondary" onClick={csv}><Download className="w-3.5 h-3.5" /> CSV</Button>}
        </div>
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Card>

      {res && (
        <Card title="Resultados">
          {!rows.length ? (
            <Empty>Ninguna página coincide.</Empty>
          ) : (
            <div className="overflow-auto max-h-[32rem]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white dark:bg-[#151824]">
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    {res.columns.map(c => <th key={c.key} scope="col" className="py-2 pr-3 whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.slice(0, 1000).map(r => (
                    <tr key={r.pageId}>
                      {res.columns.map(c => (
                        <td key={c.key} className="py-1.5 pr-3 align-top max-w-[28rem] break-words">
                          {c.key === 'url' ? (
                            <button className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline text-left break-all" onClick={() => onOpen(r.pageId)}>{new URL(r.url).pathname + new URL(r.url).search}</button>
                          ) : (
                            String(r[c.key] ?? '')
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 1000 && <p className="text-xs text-slate-500 mt-2">Se muestran 1,000 filas. Descarga el CSV para verlas todas.</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
