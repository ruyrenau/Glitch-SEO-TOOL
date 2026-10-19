'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Play, Plus, Trash2, Upload } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmt, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn, JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const path = (u: string | null) => {
  if (!u) return '—';
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
function save(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}
const STATUS: Record<string, [string, 'good' | 'warn' | 'bad' | 'default']> = { live: ['Vivo', 'good'], lost: ['Perdido', 'bad'], 'source-error': ['La página ya no existe', 'warn'], blocked: ['Bloqueado por robots.txt', 'default'], pending: ['Pendiente', 'default'] };

// ---------------------------------------------------------------------------
function Backlinks({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [view, setView] = useState<'rescue' | 'lost' | 'suspicious' | 'domains' | 'anchors' | 'all'>('rescue');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/backlinks`).then(setD, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const upload = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch(`${API_URL}/api/v1/sites/${siteId}/backlinks?fileName=${encodeURIComponent(file.name)}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/csv' }, body: text });
      const j = await res.json();
      if (!res.ok) throw Object.assign(new Error(j?.error?.message ?? 'No se pudo subir el archivo.'), { code: j?.error?.code });
      await load();
      await waitForJob<JobRow>(j.jobId, setJob, 2000);
    } catch (e) {
      setError(e);
    } finally {
      setJob(null);
      load();
    }
  };
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.report?.links ?? []).filter((l: any) => !t || l.sourceUrl.toLowerCase().includes(t) || (l.anchor ?? '').toLowerCase().includes(t));
  }, [d, q]);
  if (!d) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const r = d.report;
  const t = r?.totals;
  const LinkTable = ({ items }: { items: any[] }) => (
    <div className="overflow-auto max-h-[30rem]">
      <table className="w-full">
        <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Página que enlaza</th><th>Estado</th><th>Tipo</th><th>Texto</th><th>Llega a</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.slice(0, 500).map((l: any) => (
            <tr key={l.id} className="align-top">
              <td className="py-1"><a href={l.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] break-all hover:underline">{l.sourceUrl}</a>{l.toxicReasons?.length > 0 && <ul className="list-disc ml-4 text-amber-700 dark:text-amber-400">{l.toxicReasons.map((x: string) => <li key={x}>{x}</li>)}</ul>}</td>
              <td><Badge tone={STATUS[l.status]?.[1] ?? 'default'}>{STATUS[l.status]?.[0] ?? l.status}{l.status === 'source-error' && l.sourceStatus ? ` (${l.sourceStatus})` : ''}</Badge></td>
              <td>{l.rel ?? '—'}</td>
              <td className="max-w-[12rem] break-words">{l.anchor ?? '—'}</td>
              <td className="font-mono text-[11px] break-all">{path(l.targetUrl)}{l.targetStatus && l.targetStatus !== 200 ? <span className={l.targetStatus >= 400 ? 'text-rose-600' : 'text-amber-600'}> · {l.targetStatus}</span> : ''}{l.targetHops ? <span className="text-amber-600"> · {l.targetHops} redirección(es)</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Sube un CSV de enlaces externos y G.SEO visita cada página que te enlaza (despacio y respetando su robots.txt) para ver si el enlace sigue ahí, si es follow o nofollow/sponsored/ugc y a dónde llega en tu sitio. Los enlaces que caen en un 404 tuyo son autoridad que puedes recuperar con una 301.</p>
      <details className="text-slate-500">
        <summary className="cursor-pointer">¿De dónde saco el CSV?</summary>
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          <li><strong>Search Console:</strong> Enlaces → "Más sitios que enlazan" (o "Enlaces externos") → Exportar → "Exportar enlaces más recientes". Trae la página exacta que te enlaza.</li>
          <li><strong>Ahrefs:</strong> Site Explorer → Backlinks → Export. <strong>Semrush:</strong> Backlink Analytics → Backlinks → Export. <strong>Moz / Majestic:</strong> exportación de enlaces.</li>
          <li>Cualquier CSV con una columna de la página que enlaza (y opcionalmente la URL de destino y el texto del enlace). Hasta 20,000 filas.</li>
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${can('seo:operate') && !job ? 'bg-indigo-600 text-white cursor-pointer' : 'bg-slate-200 text-slate-500'}`}>
          <Upload className="w-3.5 h-3.5" aria-hidden /> Subir CSV de backlinks
          <input type="file" accept=".csv,text/csv" aria-label="CSV de backlinks" className="sr-only" disabled={!can('seo:operate') || !!job} onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {job && <span role="status">Revisando: {fmt(Number((job.progressDetail as Record<string, unknown> | null)?.checked ?? 0))} de {fmt(Number((job.progressDetail as Record<string, unknown> | null)?.total ?? r?.import?.rows ?? 0))} páginas…</span>}
        {r?.import && !job && <span className="text-slate-500">{r.import.fileName} · {fmtDate(r.import.createdAt)} · {r.import.format} · {r.import.status === 'running' ? 'revisando…' : r.import.status === 'failed' ? `falló: ${r.import.error}` : `${fmt(r.import.checked)} de ${fmt(r.import.rows)} revisados`}</span>}
      </div>
      <ErrorBox error={error} />
      {!t ? <Empty>Todavía no subes un archivo de backlinks.</Empty> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <Kpi label="Enlaces" value={fmt(t.links)} hint={`${fmt(t.domains)} dominios`} />
            <Kpi label="Vivos" value={fmt(t.live)} hint={`${fmt(t.follow)} follow`} tone="good" />
            <Kpi label="Perdidos" value={fmt(t.lost + t.sourceError)} tone={t.lost + t.sourceError ? 'warn' : 'good'} />
            <Kpi label="nofollow / sponsored / ugc" value={`${fmt(t.nofollow)} / ${fmt(t.sponsored)} / ${fmt(t.ugc)}`} />
            <Kpi label="Llegan a un 404 tuyo" value={fmt(t.toBroken)} tone={t.toBroken ? 'bad' : 'good'} />
            <Kpi label="Pasan por redirección" value={fmt(t.toRedirect)} />
            <Kpi label="Sospechosos" value={fmt(t.suspicious)} tone={t.suspicious ? 'warn' : 'good'} />
          </div>
          <div role="tablist" aria-label="Backlinks" className="flex flex-wrap gap-1">
            {([['rescue', `Autoridad para rescatar (${r.rescue.length})`], ['lost', `Perdidos (${r.lost.length})`], ['suspicious', `Sospechosos (${r.suspicious.length})`], ['domains', 'Dominios'], ['anchors', 'Textos de enlace'], ['all', 'Todos']] as const).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`px-3 py-1.5 rounded-lg border ${view === id ? 'bg-slate-800 text-white' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
            ))}
          </div>
          {view === 'rescue' && (!r.rescue.length ? <Empty>Ningún backlink vivo llega a un 404 de tu sitio.</Empty> : (
            <>
              <p className="text-slate-500">Páginas tuyas que ya no existen pero siguen recibiendo enlaces de otros sitios. Redirígelas con una 301 a la página más parecida y recuperas esa autoridad. Ya aparecen primero en <button className="text-indigo-600 underline" onClick={() => go('architecture')}>Arquitectura → Redirecciones 301</button>.</p>
              <table className="w-full max-w-3xl"><thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">URL rota</th><th className="text-right">Backlinks</th><th className="text-right">Dominios</th><th className="text-right">Follow</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{r.rescue.map((x: any) => <tr key={x.target}><td className="py-1 font-mono text-[11px] break-all">{path(x.target)}</td><td className="text-right tabular-nums">{x.links}</td><td className="text-right tabular-nums">{x.domains}</td><td className="text-right tabular-nums">{x.follow}</td></tr>)}</tbody></table>
            </>
          ))}
          {view === 'lost' && (!r.lost.length ? <Empty>No hay enlaces perdidos.</Empty> : <><p className="text-slate-500">Páginas que ya no te enlazan o que ya no existen. Si eran valiosas, contacta al sitio para recuperar el enlace.</p><LinkTable items={r.lost} /></>)}
          {view === 'suspicious' && (!r.suspicious.length ? <Empty>No hay enlaces sospechosos.</Empty> : (
            <>
              <p className="text-slate-500">Señales por reglas simples (dominios de spam, temas como casino o farmacia, granjas con cientos de enlaces). <strong>Google ignora casi todo el spam por su cuenta</strong>: usa el archivo disavow solo si recibiste una acción manual o hay un ataque claro. Marca dominios para incluirlos.</p>
              <ul className="space-y-1">{[...new Set(r.suspicious.map((l: any) => l.sourceDomain))].map((dom: any) => <li key={dom}><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={picked.has(dom)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(dom); else n.delete(dom); return n; })} /> <span className="font-mono">{dom}</span></label></li>)}</ul>
              <Button variant="secondary" disabled={!picked.size} onClick={() => save('disavow.txt', [`# Disavow generado con G.SEO el ${new Date().toISOString().slice(0, 10)}`, ...[...picked].map(dd => `domain:${dd}`)].join('\n') + '\n')}><Download className="w-3.5 h-3.5" aria-hidden /> Archivo disavow ({picked.size} dominios)</Button>
              <LinkTable items={r.suspicious} />
            </>
          ))}
          {view === 'domains' && <table className="w-full max-w-3xl"><thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Dominio</th><th className="text-right">Enlaces</th><th className="text-right">Vivos</th><th className="text-right">Follow</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{r.topDomains.map((x: any) => <tr key={x.domain}><td className="py-1 font-mono">{x.domain}{x.toxic >= 40 && <Badge tone="warn">sospechoso</Badge>}</td><td className="text-right tabular-nums">{x.links}</td><td className="text-right tabular-nums">{x.live}</td><td className="text-right tabular-nums">{x.follow}</td></tr>)}</tbody></table>}
          {view === 'anchors' && <table className="w-full max-w-3xl"><thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Texto del enlace</th><th className="text-right">Enlaces vivos</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{r.anchors.map((x: any) => <tr key={x.anchor}><td className="py-1">{x.anchor}</td><td className="text-right tabular-nums">{x.links}</td></tr>)}</tbody></table>}
          {view === 'all' && (
            <>
              <div className="flex gap-2"><input aria-label="Buscar backlink" placeholder="Buscar URL o texto" className={`${inputCls} flex-1 max-w-md`} value={q} onChange={e => setQ(e.target.value)} /><Button variant="secondary" onClick={() => save('backlinks.csv', '﻿' + [['Página que enlaza', 'Estado', 'Tipo', 'Texto', 'Destino', 'Estado destino', 'Sospecha'], ...rows.map((l: any) => [l.sourceUrl, l.status, l.rel ?? '', l.anchor ?? '', l.targetUrl ?? '', l.targetStatus ?? '', l.toxicScore])].map(x => x.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv')}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button></div>
              <LinkTable items={rows} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const COUNTRIES = [['mx', 'México'], ['es', 'España'], ['us', 'Estados Unidos'], ['co', 'Colombia'], ['ar', 'Argentina'], ['cl', 'Chile'], ['pe', 'Perú'], ['ec', 'Ecuador'], ['gt', 'Guatemala'], ['uy', 'Uruguay']];
const TONE = { bad: 'border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200', warn: 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200', good: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200', info: 'border-slate-200 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300' } as const;

function Serp({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [cfg, setCfg] = useState<{ enabled: boolean; gl: string; hl: string } | null>(null);
  const [newKw, setNewKw] = useState('');
  const [sug, setSug] = useState<any[] | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/serp`).then(r => {
    setD(r);
    setCfg({ enabled: r.config.enabled, gl: r.config.gl, hl: r.config.hl });
  }, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const run = async () => {
    setError(null);
    try {
      const { jobId } = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/serp/run`);
      const done = await waitForJob<JobRow>(jobId, setJob, 2000);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? 'La revisión no terminó.');
    } catch (e) {
      setError(e);
    } finally {
      setJob(null);
      load();
    }
  };
  if (!d || !cfg) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const c = d.config;
  const op = can('seo:operate');
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Una foto semanal de la página de resultados de Google de tus keywords principales: qué bloques aparecen (AI Overview, People Also Ask, fragmento destacado, Reddit y foros, videos…), en qué posición estás, si el AI Overview te cita y quién está arriba. Cruzado con Search Console, explica caídas de clics que no son caídas de ranking.</p>
      {!c.hasKey && <p className="text-amber-700 dark:text-amber-400 font-semibold">Falta la clave de SerpAPI. Agrégala en <button className="underline" onClick={() => go('settings')}>Configuración</button> (serpapi.com: 100 búsquedas gratis al mes; cada keyword usa una por semana).</p>}

      <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <label className="flex items-center gap-1.5"><input type="checkbox" aria-label="Revisión semanal" disabled={!op} checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} /> Revisar cada semana</label>
        <label>País <select aria-label="País de Google" className={inputCls} disabled={!op} value={cfg.gl} onChange={e => setCfg({ ...cfg, gl: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Idioma <select aria-label="Idioma de Google" className={inputCls} disabled={!op} value={cfg.hl} onChange={e => setCfg({ ...cfg, hl: e.target.value })}><option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option></select></label>
        <Button variant="secondary" disabled={!op} onClick={() => act(() => apiSend('PUT', `/api/v1/sites/${siteId}/serp/config`, cfg), 'Guardado.')}>Guardar</Button>
        <Button disabled={!op || !c.hasKey || !c.keywords.length || !!job} onClick={run}><Play className="w-3.5 h-3.5" aria-hidden /> {job ? 'Revisando…' : 'Revisar ahora'}</Button>
        <span className="text-slate-500">{c.keywords.length} de {c.max} keywords{c.lastRunAt ? ` · última revisión ${fmtDate(c.lastRunAt)}` : ''}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input aria-label="Nuevas keywords" placeholder="Keywords separadas por coma" className={`${inputCls} flex-1`} disabled={!op} value={newKw} onChange={e => setNewKw(e.target.value)} />
            <Button variant="secondary" disabled={!op || !newKw.trim()} onClick={() => act(async () => { await apiSend('POST', `/api/v1/sites/${siteId}/serp/keywords`, { keywords: newKw.split(',') }); setNewKw(''); })}><Plus className="w-3.5 h-3.5" aria-hidden /> Agregar</Button>
            <Button variant="secondary" disabled={!op} onClick={() => apiGet<any[]>(`/api/v1/sites/${siteId}/serp/suggestions`).then(setSug, setError)}>Sugerir desde Temas</Button>
          </div>
          {sug && (sug.length ? (
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1">
              <p className="text-slate-500">Búsqueda principal de tus temas con más impresiones (Análisis de contenido → Temas):</p>
              <ul className="space-y-0.5">{sug.map(s => <li key={s.keyword} className="flex gap-2 items-center"><button className="text-indigo-600 hover:underline" onClick={() => act(async () => { await apiSend('POST', `/api/v1/sites/${siteId}/serp/keywords`, { keywords: [s.keyword] }); setSug(x => x!.filter(y => y.keyword !== s.keyword)); })}>+ {s.keyword}</button><span className="text-slate-500">{fmt(s.impressions)} impr.</span></li>)}</ul>
            </div>
          ) : <p className="text-slate-500">No hay sugerencias: importa Search Console para tener temas.</p>)}
          {c.keywords.length > 0 && <ul className="flex flex-wrap gap-1">{c.keywords.map((k: any) => <li key={k.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">{k.keyword}<button aria-label={`Quitar ${k.keyword}`} disabled={!op} onClick={() => act(() => apiSend('DELETE', `/api/v1/sites/${siteId}/serp/keywords/${k.id}`))} className="text-slate-400 hover:text-rose-600"><Trash2 className="w-3 h-3" /></button></li>)}</ul>}
        </div>
        {d.featureShare.length > 0 && (
          <div>
            <h4 className="font-semibold mb-1">En cuántas de tus keywords aparece cada bloque</h4>
            <ul className="space-y-1">{d.featureShare.map((f: any) => <li key={f.feature} className="flex items-center gap-2"><span className="w-48">{f.label}</span><div className="flex-1 h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-indigo-500" style={{ width: `${f.pct}%` }} /></div><span className="w-10 text-right tabular-nums">{f.pct} %</span></li>)}</ul>
          </div>
        )}
      </div>
      {msg && <p role="status" className="text-emerald-700">{msg}</p>}
      <ErrorBox error={error} />

      {d.totals.checked > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <Kpi label="Keywords revisadas" value={fmt(d.totals.checked)} />
          <Kpi label="Con AI Overview" value={`${d.totals.aiOverview} %`} />
          <Kpi label="El AI Overview te cita" value={fmt(d.totals.aiCitesUs)} tone="good" />
          <Kpi label="AI Overview sin ti" value={fmt(d.totals.aiWithoutUs)} tone={d.totals.aiWithoutUs ? 'warn' : 'good'} />
          <Kpi label="En el top 3" value={fmt(d.totals.top3)} />
          <Kpi label="Caídas explicadas" value={fmt(d.totals.explainedDrops)} tone={d.totals.explainedDrops ? 'bad' : 'good'} />
        </div>
      )}
      {!d.items.some((i: any) => i.last) ? <Empty>{c.keywords.length ? 'Pulsa "Revisar ahora" para tomar la primera foto.' : 'Agrega keywords para empezar.'}</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
          {d.items.filter((i: any) => i.last).map((i: any) => (
            <li key={i.id} className="p-2">
              <button className="w-full flex flex-wrap items-center gap-2 text-left" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>
                <span className="font-semibold flex-1 min-w-[10rem]">{i.keyword}</span>
                <span className="tabular-nums">{i.last.position ? `#${i.last.position}` : 'fuera del top 10'}</span>
                {i.last.features.map((f: string) => <Badge key={f} tone={i.added.includes(f) ? 'warn' : 'default'}>{d.features[f]?.label ?? f}{i.added.includes(f) ? ' (nuevo)' : ''}</Badge>)}
                {i.last.aiCitesUs === true && <Badge tone="good">AI Overview te cita</Badge>}
                {i.last.aiCitesUs === false && <Badge tone="bad">AI Overview sin ti</Badge>}
                {i.gsc?.clickChange !== null && i.gsc?.clickChange !== undefined && <span className={`tabular-nums ${i.gsc.clickChange <= -30 ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{i.gsc.clickChange > 0 ? '+' : ''}{i.gsc.clickChange} % clics</span>}
              </button>
              {i.insights.length > 0 && <ul className="mt-1 space-y-1">{i.insights.map((x: any, k: number) => <li key={k} className={`p-1.5 rounded border ${TONE[x.tone as keyof typeof TONE]}`}>{x.text}</li>)}</ul>}
              {open === i.id && (
                <div className="mt-2 grid md:grid-cols-3 gap-3">
                  <div><h5 className="font-semibold">Top 10 ({i.last.date})</h5><ol className="list-decimal ml-5">{i.last.topDomains.map((t: any) => <li key={t.position} className={t.url === i.last.url ? 'font-semibold text-indigo-600' : ''}>{t.domain}</li>)}</ol></div>
                  <div><h5 className="font-semibold">Fuentes del AI Overview</h5>{i.last.aiSources.length ? <ul className="list-disc ml-5">{i.last.aiSources.map((s: any) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.domain}</a></li>)}</ul> : <p className="text-slate-500">—</p>}</div>
                  <div><h5 className="font-semibold">Historial</h5><table className="w-full"><tbody>{[...i.history].reverse().map((h: any) => <tr key={h.date}><td className="pr-2 tabular-nums">{h.date}</td><td className="pr-2 tabular-nums">{h.position ? `#${h.position}` : '—'}</td><td className="text-slate-500">{h.features.map((f: string) => d.features[f]?.label ?? f).join(', ')}</td></tr>)}</tbody></table></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Autoridad y SERP: backlinks from a CSV checked by the crawler, and weekly SERP & AI snapshots. */
export function AuthorityView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [tab, setTab] = useState<'backlinks' | 'serp'>('backlinks');
  return (
    <Card>
      <div role="tablist" aria-label="Autoridad y SERP" className="flex flex-wrap gap-1 mb-4">
        {([['backlinks', 'Backlinks'], ['serp', 'SERP e IA']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'backlinks' ? <Backlinks siteId={siteId} go={go} /> : <Serp siteId={siteId} go={go} />}
    </Card>
  );
}
