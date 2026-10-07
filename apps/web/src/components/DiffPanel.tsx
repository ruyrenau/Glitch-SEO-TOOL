'use client';

import React, { useEffect, useState } from 'react';
import { ApiRequestError, apiGet, fmt, fmtDate } from '@/lib/api';
import type { CrawlDiff } from '@/lib/types';
import { Badge, Card, Empty, ErrorBox, Skeleton } from './ui';

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
  ROBOTS_BLOCKED_NEW: 'Bloqueadas por robots.txt'
};
const BAD = new Set(['PAGE_BROKEN', 'NOINDEX_ADDED', 'BECAME_NON_INDEXABLE', 'CANONICAL_CHANGED', 'CONTENT_SHRUNK', 'SCHEMA_REMOVED', 'ROBOTS_BLOCKED_NEW']);

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

export function DiffPanel({ runId }: { runId: string }) {
  const [diff, setDiff] = useState<CrawlDiff | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState('');

  useEffect(() => {
    setDiff(null);
    setError(null);
    apiGet<CrawlDiff>(`/api/v1/crawls/${runId}/diff${type ? `?type=${type}` : ''}`).then(setDiff).catch(setError);
  }, [runId, type]);

  if (error instanceof ApiRequestError && error.code === 'NO_BASELINE') return <Card title="Cambios respecto al crawl anterior"><Empty>Este es el primer crawl completado del sitio; no hay con qué comparar.</Empty></Card>;
  return (
    <Card title="Cambios respecto al crawl anterior">
      <ErrorBox error={error} />
      {!diff ? (
        !error && <Skeleton rows={3} />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {fmtDate(diff.base.startedAt)} ({fmt(diff.base.urlsCrawled)} páginas) → {fmtDate(diff.target.startedAt)} ({fmt(diff.target.urlsCrawled)} páginas)
            {!diff.removalsReliable && ' · El crawl nuevo no fue completo, así que no se reportan páginas desaparecidas.'}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo de cambio">
            <button className={`px-2 py-1 rounded-full text-[11px] border ${!type ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`} aria-pressed={!type} onClick={() => setType('')}>
              Todos
            </button>
            {Object.entries(diff.counts).map(([t, n]) => (
              <button
                key={t}
                aria-pressed={type === t}
                onClick={() => setType(type === t ? '' : t)}
                className={`px-2 py-1 rounded-full text-[11px] border ${type === t ? 'bg-indigo-600 text-white border-indigo-600' : BAD.has(t) ? 'border-rose-400 text-rose-700 dark:text-rose-300' : 'border-slate-300 dark:border-slate-700'}`}
              >
                {CHANGE_LABEL[t] ?? t} · {n}
              </button>
            ))}
          </div>
          {!diff.changes.length ? (
            <Empty>Sin cambios entre los dos crawls.</Empty>
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
                        <td><Badge tone={BAD.has(c.type) ? 'bad' : 'default'}>{CHANGE_LABEL[c.type] ?? c.type}</Badge></td>
                        <td className="text-slate-500 break-all max-w-[18rem]">{show(c.before)}</td>
                        <td className="break-all max-w-[18rem]">{show(c.after)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {diff.totalChanges > diff.changes.length && <p className="text-[11px] text-slate-500 mt-2">Mostrando {fmt(diff.changes.length)} de {fmt(diff.totalChanges)} cambios.</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
