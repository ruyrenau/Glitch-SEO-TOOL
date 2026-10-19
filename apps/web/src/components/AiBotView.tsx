'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, fmt } from '@/lib/api';
import { Badge, Empty, ErrorBox, Skeleton, inputCls } from './ui';

type Flag = 'split-table' | 'split-list' | 'split-paragraph' | 'no-context' | 'tiny' | 'js-only' | 'key-data-js';
interface Chunk { index: number; headings: string[]; md: string; tokens: number; flags: Flag[] }
interface Side { markdown: string; words: number; chunks: Chunk[]; flagCounts: Partial<Record<Flag, number>> }
interface View {
  url: string;
  maxTokens: number;
  source: 'stored-raw' | 'live-raw+rendered' | 'rendered-only';
  rawError: string | null;
  jsSuspect: boolean;
  flags: Record<Flag, { label: string; tone: 'bad' | 'warn' | 'info'; fix: string }>;
  bot: Side & { title: string | null; imagesWithoutAlt: number };
  withJs: (Side & { jsOnlyBlocks: number; jsOnly: string[] }) | null;
}
const TONE = { bad: 'bad', warn: 'warn', info: 'default' } as const;

/** Explorer detail tab: the page as a RAG pipeline sees it (clean Markdown split into chunks). */
export function AiBotViewPanel({ crawlId, pageId }: { crawlId: string; pageId: string }) {
  const [size, setSize] = useState(512);
  const [side, setSide] = useState<'bot' | 'js'>('bot');
  const [mode, setMode] = useState<'chunks' | 'markdown'>('chunks');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setV(null);
    setError(null);
    apiGet<View>(`/api/v1/crawls/${crawlId}/explorer/pages/${pageId}/ai-view?size=${size}`).then(setV, setError);
  }, [crawlId, pageId, size]);
  if (error) return <ErrorBox error={error} />;
  if (!v) return <Skeleton rows={4} />;
  const s: Side = side === 'js' && v.withJs ? v.withJs : v.bot;
  const chunks = onlyProblems ? s.chunks.filter(c => c.flags.some(f => v.flags[f].tone !== 'info')) : s.chunks;
  const counts = Object.entries(s.flagCounts) as Array<[Flag, number]>;

  return (
    <div className="space-y-3">
      <p className="text-slate-500">Así ve esta página un sistema de IA que recupera fragmentos (RAG): solo el contenido principal, en Markdown, dividido en trozos. {v.source === 'live-raw+rendered' ? 'El crawl ejecutó JavaScript: compara lo que ve un bot de IA (sin JavaScript) con lo que ve Google.' : 'Los bots de IA como GPTBot y ClaudeBot casi nunca ejecutan JavaScript.'}</p>
      {v.rawError && <p className="text-amber-700 dark:text-amber-400">{v.rawError}</p>}
      {v.jsSuspect && <p className="text-rose-600 font-semibold">Esta página casi no tiene texto en el HTML y parece generarse con JavaScript: un bot de IA vería la página casi vacía. Haz un crawl con "Ejecutar JavaScript" para compararlo.</p>}
      {v.withJs && v.withJs.jsOnlyBlocks > 0 && (
        <div className="p-2 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300">
          <strong>{fmt(v.withJs.jsOnlyBlocks)} bloque(s) solo existen con JavaScript</strong> ({fmt(v.bot.words)} palabras sin JavaScript contra {fmt(v.withJs.words)} con JavaScript). Los bots de IA no los ven:
          <ul className="list-disc ml-5 mt-1 max-h-24 overflow-auto">{v.withJs.jsOnly.slice(0, 15).map((b, i) => <li key={i} className="truncate">{b}</li>)}</ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {v.withJs && (
          <div role="tablist" aria-label="Versión" className="flex gap-1">
            <button role="tab" aria-selected={side === 'bot'} onClick={() => setSide('bot')} className={`px-2 py-1 rounded-lg border text-[11px] ${side === 'bot' ? 'bg-slate-800 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Bot de IA (sin JavaScript)</button>
            <button role="tab" aria-selected={side === 'js'} onClick={() => setSide('js')} className={`px-2 py-1 rounded-lg border text-[11px] ${side === 'js' ? 'bg-slate-800 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Con JavaScript (Google)</button>
          </div>
        )}
        <div role="tablist" aria-label="Formato" className="flex gap-1">
          <button role="tab" aria-selected={mode === 'chunks'} onClick={() => setMode('chunks')} className={`px-2 py-1 rounded-lg border text-[11px] ${mode === 'chunks' ? 'bg-slate-800 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Fragmentos</button>
          <button role="tab" aria-selected={mode === 'markdown'} onClick={() => setMode('markdown')} className={`px-2 py-1 rounded-lg border text-[11px] ${mode === 'markdown' ? 'bg-slate-800 text-white' : 'border-slate-300 dark:border-slate-700'}`}>Markdown limpio</button>
        </div>
        <label>Tamaño de fragmento <select aria-label="Tamaño de fragmento" className={inputCls} value={size} onChange={e => setSize(Number(e.target.value))}>{[256, 512, 1024].map(n => <option key={n} value={n}>{n} tokens</option>)}</select></label>
        {mode === 'chunks' && <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Solo con problemas</label>}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-slate-500">{fmt(s.chunks.length)} fragmentos · {fmt(s.words)} palabras{side === 'bot' && v.bot.imagesWithoutAlt ? ` · ${v.bot.imagesWithoutAlt} imágenes sin alt (el bot no sabe qué muestran)` : ''}</span>
        {counts.map(([f, n]) => <Badge key={f} tone={TONE[v.flags[f].tone]}>{v.flags[f].label}: {n}</Badge>)}
        {!counts.length && <Badge tone="good">Sin problemas de fragmentación</Badge>}
      </div>

      {mode === 'markdown' ? (
        s.markdown ? <pre aria-label="Markdown limpio" className="font-mono text-[11px] whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900 p-2 rounded max-h-96 overflow-auto">{s.markdown}</pre> : <Empty>No hay contenido de texto en esta versión de la página.</Empty>
      ) : !chunks.length ? (
        <Empty>{onlyProblems ? 'Ningún fragmento con problemas.' : 'No hay contenido para fragmentar.'}</Empty>
      ) : (
        <ol className="space-y-2" aria-label="Fragmentos">
          {chunks.map(c => {
            const bad = c.flags.some(f => v.flags[f].tone === 'bad');
            const warn = c.flags.some(f => v.flags[f].tone === 'warn');
            return (
              <li key={c.index} className={`rounded-lg border p-2 ${bad ? 'border-rose-400 bg-rose-50/60 dark:bg-rose-950/20' : warn ? 'border-amber-300' : 'border-slate-200 dark:border-slate-800'}`}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-bold">#{c.index + 1}</span>
                  <span className="text-slate-500 truncate max-w-md">{c.headings.length ? c.headings.join(' › ') : 'Sin encabezado'}</span>
                  <span className="text-slate-400 tabular-nums">{c.tokens} tokens</span>
                  {c.flags.map(f => <Badge key={f} tone={TONE[v.flags[f].tone]}>{v.flags[f].label}</Badge>)}
                </div>
                <pre className="font-mono text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto">{c.md}</pre>
                {c.flags.filter(f => v.flags[f].tone !== 'info').map(f => <p key={f} className={bad ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-400'}>{v.flags[f].fix}</p>)}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[10px] text-slate-500">Simulación: tokens aproximados (≈ 4 caracteres por token) y un divisor por encabezados y tamaño, como los más usados. Cada motor de IA usa el suyo; lo importante es que cada sección se entienda sola.</p>
    </div>
  );
}
