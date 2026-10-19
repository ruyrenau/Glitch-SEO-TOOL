'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, fmt } from '@/lib/api';
import { Badge, ErrorBox, Skeleton } from './ui';

interface Diff {
  url: string;
  words: { raw: number; rendered: number; lossPct: number };
  links: { raw: number; rendered: number; jsOnly: string[]; rawOnly: string[] };
  meta: Record<'raw' | 'rendered', { title: string | null; h1: string | null; canonical: string | null; robots: string | null }>;
  blocks: { raw: Array<{ md: string; status: string }>; rendered: Array<{ md: string; status: string }>; jsOnly: number; rawOnly: number };
  jsErrors: string[];
}
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

/** Raw HTML (what AI crawlers and the first Googlebot pass read) next to the rendered DOM. */
export function RenderDiffPanel({ crawlId, pageId }: { crawlId: string; pageId: string }) {
  const [d, setD] = useState<Diff | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setD(null);
    setError(null);
    apiGet<Diff>(`/api/v1/crawls/${crawlId}/explorer/pages/${pageId}/render-diff`).then(setD, setError);
  }, [crawlId, pageId]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={4} />;
  const metaRows: Array<[string, keyof Diff['meta']['raw']]> = [['Título', 'title'], ['H1', 'h1'], ['Canonical', 'canonical'], ['Meta robots', 'robots']];
  const lossTone = d.words.lossPct >= 30 ? 'bad' : d.words.lossPct >= 10 ? 'warn' : 'good';
  return (
    <div className="space-y-3 text-xs" aria-label="Comparación de renderizado">
      <div className="flex flex-wrap gap-2 items-center">
        <Badge tone={lossTone}>{d.words.lossPct} % del texto solo existe con JavaScript</Badge>
        <span className="text-slate-500">{fmt(d.words.raw)} palabras sin JavaScript · {fmt(d.words.rendered)} con JavaScript</span>
        <Badge tone={d.links.jsOnly.length ? 'warn' : 'good'}>{d.links.jsOnly.length} enlaces internos solo con JavaScript</Badge>
        {d.jsErrors.length > 0 && <Badge tone="bad">{d.jsErrors.length} errores de JavaScript</Badge>}
      </div>
      <p className="text-slate-500">Izquierda: el HTML que manda el servidor (lo que leen GPTBot, ClaudeBot y otros bots de IA, y Googlebot antes de renderizar). Derecha: la página después de ejecutar JavaScript. En rojo, lo que solo existe con JavaScript.</p>

      <table className="w-full">
        <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1 w-28"></th><th>Sin JavaScript</th><th>Con JavaScript</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {metaRows.map(([label, k]) => {
            const a = d.meta.raw[k] ?? '';
            const b = d.meta.rendered[k] ?? '';
            const diff = a.replace(/\s+/g, ' ').trim() !== b.replace(/\s+/g, ' ').trim();
            return <tr key={k} className={diff ? 'bg-amber-50 dark:bg-amber-950/20' : ''}><td className="py-1 font-semibold">{label}{diff && ' ⚠'}</td><td className="break-all">{a || <em className="text-slate-400">(vacío)</em>}</td><td className="break-all">{b || <em className="text-slate-400">(vacío)</em>}</td></tr>;
          })}
        </tbody>
      </table>

      <div className="grid md:grid-cols-2 gap-3">
        {(['raw', 'rendered'] as const).map(side => (
          <section key={side} aria-label={side === 'raw' ? 'Sin JavaScript' : 'Con JavaScript'} className="rounded-lg border border-slate-200 dark:border-slate-800">
            <h4 className="px-2 py-1 font-semibold border-b border-slate-200 dark:border-slate-800">{side === 'raw' ? 'Sin JavaScript' : 'Con JavaScript'}</h4>
            <div className="max-h-96 overflow-auto p-2 space-y-1">
              {!d.blocks[side].length ? <p className="text-rose-600 font-semibold">Sin contenido de texto.</p> : d.blocks[side].map((b, i) => (
                <pre key={i} className={`font-mono text-[11px] whitespace-pre-wrap break-words rounded px-1 ${b.status === 'js-only' ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200' : b.status === 'removed-by-js' ? 'bg-amber-100 dark:bg-amber-950/40' : ''}`}>{b.md}</pre>
              ))}
            </div>
          </section>
        ))}
      </div>

      {d.links.jsOnly.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Enlaces internos que solo existen con JavaScript ({d.links.jsOnly.length})</summary>
          <p className="text-slate-500 mt-1">Los bots que no ejecutan JavaScript no descubren estas páginas por aquí. Ponlos como &lt;a href&gt; en el HTML.</p>
          <ul className="font-mono text-[11px] mt-1 space-y-0.5">{d.links.jsOnly.map(l => <li key={l}>{path(l)}</li>)}</ul>
        </details>
      )}
      {d.jsErrors.length > 0 && <details><summary className="cursor-pointer font-semibold">Errores de JavaScript</summary><ul className="font-mono text-[11px] mt-1">{d.jsErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
    </div>
  );
}
