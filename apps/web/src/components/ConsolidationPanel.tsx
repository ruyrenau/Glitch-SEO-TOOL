'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Copy, Sparkles } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Empty, ErrorBox, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const STATUS: Record<string, [string, 'default' | 'warn' | 'good' | 'bad']> = { draft: ['Borrador', 'default'], approved: ['Aprobada', 'warn'], applied: ['Aplicada', 'good'], reverted: ['Revertida', 'default'], failed: ['Falló', 'bad'] };

function Editor({ id, onChange }: { id: string; onChange: () => void }) {
  const { can } = useAuth();
  const [c, setC] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rule, setRule] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await apiGet<any>(`/api/v1/consolidations/${id}`);
    setC(r);
    setTitle(r.draftTitle ?? '');
    setHtml(r.draftHtml ?? '');
  }, [id]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      const r: any = await fn();
      if (r?.redirectRule) setRule(r.redirectRule);
      await load();
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  if (error && !c) return <ErrorBox error={error} />;
  if (!c) return <Skeleton rows={4} />;
  const draft = c.status === 'draft';
  const dirty = title !== (c.draftTitle ?? '') || html !== (c.draftHtml ?? '');
  const save = () => apiSend('PUT', `/api/v1/consolidations/${id}/draft`, { title, html });
  return (
    <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="good">Ganadora</Badge><a href={c.winnerUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:underline">{path(c.winnerUrl)}</a>
        <span className="text-slate-400">←</span>
        <Badge tone="warn">Se redirige (301)</Badge><a href={c.loserUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:underline">{path(c.loserUrl)}</a>
        {draft && <Button variant="secondary" disabled={!can('content:edit') || !!busy} onClick={() => run('swap', () => apiSend('PUT', `/api/v1/consolidations/${id}/draft`, { winnerUrl: c.loserUrl }))}><ArrowLeftRight className="w-3.5 h-3.5" aria-hidden /> Cambiar ganadora</Button>}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {(['winner', 'loser'] as const).map(k => (
          <section key={k} aria-label={k === 'winner' ? 'Contenido de la ganadora' : 'Contenido de la que se redirige'} className="rounded-lg border border-slate-200 dark:border-slate-800">
            <h4 className="px-2 py-1 font-semibold border-b border-slate-200 dark:border-slate-800">{k === 'winner' ? 'Ganadora' : 'Se redirige'} · {fmt(c[k].words)} palabras</h4>
            {c[k].queries.length > 0 && <p className="px-2 pt-1 text-slate-500">Búsquedas: {c[k].queries.slice(0, 6).map((q: any) => `${q.query} (${fmt(q.clicks)} clics, pos. ${q.position})`).join(' · ')}</p>}
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-words p-2 max-h-56 overflow-auto">{c[k].markdown || '(sin contenido guardado)'}</pre>
          </section>
        ))}
      </div>

      {draft && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!can('seo:operate') || !!busy} onClick={() => run('ai', () => apiSend('POST', `/api/v1/consolidations/${id}/draft-ai`))}><Sparkles className="w-3.5 h-3.5" aria-hidden /> {busy === 'ai' ? 'Redactando con Claude…' : 'Redactar con IA (Claude)'}</Button>
          <Button variant="secondary" disabled={!can('content:edit') || !!busy} onClick={() => run('manual', () => apiSend('POST', `/api/v1/consolidations/${id}/draft-manual`))}>Armar borrador a mano</Button>
        </div>
      )}
      {(c.draftHtml || html) && (
        <div className="space-y-2">
          <label className="block"><span className="font-semibold">Título</span><input aria-label="Título de la página fusionada" className={`${inputCls} w-full`} disabled={!draft} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block"><span className="font-semibold">Contenido (HTML)</span><textarea aria-label="Contenido fusionado" rows={16} className={`${inputCls} w-full font-mono text-[11px]`} disabled={!draft} value={html} onChange={e => setHtml(e.target.value)} /></label>
            <div><span className="font-semibold">Vista previa</span><iframe title="Vista previa del contenido fusionado" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:13px system-ui;padding:8px;color:#1e293b">${html}</body>`} className="w-full h-[22rem] rounded-lg border border-slate-200 dark:border-slate-800 bg-white" /></div>
          </div>
          {c.aiModel && <p className="text-slate-500">Redactado por {c.aiModel}. Revísalo: la IA solo debía usar información de las dos páginas, pero confirma cifras, precios y nombres antes de publicar.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {draft && <Button variant="secondary" disabled={!dirty || !!busy} onClick={() => run('save', save)}>Guardar borrador</Button>}
        {draft && <Button disabled={!can('seo:operate') || !html.trim() || !!busy} onClick={() => run('approve', async () => { if (dirty) await save(); return apiSend('POST', `/api/v1/consolidations/${id}/approve`); })}>Aprobar</Button>}
        {c.status === 'approved' && <Button disabled={!can('wordpress:send') || !!busy} onClick={() => confirm(`¿Publicar el contenido fusionado en ${path(c.winnerUrl)} y redirigir ${path(c.loserUrl)} con una 301?\n\nSe guarda una copia para poder revertir.`) && run('apply', () => apiSend('POST', `/api/v1/consolidations/${id}/apply`, { confirm: true }))}>{busy === 'apply' ? 'Aplicando…' : 'Aplicar en WordPress + 301'}</Button>}
        {c.status === 'applied' && <Button variant="secondary" disabled={!can('wordpress:send') || !!busy} onClick={() => confirm('¿Revertir? Se restaura el contenido anterior de la ganadora y se quita la 301.') && run('revert', () => apiSend('POST', `/api/v1/consolidations/${id}/revert`, { confirm: true }))}>Revertir</Button>}
        {['draft', 'approved', 'failed'].includes(c.status) && <Button variant="secondary" disabled={!can('content:edit') || !!busy} onClick={() => confirm('¿Descartar esta consolidación?') && run('discard', () => apiSend('DELETE', `/api/v1/consolidations/${id}`))}>Descartar</Button>}
      </div>
      {c.error && <p className="text-amber-700 dark:text-amber-400">{c.error}</p>}
      {(rule || (c.status === 'applied' && c.redirectMethod === 'export')) && (
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1">
          <div className="font-semibold">Regla 301</div>
          {[rule?.htaccess ?? `Redirect 301 ${path(c.loserUrl)} ${c.winnerUrl}`, rule?.nginx ?? `location = ${path(c.loserUrl).split('?')[0]} { return 301 ${c.winnerUrl}; }`].map(l => <div key={l} className="flex items-center gap-2"><code className="font-mono text-[11px] break-all flex-1">{l}</code><button aria-label="Copiar regla" onClick={() => navigator.clipboard?.writeText(l)}><Copy className="w-3.5 h-3.5" /></button></div>)}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

/** "Consolidación": merge two pages that compete or say the same, send the result to WordPress and 301 the other one. */
export function ConsolidationPanel({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<{ items: any[]; candidates: any[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/consolidations`).then(setD, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const start = async (cand: any) => {
    try {
      const c = await apiSend<any>('POST', `/api/v1/sites/${siteId}/consolidations`, { a: cand.a, b: cand.b, queries: cand.queries });
      await load();
      setOpen(c.id);
    } catch (e) {
      setError(e);
    }
  };
  if (!d) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const busyUrls = new Set(d.items.filter(i => ['draft', 'approved'].includes(i.status)).flatMap(i => [i.winnerUrl, i.loserUrl]));
  return (
    <div className="space-y-4 text-xs">
      <p className="text-slate-500">Cuando dos páginas compiten por las mismas búsquedas (Canibalización) o dicen casi lo mismo (Duplicados), lo mejor suele ser unirlas: una página más completa en la URL que más tráfico trae y una 301 desde la otra. Flujo: elegir el par → borrador (con Claude o a mano) → aprobar → aplicar en WordPress con 301 → revertir si hace falta. Se guarda una copia del contenido anterior.</p>
      <ErrorBox error={error} />
      {d.items.length > 0 && (
        <section aria-label="Consolidaciones" className="space-y-1">
          <h3 className="font-semibold text-sm">Consolidaciones</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
            {d.items.map(i => (
              <li key={i.id} className="p-2">
                <button className="w-full flex flex-wrap items-center gap-2 text-left" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>
                  <Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge>
                  <span className="font-mono text-[11px]">{path(i.loserUrl)} → {path(i.winnerUrl)}</span>
                  <span className="ml-auto text-slate-400">{fmtDate(i.createdAt)}</span>
                </button>
                {open === i.id && <Editor id={i.id} onChange={load} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Candidatas a consolidar" className="space-y-1">
        <h3 className="font-semibold text-sm">Candidatas</h3>
        {!d.candidates.length ? <Empty>No hay pares de páginas que compitan o se dupliquen. Revisa <button className="text-indigo-600 underline" onClick={() => go('gsc')}>Search Console</button> (Canibalización) después de importar datos, o haz un crawl.</Empty> : (
          <ul className="space-y-2">
            {d.candidates.map(cand => {
              const taken = busyUrls.has(cand.a) || busyUrls.has(cand.b);
              return (
                <li key={`${cand.a}|${cand.b}`} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[16rem]">
                    <div className="font-mono text-[11px]">{path(cand.a)} ↔ {path(cand.b)}</div>
                    <div className="flex flex-wrap gap-1 mt-1">{cand.reasons.map((r: string) => <Badge key={r} tone="warn">{r}</Badge>)}{cand.impressions > 0 && <Badge>{fmt(cand.impressions)} impr.</Badge>}</div>
                    {cand.queries.length > 0 && <div className="text-slate-500 mt-1">{cand.queries.slice(0, 5).join(' · ')}</div>}
                  </div>
                  <Button variant="secondary" disabled={!can('content:edit') || taken} onClick={() => start(cand)}>{taken ? 'En proceso' : 'Consolidar'}</Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
