'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Download, Send } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';
import { RenderDiffPanel } from './RenderDiffPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
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
function save(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}
const Bar = ({ v, tone = 'bg-indigo-500' }: { v: number; tone?: string }) => (
  <div className="w-24 h-1.5 rounded bg-slate-100 dark:bg-slate-800 inline-block align-middle"><div className={`h-1.5 rounded ${tone}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /></div>
);

// ---------------------------------------------------------------------------
// Internal linking
// ---------------------------------------------------------------------------
function Links({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/architecture/links`);
  const [view, setView] = useState<'pages' | 'orphans' | 'suggest'>('pages');
  const [sort, setSort] = useState<'score' | 'weak' | 'depth'>('weak');
  const [q, setQ] = useState('');
  const [sug, setSug] = useState<any | null>(null);
  const [sugErr, setSugErr] = useState<unknown>(null);
  const [loadingSug, setLoadingSug] = useState(false);
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const rows = useMemo(() => {
    if (!d?.pages) return [];
    const t = q.trim().toLowerCase();
    const list = d.pages.filter((p: any) => !t || p.url.toLowerCase().includes(t) || (p.title ?? '').toLowerCase().includes(t));
    return [...list].sort((a: any, b: any) => (sort === 'score' ? b.linkScore - a.linkScore : sort === 'depth' ? b.depth - a.depth : (b.impressions ?? 0) * (100 - b.linkScore) - (a.impressions ?? 0) * (100 - a.linkScore) || a.linkScore - b.linkScore));
  }, [d, q, sort]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.crawl) return <Empty>Haz un crawl del sitio para ver su enlazado interno. <button className="text-indigo-600 underline" onClick={() => go('crawler')}>Ir a Crawl y auditoría</button></Empty>;

  const loadSuggestions = async (targetUrl?: string) => {
    setView('suggest');
    setLoadingSug(true);
    setSugErr(null);
    try {
      setSug(await apiGet<any>(`/api/v1/sites/${siteId}/architecture/link-suggestions${targetUrl ? `?targetUrl=${encodeURIComponent(targetUrl)}` : ''}`));
    } catch (e) {
      setSugErr(e);
    } finally {
      setLoadingSug(false);
    }
  };
  const propose = async (s: any) => {
    const k = `${s.sourceUrl}|${s.targetUrl}`;
    try {
      await apiSend('POST', `/api/v1/sites/${siteId}/seo-edits/link`, { url: s.sourceUrl, targetUrl: s.targetUrl, anchor: s.anchor });
      setProposed(p => ({ ...p, [k]: 'ok' }));
    } catch (e) {
      setProposed(p => ({ ...p, [k]: (e as Error).message }));
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Cómo reparte fuerza el enlazado interno (crawl del {fmtDate(d.crawl.startedAt)}). El <strong>Link Score</strong> (0–100) es un PageRank interno: cuántos enlaces recibe cada página y de qué tan fuertes vienen.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Páginas indexables" value={fmt(d.totals.pages)} />
        <Kpi label="Enlaces entrantes promedio" value={fmt(d.totals.avgInlinks)} />
        <Kpi label="Huérfanas" value={fmt(d.totals.orphans)} hint="sin enlaces o fuera del crawl" tone={d.totals.orphans ? 'warn' : 'good'} />
        <Kpi label="A más de 3 clics" value={fmt(d.totals.deep)} tone={d.totals.deep ? 'warn' : 'good'} />
        <Kpi label="Débiles con demanda" value={fmt(d.totals.weakWithDemand)} hint={d.totals.hasGsc ? 'Link Score bajo e impresiones' : 'conecta Search Console'} tone={d.totals.weakWithDemand ? 'bad' : 'good'} />
      </div>
      <div className="flex items-end gap-1 h-16" role="img" aria-label="Páginas por profundidad">
        {d.depthDistribution.map((x: any) => {
          const max = Math.max(...d.depthDistribution.map((y: any) => y.pages), 1);
          return (
            <div key={x.depth} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className={`w-full rounded-t ${Number(x.depth) > 3 || x.depth === '5+' ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ height: `${(x.pages / max) * 100}%`, minHeight: x.pages ? 2 : 0 }} title={`${x.pages} páginas`} />
              <span className="text-[10px] text-slate-500">{x.depth} clics · {x.pages}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div role="tablist" aria-label="Enlazado" className="flex gap-1">
          {([['pages', 'Páginas'], ['orphans', `Huérfanas (${d.orphans.length})`], ['suggest', 'Sugerencias de enlaces']] as const).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={view === id} onClick={() => (id === 'suggest' && !sug ? loadSuggestions() : setView(id))} className={`px-3 py-1.5 rounded-lg border ${view === id ? 'bg-slate-800 text-white' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
          ))}
        </div>
        {view === 'pages' && (
          <>
            <label>Orden <select aria-label="Orden de páginas" className={inputCls} value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="weak">Necesitan enlaces (demanda × debilidad)</option><option value="score">Link Score más alto</option><option value="depth">Más profundas</option></select></label>
            <input aria-label="Buscar página" placeholder="Buscar URL o título" className={`${inputCls} flex-1 min-w-[12rem]`} value={q} onChange={e => setQ(e.target.value)} />
            <Button variant="secondary" onClick={() => save('enlazado-interno.csv', '﻿' + [['URL', 'Título', 'Link Score', 'Enlaces entrantes', 'Enlaces salientes', 'Profundidad', 'Clics', 'Impresiones'], ...rows.map((p: any) => [p.url, p.title ?? '', p.linkScore, p.inlinks, p.outlinks, p.depth, p.clicks ?? '', p.impressions ?? ''])].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv')}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
          </>
        )}
      </div>

      {view === 'pages' && (
        <div className="overflow-auto max-h-[32rem]">
          <table className="w-full">
            <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Página</th><th>Link Score</th><th className="text-right">Entrantes</th><th className="text-right">Profundidad</th><th className="text-right">Impresiones</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.slice(0, 500).map((p: any) => (
                <tr key={p.url}>
                  <td className="py-1"><a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] break-all hover:underline">{path(p.url)}</a><div className="text-slate-500 truncate max-w-md">{p.title}</div></td>
                  <td className="whitespace-nowrap"><Bar v={p.linkScore} tone={p.linkScore < 30 ? 'bg-amber-500' : 'bg-indigo-500'} /> <span className="tabular-nums">{p.linkScore}</span></td>
                  <td className="text-right tabular-nums">{p.inlinks}</td>
                  <td className={`text-right tabular-nums ${p.depth > 3 ? 'text-amber-600 font-semibold' : ''}`}>{p.depth}</td>
                  <td className="text-right tabular-nums">{p.impressions === null ? '—' : fmt(p.impressions)}</td>
                  <td className="text-right"><button className="text-indigo-600 hover:underline" onClick={() => loadSuggestions(p.url)}>Buscar enlaces</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'orphans' && (!d.orphans.length ? <Empty>No hay páginas huérfanas.</Empty> : (
        <>
          <p className="text-slate-500">Páginas que Google o el sitemap conocen pero a las que no llega ningún enlace interno. Enlázalas desde páginas relacionadas o, si ya no sirven, redirígelas.</p>
          <table className="w-full">
            <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">URL</th><th>Dónde aparece</th><th className="text-right">Impresiones</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{d.orphans.slice(0, 500).map((o: any) => <tr key={o.url}><td className="py-1 font-mono text-[11px] break-all">{path(o.url)}</td><td>{o.source.join(', ')}</td><td className="text-right tabular-nums">{o.impressions === null ? '—' : fmt(o.impressions)}</td></tr>)}</tbody>
          </table>
        </>
      ))}

      {view === 'suggest' && (
        <div className="space-y-2">
          <p className="text-slate-500">Para las páginas que más lo necesitan, busca páginas del mismo tema (parecido del texto) que ya mencionan una buena frase (las búsquedas de Search Console de la página, su H1 o su título) y todavía no la enlazan. "Proponer en WordPress" crea un cambio en <button className="text-indigo-600 underline" onClick={() => go('seochanges')}>Cambios SEO</button> para aprobarlo, aplicarlo y, si hace falta, revertirlo.</p>
          {loadingSug ? <Skeleton rows={4} /> : sugErr ? <ErrorBox error={sugErr} /> : !sug?.suggestions.length ? <Empty>No se encontraron frases para enlazar. Prueba con otra página ("Buscar enlaces") o agrega texto relacionado.</Empty> : (
            <ul className="space-y-2">
              {sug.suggestions.map((s: any) => {
                const k = `${s.sourceUrl}|${s.targetUrl}`;
                return (
                  <li key={k} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>En <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:underline">{path(s.sourceUrl)}</a></span>
                      <span>enlaza <strong>«{s.anchor}»</strong> hacia <a href={s.targetUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:underline">{path(s.targetUrl)}</a></span>
                      <Badge>{s.similarity} % parecido</Badge>
                      <Badge tone="default">frase de {s.anchorSource}</Badge>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{s.context.split(/\[\[|\]\]/).map((part: string, i: number) => (i % 2 ? <mark key={i} className="bg-amber-200 dark:bg-amber-700/60 rounded px-0.5">{part}</mark> : part))}</p>
                    <div className="flex items-center gap-2">
                      {proposed[k] === 'ok' ? <Badge tone="good">Propuesto: revísalo en Cambios SEO</Badge> : <Button variant="secondary" disabled={!can('content:edit')} onClick={() => propose(s)}><Send className="w-3.5 h-3.5" aria-hidden /> Proponer en WordPress</Button>}
                      {proposed[k] && proposed[k] !== 'ok' && <span className="text-rose-600">{proposed[k]}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------
function Redirects({ siteId }: { siteId: string }) {
  const { can } = useAuth();
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/architecture/redirects`);
  const [rules, setRules] = useState<any[]>([]);
  const [push, setPush] = useState<any | null>(null);
  const [pushErr, setPushErr] = useState<unknown>(null);
  useEffect(() => {
    if (d?.rules) setRules(d.rules.map((r: any) => ({ ...r, on: r.confidence !== 'baja' })));
  }, [d]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.crawl) return <Empty>Haz un crawl del sitio para encontrar URLs rotas.</Empty>;
  const chosen = rules.filter(r => r.on && r.to);
  const rel = (to: string) => (to.startsWith(d.origin) ? to.slice(d.origin.length) || '/' : to);
  const exports = {
    htaccess: () => save('redirecciones.htaccess', ['# Redirecciones 301 generadas con G.SEO', ...chosen.map(r => `Redirect 301 ${r.from.replace(/ /g, '%20')} ${r.to}`)].join('\n') + '\n'),
    nginx: () => save('redirecciones-nginx.conf', ['# Redirecciones 301 generadas con G.SEO (dentro del bloque server)', ...chosen.map(r => `location = ${r.from.split('?')[0]} { return 301 ${rel(r.to)}; }`)].join('\n') + '\n'),
    csv: () => save('redirecciones.csv', '﻿' + [['Desde', 'Hacia', 'Confianza', 'Motivo', 'Origen'], ...chosen.map(r => [r.from, r.to, r.confidence, r.reason, r.sources.join(' + ')])].map(l => l.map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv')
  };
  const toWordPress = async () => {
    if (!confirm(`¿Crear ${chosen.length} redirecciones 301 en WordPress (plugin Redirection)?`)) return;
    setPushErr(null);
    try {
      setPush(await apiSend('POST', `/api/v1/sites/${siteId}/architecture/redirects/wordpress`, { rules: chosen.map(r => ({ from: r.from, to: r.to })) }));
    } catch (e) {
      setPushErr(e);
    }
  };
  const TONE: Record<string, 'good' | 'warn' | 'bad'> = { alta: 'good', media: 'warn', baja: 'bad' };
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">URLs rotas (404/410) que encontró el crawl{d.totals.fromLogs ? ', que Googlebot o los bots de IA visitan en los logs' : ''} o que Google muestra en Search Console, y las que reciben backlinks de otros sitios (primero, porque es autoridad que se pierde), con la página activa más parecida (palabras de la URL, título y, si un crawl anterior la tenía, su contenido). Revisa cada destino, marca las que quieras y expórtalas.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="URLs rotas" value={fmt(d.totals.rules)} tone={d.totals.rules ? 'warn' : 'good'} />
        <Kpi label="Confianza alta" value={fmt(d.totals.high)} tone="good" />
        <Kpi label="Confianza media" value={fmt(d.totals.medium)} />
        <Kpi label="Confianza baja" value={fmt(d.totals.low)} hint="revísalas a mano" />
      </div>
      {!rules.length ? <Empty>No hay URLs rotas.</Empty> : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-slate-500">{chosen.length} seleccionadas</span>
            <Button variant="secondary" onClick={exports.htaccess} disabled={!chosen.length}><Download className="w-3.5 h-3.5" aria-hidden /> .htaccess (Apache)</Button>
            <Button variant="secondary" onClick={exports.nginx} disabled={!chosen.length}><Download className="w-3.5 h-3.5" aria-hidden /> Nginx</Button>
            <Button variant="secondary" onClick={exports.csv} disabled={!chosen.length}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
            <Button onClick={toWordPress} disabled={!chosen.length || !can('wordpress:send')}><Send className="w-3.5 h-3.5" aria-hidden /> Enviar a WordPress (Redirection)</Button>
          </div>
          <ErrorBox error={pushErr} />
          {push && <p role="status" className={push.failed ? 'text-amber-700' : 'text-emerald-700'}>{push.created} creadas{push.failed ? `, ${push.failed} con error: ${push.results.filter((r: any) => !r.ok).map((r: any) => `${r.from} (${r.error})`).join('; ')}` : '.'}</p>}
          <div className="overflow-auto max-h-[32rem]">
            <table className="w-full">
              <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1 w-6"></th><th>Desde (rota)</th><th>Hacia</th><th>Confianza</th><th>Origen</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rules.map((r, i) => (
                  <tr key={r.from} className="align-top">
                    <td className="py-1"><input type="checkbox" aria-label={`Incluir ${r.from}`} checked={r.on} onChange={e => setRules(rs => rs.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /></td>
                    <td className="font-mono text-[11px] break-all">{r.from}{r.oldTitle && <div className="font-sans text-slate-500">Antes: {r.oldTitle}</div>}</td>
                    <td className="min-w-[16rem]"><input aria-label={`Destino de ${r.from}`} className={`${inputCls} w-full font-mono text-[11px]`} value={r.to} onChange={e => setRules(rs => rs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} /><div className="text-slate-500">{r.reason}</div></td>
                    <td><Badge tone={TONE[r.confidence]}>{r.confidence} · {r.score}</Badge></td>
                    <td className="text-slate-500">{r.sources.join(' + ')}{r.backlinks ? ` · ${r.backlinks} backlinks` : ''}{r.inlinks ? ` · ${r.inlinks} enlaces` : ''}{r.botHits ? ` · ${fmt(r.botHits)} visitas de bots` : ''}{r.impressions ? ` · ${fmt(r.impressions)} impr.` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-500">Redirigir todo a la página principal cuenta para Google como "soft 404": si no hay una página equivalente, a veces es mejor dejar el 404 (o 410) y quitar los enlaces que apuntan a ella.</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendering audit
// ---------------------------------------------------------------------------
function Rendering({ siteId, go }: { siteId: string; go: GoFn }) {
  const { d, error } = useData<any>(`/api/v1/sites/${siteId}/architecture/render`);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.crawl || !d.totals?.pages) return <Empty>Esta auditoría necesita un crawl con "Ejecutar JavaScript" activado. <button className="text-indigo-600 underline" onClick={() => go('crawler')}>Ir a Crawl y auditoría</button></Empty>;
  const t = d.totals;
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Compara lo que manda el servidor (lo que leen los bots de IA y Googlebot antes de renderizar) con la página después de ejecutar JavaScript, en el crawl del {fmtDate(d.crawl.startedAt)}.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Kpi label="Páginas renderizadas" value={fmt(t.pages)} />
        <Kpi label="Texto que depende de JS" value={`${t.avgTextLoss} %`} hint="promedio por página" tone={t.avgTextLoss >= 30 ? 'bad' : t.avgTextLoss >= 10 ? 'warn' : 'good'} />
        <Kpi label="Pierden 30 %+ sin JS" value={fmt(t.over30)} tone={t.over30 ? 'bad' : 'good'} />
        <Kpi label="Vacías sin JS" value={fmt(t.emptyWithoutJs)} tone={t.emptyWithoutJs ? 'bad' : 'good'} />
        <Kpi label="Enlaces solo con JS" value={fmt(t.jsOnlyLinks)} tone={t.jsOnlyLinks ? 'warn' : 'good'} />
        <Kpi label="Título/H1/canonical cambian" value={fmt(t.metaChanged)} tone={t.metaChanged ? 'warn' : 'good'} />
        <Kpi label="Con errores de JS" value={fmt(t.withErrors)} tone={t.withErrors ? 'warn' : 'good'} />
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
        {d.pages.slice(0, 300).map((p: any) => (
          <li key={p.id} className="p-2">
            <button className="w-full flex flex-wrap items-center gap-3 text-left" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="font-mono text-[11px] flex-1 min-w-[12rem] break-all">{path(p.url)}</span>
              <span className="whitespace-nowrap"><Bar v={p.textLoss} tone={p.textLoss >= 30 ? 'bg-rose-500' : p.textLoss >= 10 ? 'bg-amber-500' : 'bg-emerald-500'} /> {p.textLoss} % del texto</span>
              <span className="text-slate-500 tabular-nums">{fmt(p.rawWords)} → {fmt(p.renderedWords)} palabras</span>
              {p.jsOnlyLinks > 0 && <Badge tone="warn">{p.jsOnlyLinks} enlaces solo con JS</Badge>}
              {p.changed.length > 0 && <Badge tone="warn">Cambia: {p.changed.join(', ')}</Badge>}
              {p.jsErrors > 0 && <Badge tone="bad">{p.jsErrors} errores</Badge>}
            </button>
            {open === p.id && <div className="mt-2"><RenderDiffPanel crawlId={d.crawl.id} pageId={p.id} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Arquitectura: internal linking (+ auto-interlinking into WordPress), 301 rescue map and rendering audit. */
export function ArchitectureView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [tab, setTab] = useState<'links' | 'redirects' | 'render'>('links');
  return (
    <Card>
      <div role="tablist" aria-label="Arquitectura" className="flex flex-wrap gap-1 mb-4">
        {([['links', 'Enlazado interno'], ['redirects', 'Redirecciones 301'], ['render', 'Renderizado JavaScript']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'links' && <Links siteId={siteId} go={go} />}
      {tab === 'redirects' && <Redirects siteId={siteId} />}
      {tab === 'render' && <Rendering siteId={siteId} go={go} />}
    </Card>
  );
}
