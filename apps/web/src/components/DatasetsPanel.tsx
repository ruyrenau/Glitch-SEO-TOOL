'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Trash2, Upload } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, inputCls } from './ui';

interface Column {
  name: string;
  variable: string;
  type: string;
  empty: number;
  unique: number;
  sample: string[];
}
interface Dataset {
  id: string;
  name: string;
  filename: string;
  rowCount: number;
  columns: Column[];
  issues: { duplicateRows: number[]; emptyCells: number; keyColumn: string | null; delimiter: string };
  preview: Array<Record<string, string>>;
  createdAt: string;
  templates: Array<{ id: string; name: string }>;
}
interface Template {
  id: string;
  name: string;
  dataset: { id: string; name: string; rowCount: number };
  _count: { generatedPages: number };
}
interface GenerateResult {
  created: number;
  skipped: Array<{ rowIndex: number | null; slug: string; reason: string }>;
  byStatus: Record<string, number>;
  remaining: number;
}

const STATUS_LABEL: Record<string, string> = { BLOCKED: 'bloqueadas', NEEDS_REVIEW: 'requieren revisión', READY_FOR_APPROVAL: 'listas para aprobar' };

export function DatasetsPanel({ siteId, onGenerated }: { siteId: string; onGenerated: () => void }) {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tpl, setTpl] = useState({ name: '', titleTemplate: '', descTemplate: '', slugTemplate: '', bodyTemplate: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([apiGet<Dataset[]>(`/api/v1/sites/${siteId}/datasets`), apiGet<Template[]>(`/api/v1/sites/${siteId}/templates`)]);
      setDatasets(d);
      setTemplates(t);
      setSelected(cur => cur || d[0]?.id || '');
    } catch (err) {
      setError(err);
    }
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load]);

  const ds = datasets?.find(d => d.id === selected);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiSend<Dataset>('POST', `/api/v1/sites/${siteId}/datasets?name=${encodeURIComponent(file.name.replace(/\.\w+$/, ''))}&fileName=${encodeURIComponent(file.name)}`, await file.text(), 'text/csv');
      await load();
      setSelected(created.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (d: Dataset) => {
    if (!window.confirm(`¿Borrar el dataset "${d.name}" y sus plantillas? Las páginas ya generadas se conservan con sus datos de origen.`)) return;
    try {
      await apiSend('DELETE', `/api/v1/datasets/${d.id}?confirm=true`);
      setSelected('');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ds) return;
    setError(null);
    try {
      await apiSend('POST', `/api/v1/datasets/${ds.id}/templates`, tpl);
      setTpl({ name: '', titleTemplate: '', descTemplate: '', slugTemplate: '', bodyTemplate: '' });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const generate = async (t: Template) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await apiSend<GenerateResult>('POST', `/api/v1/templates/${t.id}/generate`, {}));
      await load();
      onGenerated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const insert = (v: string) => setTpl(t => ({ ...t, bodyTemplate: `${t.bodyTemplate}{{${v}}}` }));

  return (
    <Card
      title="Datasets CSV y plantillas"
      actions={
        <>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="sr-only" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="w-3.5 h-3.5" aria-hidden /> Importar CSV</Button>
        </>
      }
    >
      <p className="text-[11px] text-slate-500 mb-3">CSV con encabezados (coma, punto y coma o tabulador; hasta 5,000 filas). Cada columna se usa en las plantillas como {'{{variable}}'}. Los valores se escapan al insertarse en HTML.</p>
      <ErrorBox error={error} />
      {!datasets ? null : !datasets.length ? (
        <Empty>Aún no hay datasets. Importa un CSV para generar páginas en lote.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-xs">
              <span className="sr-only">Dataset</span>
              <select aria-label="Dataset" className={inputCls} value={selected} onChange={e => setSelected(e.target.value)}>
                {datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {fmt(d.rowCount)} filas</option>)}
              </select>
            </label>
            {ds && <Button variant="secondary" onClick={() => remove(ds)}><Trash2 className="w-3.5 h-3.5" aria-hidden /> Borrar dataset</Button>}
          </div>

          {ds && (
            <>
              <div className="text-xs space-y-1">
                <p className="text-slate-500">{ds.filename} · importado {fmtDate(ds.createdAt)} · delimitador {ds.issues.delimiter}</p>
                {ds.issues.duplicateRows.length > 0 && <p className="text-amber-700 dark:text-amber-400">⚠ Filas duplicadas: {ds.issues.duplicateRows.join(', ')}</p>}
                {ds.issues.emptyCells > 0 && <p className="text-amber-700 dark:text-amber-400">⚠ {fmt(ds.issues.emptyCells)} celdas vacías; las páginas que las usen quedarán bloqueadas.</p>}
                {ds.issues.keyColumn ? <p className="text-slate-500">Columna clave (única y sin vacíos): <code className="font-mono">{ds.issues.keyColumn}</code></p> : <p className="text-slate-500">Ninguna columna identifica cada fila de forma única.</p>}
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Vista previa del dataset</caption>
                  <thead className="sticky top-0 bg-white dark:bg-[#151824]">
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      {ds.columns.map(c => (
                        <th key={c.variable} scope="col" className="py-2 font-semibold align-bottom">
                          <span className="font-mono">{`{{${c.variable}}}`}</span>
                          <span className="block font-normal text-slate-500">{c.type}{c.empty ? ` · ${c.empty} vacías` : ''}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ds.preview.map((r, i) => (
                      <tr key={i}>
                        {ds.columns.map(c => <td key={c.variable} className={`py-1 max-w-[14rem] truncate ${!r[c.variable] ? 'bg-amber-500/10' : ''}`} title={r[c.variable]}>{r[c.variable] || '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer font-semibold">Nueva plantilla para este dataset</summary>
                <form onSubmit={createTemplate} className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                  <div className="space-y-2">
                    <label className="block font-semibold space-y-1"><span>Nombre</span><input required className={inputCls} value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })} /></label>
                    <label className="block font-semibold space-y-1"><span>Título</span><input required className={`${inputCls} font-mono`} value={tpl.titleTemplate} onChange={e => setTpl({ ...tpl, titleTemplate: e.target.value })} /></label>
                    <label className="block font-semibold space-y-1"><span>Meta description</span><input className={`${inputCls} font-mono`} value={tpl.descTemplate} onChange={e => setTpl({ ...tpl, descTemplate: e.target.value })} /></label>
                    <label className="block font-semibold space-y-1"><span>Slug</span><input required className={`${inputCls} font-mono`} value={tpl.slugTemplate} onChange={e => setTpl({ ...tpl, slugTemplate: e.target.value })} /></label>
                    <div className="flex flex-wrap gap-1" aria-label="Insertar variable en el cuerpo">
                      {ds.columns.map(c => <button key={c.variable} type="button" onClick={() => insert(c.variable)} className="px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-700 font-mono text-[11px]">{`{{${c.variable}}}`}</button>)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block font-semibold space-y-1"><span>Cuerpo HTML (sin scripts)</span><textarea required rows={9} className={`${inputCls} font-mono`} value={tpl.bodyTemplate} onChange={e => setTpl({ ...tpl, bodyTemplate: e.target.value })} /></label>
                    <Button type="submit">Guardar plantilla</Button>
                  </div>
                </form>
              </details>
            </>
          )}

          {templates.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold mb-2">Plantillas</h3>
              <ul className="space-y-2 text-xs">
                {templates.map(t => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 justify-between">
                    <span><strong>{t.name}</strong> <span className="text-slate-500">· {t.dataset.name} ({fmt(t.dataset.rowCount)} filas) · {fmt(t._count.generatedPages)} páginas generadas</span></span>
                    <Button disabled={busy} onClick={() => generate(t)}><Play className="w-3.5 h-3.5" aria-hidden /> Generar páginas</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div role="status" className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <p className="font-semibold">{fmt(result.created)} páginas generadas{result.remaining ? ` (quedan ${fmt(result.remaining)} filas; vuelve a ejecutar)` : ''}.</p>
              <p className="flex flex-wrap gap-2">
                {Object.entries(result.byStatus).map(([k, v]) => <Badge key={k} tone={k === 'BLOCKED' ? 'bad' : k === 'NEEDS_REVIEW' ? 'warn' : 'good'}>{fmt(v)} {STATUS_LABEL[k] ?? k}</Badge>)}
              </p>
              {result.skipped.map(s => <p key={`${s.rowIndex}-${s.slug}`} className="text-slate-500">Fila {s.rowIndex === null ? '—' : s.rowIndex + 1} omitida: {s.reason} (/{s.slug})</p>)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
