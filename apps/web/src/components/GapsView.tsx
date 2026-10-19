'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Play, Sparkles, Target } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn, JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kind = 'missing' | 'weak' | 'win' | 'none';
const KIND: Record<Kind, [string, 'bad' | 'warn' | 'good' | 'default']> = { missing: ['No apareces', 'bad'], weak: ['Detrás de ellos', 'warn'], win: ['Vas adelante', 'good'], none: ['Sin competidores', 'default'] };
const lines = (s: string) => s.split(/\n|,/).map(x => x.trim()).filter(Boolean);
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, '') + x.pathname;
  } catch {
    return u;
  }
};

function Brief({ gapId, cluster, brief, onSaved, onError }: { gapId: string; cluster: any; brief: any; onSaved: () => void; onError: (e: unknown) => void }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const make = async (useAi: boolean) => {
    setBusy(useAi ? 'ai' : 'manual');
    onError(null);
    try {
      await apiSend('POST', `/api/v1/content-gaps/${gapId}/briefs`, { clusterId: cluster.id, useAi });
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([brief.markdown], { type: 'text/markdown' }));
    a.download = `brief-${cluster.lead.replace(/[^a-z0-9áéíóúñ]+/gi, '-')}.md`;
    a.click();
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!!busy || !can('content:edit')} onClick={() => make(false)}>{busy === 'manual' ? 'Armando…' : 'Brief sin IA'}</Button>
        <Button disabled={!!busy || !can('content:edit')} onClick={() => make(true)}><Sparkles className="w-3.5 h-3.5" aria-hidden /> {busy === 'ai' ? 'Escribiendo con Claude…' : 'Brief con IA'}</Button>
        {brief && (
          <>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(brief.markdown)}><Copy className="w-3.5 h-3.5" aria-hidden /> Copiar</Button>
            <Button variant="secondary" onClick={download}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar .md</Button>
          </>
        )}
      </div>
      {brief && (
        <div>
          <p className="text-[11px] text-slate-500">{brief.source === 'ai' ? `Escrito con ${brief.model}` : 'Armado sin IA'} · {fmtDate(brief.createdAt)}</p>
          <pre aria-label={`Brief de ${cluster.lead}`} className="whitespace-pre-wrap font-sans text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded-lg max-h-96 overflow-auto">{brief.markdown}</pre>
        </div>
      )}
    </div>
  );
}

/** Brechas de contenido: keywords where competitors rank and the site does not, grouped by intent, with briefs. */
export function GapsView({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [competitors, setCompetitors] = useState('');
  const [keywords, setKeywords] = useState('');
  const [expand, setExpand] = useState(true);
  const [max, setMax] = useState(30);
  const [job, setJob] = useState<JobRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Kind | ''>('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiGet<any>(`/api/v1/sites/${siteId}/content-gaps`).then(r => {
        setD(r);
        setCompetitors(c => c || r.suggestions.competitors.join('\n'));
      }, setError),
    [siteId]
  );
  useEffect(() => {
    load();
  }, [load]);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/content-gaps`, { competitors: lines(competitors), keywords: lines(keywords), expand, maxSearches: max });
      const done = await waitForJob<JobRow>(r.jobId, setJob, 2000);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? 'El análisis no terminó.');
    } catch (x) {
      setError(x);
    } finally {
      setJob(null);
      load();
    }
  };
  if (!d) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const s = d.suggestions;
  const add = (ks: string[]) => setKeywords(k => [...new Set([...lines(k), ...ks])].join('\n'));
  const g = d.latest;
  const res = g?.result;
  const kws = (res?.keywords ?? []).filter((k: any) => !filter || k.kind === filter);
  const count = (k: Kind) => (res?.keywords ?? []).filter((x: any) => x.kind === k).length;
  const progress = job?.progressDetail as { message?: string } | null;
  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center gap-2"><Target className="w-4 h-4" aria-hidden /> Buscar brechas frente a competidores</span>}>
        <p className="text-xs text-slate-500 mb-3">Busca cada keyword en Google (SerpAPI, 1 búsqueda de tu plan por keyword) y te dice dónde tus competidores aparecen en el top 10 y tú no. Agrupa las keywords que Google trata como la misma intención y te propone una página nueva o una mejora, con su brief.</p>
        <form onSubmit={run} className="grid md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1"><span className="block font-semibold">Competidores (dominios, hasta 5)</span><textarea required aria-label="Competidores" rows={5} className={`${inputCls} w-full font-mono`} value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder={'competidor1.com\ncompetidor2.mx'} /></label>
          <div className="space-y-1">
            <label className="block space-y-1"><span className="block font-semibold">Keywords a revisar (una por línea)</span><textarea required aria-label="Keywords a revisar" rows={5} className={`${inputCls} w-full`} value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
              {s.gsc.length > 0 && <button type="button" className="underline text-indigo-600" onClick={() => add(s.gsc.slice(0, 15).map((x: any) => x.keyword))}>+ {Math.min(15, s.gsc.length)} de Search Console donde estás débil</button>}
              {s.tracked.length > 0 && <button type="button" className="underline text-indigo-600" onClick={() => add(s.tracked)}>+ {s.tracked.length} que sigues en SERP</button>}
              {!s.gsc.length && <span className="text-slate-500">Con <button type="button" className="underline" onClick={() => go('gsc')}>Search Console</button> importado te sugiero keywords.</span>}
            </div>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={expand} onChange={e => setExpand(e.target.checked)} /> Agregar búsquedas relacionadas de Google (descubre keywords nuevas)</label>
          <label className="flex items-center gap-2">Máximo de búsquedas <input aria-label="Máximo de búsquedas" type="number" min={5} max={s.max} className={`${inputCls} w-20`} value={max} onChange={e => setMax(Number(e.target.value))} /> <span className="text-slate-500">({lines(keywords).length} keywords)</span></label>
          <div className="md:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={!!job || !can('seo:operate')}><Play className="w-3.5 h-3.5" aria-hidden /> {job ? 'Buscando en Google…' : 'Buscar brechas'}</Button>
            {job && <span role="status" className="text-slate-500">{progress?.message ?? (job.status === 'QUEUED' ? 'En cola…' : 'Trabajando…')}</span>}
          </div>
        </form>
      </Card>
      <ErrorBox error={error} />
      {!g ? <Empty>Todavía no hay análisis.</Empty> : g.status === 'running' ? <p role="status" className="text-xs">Análisis en curso…</p> : g.status === 'failed' ? <p className="text-xs text-rose-600">El último análisis falló: {g.error}</p> : (
        <>
          <Card title={`Resultado · ${fmtDate(g.completedAt)}`}>
            <div className="grid md:grid-cols-4 gap-2 mb-4">
              <Kpi label="Keywords revisadas" value={fmt(res.searched)} hint={res.failed ? `${res.failed} fallaron` : undefined} />
              <Kpi label="No apareces y ellos sí" value={fmt(count('missing'))} tone={count('missing') ? 'bad' : 'good'} />
              <Kpi label="Estás detrás de ellos" value={fmt(count('weak'))} tone={count('weak') ? 'warn' : 'good'} />
              <Kpi label="Vas adelante" value={fmt(count('win'))} tone="good" />
            </div>
            <table className="w-full text-xs text-left mb-2" aria-label="Competidores">
              <thead><tr className="text-slate-500"><th className="py-1">Competidor</th><th>Keywords en su top 10</th><th>Posición media</th><th>Brechas contra ti</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{res.competitors.map((c: any) => <tr key={c.domain}><td className="py-1 font-mono">{c.domain}</td><td>{c.top10} de {res.searched}</td><td>{c.avgPosition ?? '—'}</td><td>{c.gaps}</td></tr>)}</tbody>
            </table>
          </Card>

          <Card title={`Oportunidades de contenido (${res.clusters.length})`}>
            {!res.clusters.length ? <Empty>No hay brechas: en estas keywords vas igual o mejor que tus competidores.</Empty> : (
              <ul className="space-y-3">
                {res.clusters.map((c: any) => (
                  <li key={c.id} className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs space-y-2">
                    <button className="w-full flex flex-wrap items-center gap-2 text-left" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <Badge tone={c.ownUrl ? 'warn' : 'bad'}>{c.ownUrl ? 'Mejorar página' : 'Página nueva'}</Badge>
                      <strong className="text-sm">{c.lead}</strong>
                      {c.keywords.length > 1 && <span className="text-slate-500">+{c.keywords.length - 1} keywords</span>}
                      {res.briefs[c.id] && <Badge tone="good">Brief listo</Badge>}
                    </button>
                    {open === c.id && (
                      <div className="space-y-2">
                        {c.ownUrl && <p>Ya tienes <a className="underline font-mono" href={c.ownUrl} target="_blank" rel="noreferrer">{path(c.ownUrl)}</a> en esos resultados: mejórala en vez de crear otra.</p>}
                        <p><strong>Keywords:</strong> {c.keywords.join(' · ')}</p>
                        {c.questions.length > 0 && <div><strong>Preguntas de Google:</strong><ul className="list-disc ml-5">{c.questions.map((q: string) => <li key={q}>{q}</li>)}</ul></div>}
                        <div><strong>Páginas de la competencia que rankean:</strong><ul className="ml-1">{c.competitorPages.map((p: any) => <li key={p.url}>#{p.position} <a className="underline" href={p.url} target="_blank" rel="noreferrer">{p.title || path(p.url)}</a> <span className="text-slate-500">({p.domain})</span></li>)}</ul></div>
                        <Brief gapId={g.id} cluster={c} brief={res.briefs[c.id]} onSaved={load} onError={setError} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Todas las keywords">
            <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label="Filtrar keywords">
              {(['', 'missing', 'weak', 'win', 'none'] as const).map(k => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={`px-2 py-1 rounded-full text-[11px] border ${filter === k ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`}>{k ? `${KIND[k][0]} · ${count(k)}` : 'Todas'}</button>
              ))}
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs text-left">
                <thead><tr className="text-slate-500"><th className="py-1">Keyword</th><th>Estado</th><th>Tú</th>{res.competitors.map((c: any) => <th key={c.domain} className="font-mono">{c.domain}</th>)}<th>Origen</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {kws.map((k: any) => (
                    <tr key={k.keyword}>
                      <td className="py-1">{k.keyword}</td>
                      <td><Badge tone={KIND[k.kind as Kind][1]}>{KIND[k.kind as Kind][0]}</Badge></td>
                      <td className="tabular-nums">{k.ownPosition ? `#${k.ownPosition}` : k.gscPosition ? <span className="text-slate-500" title="Posición media en Search Console">~{Math.round(k.gscPosition)}</span> : '—'}</td>
                      {res.competitors.map((c: any) => <td key={c.domain} className="tabular-nums">{k.competitors[c.domain] ? `#${k.competitors[c.domain].position}` : '—'}</td>)}
                      <td className="text-slate-500">{{ manual: 'Tuya', gsc: 'Search Console', tracked: 'SERP', related: 'Relacionada' }[k.source as string]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
