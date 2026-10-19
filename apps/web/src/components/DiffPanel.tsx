'use client';

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { API_URL, ApiRequestError, apiGet, fmt, fmtDate } from '@/lib/api';
import type { CrawlDiff, CrawlRun } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

export const CHANGE_LABEL: Record<string, string> = {
  PAGE_ADDED: 'Nuevas',
  PAGE_REMOVED: 'Ya no encontradas',
  STATUS_CHANGED: 'Cambio de estado HTTP',
  PAGE_BROKEN: 'Rotas',
  PAGE_RECOVERED: 'Recuperadas',
  NOINDEX_ADDED: 'noindex añadido',
  BECAME_NON_INDEXABLE: 'Ya no indexables',
  BECAME_INDEXABLE: 'Ahora indexables',
  CANONICAL_CHANGED: 'Canonical',
  TITLE_CHANGED: 'Título',
  META_DESCRIPTION_CHANGED: 'Meta description',
  H1_CHANGED: 'H1',
  CONTENT_SHRUNK: 'Contenido reducido',
  SCHEMA_REMOVED: 'Schema eliminado',
  ROBOTS_BLOCKED_NEW: 'Bloqueadas por robots.txt',
  REDIRECT_ADDED: 'Ahora redirigen',
  REDIRECT_REMOVED: 'Ya no redirigen',
  REDIRECT_TARGET_CHANGED: 'Redirección a otro destino'
};
const BAD = new Set(['PAGE_BROKEN', 'NOINDEX_ADDED', 'BECAME_NON_INDEXABLE', 'CANONICAL_CHANGED', 'CONTENT_SHRUNK', 'SCHEMA_REMOVED', 'ROBOTS_BLOCKED_NEW', 'PAGE_REMOVED']);
const GOOD = new Set(['PAGE_RECOVERED', 'BECAME_INDEXABLE']);
const tone = (t: string) => (BAD.has(t) ? 'bad' : GOOD.has(t) ? 'good' : 'default');

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

/** Compare a crawl with the previous one, or with any other completed crawl of the site. */
export function DiffPanel({ runId, runs }: { runId: string; runs?: CrawlRun[] | null }) {
  const [diff, setDiff] = useState<CrawlDiff | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState('');
  const [base, setBase] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setBase('');
  }, [runId]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = (extra: Record<string, string> = {}) => new URLSearchParams(Object.entries({ base, type, q: query, ...extra }).filter(([, v]) => v)).toString();
  useEffect(() => {
    setDiff(null);
    setError(null);
    apiGet<CrawlDiff>(`/api/v1/crawls/${runId}/diff?${params()}`).then(setDiff).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, type, base, query]);

  const others = (runs ?? []).filter(r => r.id !== runId && r.status === 'completed' && r.mode !== 'list');
  const exportCsv = async () => {
    const res = await fetch(`${API_URL}/api/v1/crawls/${runId}/diff?${params({ format: 'csv' })}`, { credentials: 'include' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `cambios-entre-crawls.csv`;
    a.click();
  };

  const title = 'Comparar crawls (antes y después)';
  if (error instanceof ApiRequestError && error.code === 'NO_BASELINE') return <Card title={title}><Empty>Este es el primer crawl completado del sitio; no hay con qué comparar.</Empty></Card>;
  const bad = diff ? Object.entries(diff.counts).filter(([t]) => BAD.has(t)).reduce((s, [, n]) => s + n, 0) : 0;
  const good = diff ? Object.entries(diff.counts).filter(([t]) => GOOD.has(t)).reduce((s, [, n]) => s + n, 0) : 0;
  const total = diff ? Object.values(diff.counts).reduce((s, n) => s + n, 0) : 0;
  return (
    <Card title={title}>
      <div className="flex flex-wrap items-end gap-2 mb-3 text-xs">
        {others.length > 0 && (
          <label className="space-y-1">
            <span className="block font-semibold">Comparar contra</span>
            <select aria-label="Comparar contra" className={inputCls} value={base} onChange={e => setBase(e.target.value)}>
              <option value="">El crawl anterior</option>
              {others.map(r => <option key={r.id} value={r.id}>{fmtDate(r.startedAt)} · {fmt(r.urlsCrawled)} páginas</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1 flex-1 min-w-[12rem]">
          <span className="block font-semibold">Buscar URL</span>
          <input aria-label="Buscar URL en los cambios" className={`${inputCls} w-full`} value={q} onChange={e => setQ(e.target.value)} placeholder="/blog/" />
        </label>
        <Button variant="secondary" disabled={!diff} onClick={exportCsv}><Download className="w-3.5 h-3.5" aria-hidden /> Exportar CSV</Button>
      </div>
      <ErrorBox error={error} />
      {!diff ? (
        !error && <Skeleton rows={3} />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Antes: {fmtDate(diff.base.startedAt)} ({fmt(diff.base.urlsCrawled)} páginas) → Después: {fmtDate(diff.target.startedAt)} ({fmt(diff.target.urlsCrawled)} páginas)
            {new Date(diff.base.startedAt) > new Date(diff.target.startedAt) && ' · Ojo: el crawl de "antes" es más nuevo que este.'}
            {!diff.removalsReliable && ' · El crawl nuevo no fue completo, así que no se reportan páginas desaparecidas.'}
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs" aria-label="Resumen de cambios">
            <div className="p-2 rounded-lg border border-rose-200 dark:border-rose-900"><div className="text-lg font-black text-rose-600">{fmt(bad)}</div>Posibles problemas</div>
            <div className="p-2 rounded-lg border border-emerald-200 dark:border-emerald-900"><div className="text-lg font-black text-emerald-600">{fmt(good)}</div>Mejoras</div>
            <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800"><div className="text-lg font-black">{fmt(total - bad - good)}</div>Otros cambios</div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo de cambio">
            <button className={`px-2 py-1 rounded-full text-[11px] border ${!type ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`} aria-pressed={!type} onClick={() => setType('')}>
              Todos
            </button>
            {Object.entries(diff.counts).sort(([a], [b]) => Number(BAD.has(b)) - Number(BAD.has(a))).map(([t, n]) => (
              <button
                key={t}
                aria-pressed={type === t}
                onClick={() => setType(type === t ? '' : t)}
                className={`px-2 py-1 rounded-full text-[11px] border ${type === t ? 'bg-indigo-600 text-white border-indigo-600' : BAD.has(t) ? 'border-rose-400 text-rose-700 dark:text-rose-300' : GOOD.has(t) ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300' : 'border-slate-300 dark:border-slate-700'}`}
              >
                {CHANGE_LABEL[t] ?? t} · {n}
              </button>
            ))}
          </div>
          {!diff.changes.length ? (
            <Empty>{query || type ? 'Ningún cambio coincide con el filtro.' : 'Sin cambios entre los dos crawls.'}</Empty>
          ) : (
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Cambios por URL</caption>
                <thead className="sticky top-0 bg-white dark:bg-[#151824]">
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th scope="col" className="py-2">URL</th>
                    <th scope="col">Cambio</th>
                    <th scope="col">Antes</th>
                    <th scope="col">Después</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {diff.changes.map((c, i) => {
                    const path = (() => { try { const u = new URL(c.url); return u.pathname + u.search; } catch { return c.url; } })();
                    return (
                      <tr key={`${c.url}-${c.type}-${i}`}>
                        <td className="py-1.5 font-mono text-[11px] break-all" title={c.url}>{path}</td>
                        <td><Badge tone={tone(c.type)}>{CHANGE_LABEL[c.type] ?? c.type}</Badge></td>
                        <td className="text-slate-500 break-all max-w-[18rem]">{show(c.before)}</td>
                        <td className="break-all max-w-[18rem]">{show(c.after)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {diff.totalChanges > diff.changes.length && <p className="text-[11px] text-slate-500 mt-2">Mostrando {fmt(diff.changes.length)} de {fmt(diff.totalChanges)} cambios. Exporta el CSV para verlos todos.</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
