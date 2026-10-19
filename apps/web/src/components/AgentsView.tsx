'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, Play, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn, JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const STATUS: Record<string, [string, 'good' | 'warn' | 'bad']> = { ok: ['Puede', 'good'], partial: ['Con trabas', 'warn'], fail: ['No puede', 'bad'] };
async function download(file: string) {
  const res = await fetch(`${API_URL}/api/v1/downloads/${file}`, { credentials: 'include' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = file;
  a.click();
}

// ---------------------------------------------------------------------------
function Navigation({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [urls, setUrls] = useState('');
  const [job, setJob] = useState<JobRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/agents/audit`).then(r => {
    setD(r);
    setUrls(u => u || ((r.audit?.urls as string[] | undefined) ?? r.suggestedUrls).join('\n'));
  }, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const run = async () => {
    setError(null);
    try {
      const { jobId } = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/agents/audit`, { urls: urls.split('\n').map(x => x.trim()).filter(Boolean) });
      const done = await waitForJob<JobRow>(jobId, setJob, 2000);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? 'La revisión no terminó.');
    } catch (e) {
      setError(e);
    } finally {
      setJob(null);
      load();
    }
  };
  if (!d) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const a = d.audit;
  const s = a?.summary;
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Cuando alguien le pide a su agente de IA (Claude, Operator de OpenAI, Gemini) "cotízame" o "agenda una cita en este sitio", el agente no ve el diseño: lee el árbol de accesibilidad y el HTML. Chrome abre tus páginas clave y revisa si un agente puede encontrar precios, llenar el formulario de contacto y usar el botón principal sin atorarse.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[18rem] space-y-1"><span className="block font-semibold">Páginas a revisar (una por línea, hasta 15)</span><textarea aria-label="Páginas a revisar" rows={4} className={`${inputCls} w-full font-mono`} value={urls} onChange={e => setUrls(e.target.value)} /></label>
        <Button disabled={!can('seo:operate') || !!job} onClick={run}><Play className="w-3.5 h-3.5" aria-hidden /> {job ? 'Revisando con Chrome…' : 'Revisar como agente'}</Button>
      </div>
      <p className="text-slate-500">Se sugieren la portada y las páginas de contacto, precios, servicios y tienda del último crawl.{!d.suggestedUrls.length && <> Haz un <button className="underline" onClick={() => go('crawler')}>crawl</button> para mejores sugerencias.</>}</p>
      <ErrorBox error={error} />
      {!a ? <Empty>Todavía no hay revisiones.</Empty> : a.status === 'failed' ? <p className="text-rose-600">La última revisión falló: {a.error}</p> : a.status === 'running' ? <p role="status">Revisando…</p> : (
        <>
          <p className="text-slate-500">Revisión del {fmtDate(a.completedAt ?? a.createdAt)} · {s.pages} página(s).</p>
          <div className="grid md:grid-cols-4 gap-2">
            <Kpi label="Puntaje para agentes" value={`${s.average}/100`} tone={s.average >= 75 ? 'good' : s.average >= 50 ? 'warn' : 'bad'} />
            {s.tasks.map((t: any) => (
              <div key={t.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="flex items-center gap-2"><Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge><strong>{t.label}</strong></div>
                <p className="text-slate-500">{t.detail}</p>
              </div>
            ))}
          </div>
          <div>
            <h4 className="font-semibold mb-1">Lo que más falla</h4>
            <ul className="space-y-1">{s.byCheck.filter((c: any) => c.applies).map((c: any) => <li key={c.id} className="flex items-center gap-2"><span className="w-64">{c.label}</span><div className="flex-1 h-2 rounded bg-slate-100 dark:bg-slate-800"><div className={`h-2 rounded ${c.failing ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.applies ? Math.max(4, (c.failing / c.applies) * 100) : 0}%` }} /></div><span className="w-32 text-right text-slate-500">{c.failing} de {c.applies} páginas</span></li>)}</ul>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
            {a.pages.map((p: any) => (
              <li key={p.url} className="p-2">
                <button className="w-full flex items-center gap-3 text-left" aria-expanded={open === p.url} onClick={() => setOpen(open === p.url ? null : p.url)}>
                  <span className={`w-12 text-right text-base font-black tabular-nums ${p.score >= 75 ? 'text-emerald-600' : p.score >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{p.checks.length ? p.score : '—'}</span>
                  <span className="flex-1 font-mono text-[11px] break-all">{path(p.url)}<span className="block font-sans text-slate-500">{p.title}</span></span>
                </button>
                {open === p.url && (
                  <div className="mt-2 ml-14 space-y-2">
                    <ul className="space-y-1.5" aria-label={`Revisiones de ${path(p.url)}`}>
                      {p.checks.map((c: any) => {
                        const def = d.checks[c.id];
                        const Icon = c.score === null ? CheckCircle2 : c.score >= 1 ? CheckCircle2 : c.score > 0 ? AlertTriangle : XCircle;
                        return (
                          <li key={c.id} className="flex gap-2">
                            <Icon className={`w-4 h-4 shrink-0 ${c.score === null ? 'text-slate-300' : c.score >= 1 ? 'text-emerald-600' : c.score > 0 ? 'text-amber-500' : 'text-rose-600'}`} aria-hidden />
                            <div><strong>{def.label}</strong> — {c.detail}{c.score !== null && c.score < 1 && <div className="text-slate-500"><strong>Cómo arreglarlo:</strong> {def.fix}</div>}</div>
                          </li>
                        );
                      })}
                    </ul>
                    {p.facts.fakeButtons.length > 0 && <details><summary className="cursor-pointer">Elementos clicables que no son controles ({p.facts.fakeButtons.length})</summary><ul className="font-mono text-[11px] mt-1">{p.facts.fakeButtons.slice(0, 15).map((f: any, i: number) => <li key={i}>&lt;{f.tag}&gt; {f.text}</li>)}</ul></details>}
                    {p.facts.forms.length > 0 && <details><summary className="cursor-pointer">Formularios ({p.facts.forms.length})</summary>{p.facts.forms.map((f: any, i: number) => <ul key={i} className="mt-1 ml-4 list-disc">{f.fields.map((x: any, j: number) => <li key={j}>{x.label ?? <em className="text-rose-600">sin etiqueta</em>} <span className="font-mono text-slate-500">({x.type}{x.name ? ` · ${x.name}` : ''}{x.autocomplete ? ` · autocomplete=${x.autocomplete}` : ''})</span></li>)}<li>Botón: {f.submit ?? <em className="text-rose-600">sin texto</em>}</li></ul>)}</details>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const blankItem = { id: '', kind: 'service', name: '', description: '', url: '', price: '' as string | number, currency: 'MXN', availability: '', category: '' };

function Catalog({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [biz, setBiz] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [check, setCheck] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/agents/catalog`).then(r => {
    setD(r);
    setBiz(r.business);
    setItems(r.items.map((i: any) => ({ ...blankItem, ...i, price: i.price ?? '', availability: i.availability ?? '' })));
  }, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (label: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(label);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg(ok);
      return r;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const payload = () => ({
    business: Object.fromEntries(Object.entries(biz).filter(([, v]) => v !== '' && v !== null && v !== undefined)),
    items: items.filter(i => i.name.trim()).map(i => ({ id: i.id, kind: i.kind, name: i.name, ...(i.description ? { description: i.description } : {}), ...(i.url ? { url: i.url } : {}), price: i.price === '' ? null : Number(i.price), ...(i.currency ? { currency: i.currency } : {}), availability: i.availability || null, ...(i.category ? { category: i.category } : {}) }))
  });
  if (!d || !biz) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const set = (k: string, v: string) => setBiz({ ...biz, [k]: v });
  const setItem = (i: number, k: string, v: string) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const ed = !can('content:edit');
  return (
    <div className="space-y-4 text-xs">
      <p className="text-slate-500">Así como llms.txt sirve para leer el sitio, esto le da a los agentes de IA una forma directa y confiable de consultar tus servicios, precios y contacto, sin raspar el HTML. Se publica en tu WordPress como <span className="font-mono">/.well-known/agent.json</span>, un catálogo JSON y un <strong>servidor MCP</strong> de solo lectura. Comprar, agendar o cotizar sigue pasando por tu sitio.</p>
      <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <h4 className="font-semibold">1. Instala el plugin en WordPress (una vez)</h4>
        <p className="text-slate-500">Descárgalo y súbelo a <span className="font-mono">wp-content/mu-plugins/</span> (por FTP o el administrador de archivos de cPanel). Si tienes WooCommerce, tus productos se agregan solos. Para publicar desde aquí, el usuario de WordPress conectado debe ser administrador.</p>
        <Button variant="secondary" onClick={() => download('glitch-agents.php')}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar glitch-agents.php</Button>
      </div>

      <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <h4 className="font-semibold">2. Tu negocio</h4>
        <div className="grid md:grid-cols-3 gap-2">
          {[['name', 'Nombre'], ['url', 'Sitio'], ['email', 'Correo'], ['phone', 'Teléfono'], ['address', 'Dirección'], ['hours', 'Horario'], ['areaServed', 'Zona que atiendes'], ['quoteUrl', 'Página para cotizar'], ['bookingUrl', 'Página para agendar'], ['contactUrl', 'Página de contacto']].map(([k, l]) => (
            <label key={k} className="space-y-1"><span className="block font-semibold">{l}</span><input aria-label={l} className={`${inputCls} w-full`} disabled={ed} value={biz[k] ?? ''} onChange={e => set(k, e.target.value)} /></label>
          ))}
          <label className="space-y-1 md:col-span-3"><span className="block font-semibold">Descripción</span><textarea aria-label="Descripción del negocio" rows={2} className={`${inputCls} w-full`} disabled={ed} value={biz.description ?? ''} onChange={e => set('description', e.target.value)} /></label>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-semibold flex-1">3. Servicios y productos ({items.filter(i => i.name.trim()).length})</h4>
          {d.suggestions.items.length > 0 && <Button variant="secondary" disabled={ed} onClick={() => setItems(xs => [...xs, ...d.suggestions.items.filter((s: any) => !xs.some(x => x.name === s.name)).map((s: any) => ({ ...blankItem, ...s, price: s.price ?? '', availability: s.availability ?? '' }))])}>Agregar los del schema del sitio ({d.suggestions.items.length})</Button>}
          <Button variant="secondary" disabled={ed} onClick={() => setItems(xs => [...xs, { ...blankItem }])}><Plus className="w-3.5 h-3.5" aria-hidden /> Agregar</Button>
        </div>
        {!items.length ? <Empty>Agrega lo que vendes u ofreces, con su precio (o "desde"), para que un agente pueda responder "¿cuánto cuesta?".</Empty> : (
          <div className="overflow-auto">
            <table className="w-full">
              <thead><tr className="text-slate-500 text-left"><th>Tipo</th><th>Nombre</th><th>Precio</th><th>Moneda</th><th>Disponibilidad</th><th>Página</th><th>Descripción</th><th></th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="align-top">
                    <td><select aria-label={`Tipo ${i + 1}`} className={inputCls} disabled={ed} value={it.kind} onChange={e => setItem(i, 'kind', e.target.value)}><option value="service">Servicio</option><option value="product">Producto</option></select></td>
                    <td><input aria-label={`Nombre ${i + 1}`} className={`${inputCls} w-44`} disabled={ed} value={it.name} onChange={e => setItem(i, 'name', e.target.value)} /></td>
                    <td><input aria-label={`Precio ${i + 1}`} type="number" min={0} className={`${inputCls} w-24`} disabled={ed} value={it.price} onChange={e => setItem(i, 'price', e.target.value)} placeholder="a consultar" /></td>
                    <td><input aria-label={`Moneda ${i + 1}`} className={`${inputCls} w-16`} disabled={ed} value={it.currency} onChange={e => setItem(i, 'currency', e.target.value)} /></td>
                    <td><select aria-label={`Disponibilidad ${i + 1}`} className={inputCls} disabled={ed} value={it.availability} onChange={e => setItem(i, 'availability', e.target.value)}><option value="">—</option><option value="InStock">Disponible</option><option value="OnRequest">Bajo pedido</option><option value="PreOrder">Preventa</option><option value="OutOfStock">Agotado</option></select></td>
                    <td><input aria-label={`Página ${i + 1}`} className={`${inputCls} w-48 font-mono`} disabled={ed} value={it.url} onChange={e => setItem(i, 'url', e.target.value)} /></td>
                    <td><input aria-label={`Descripción ${i + 1}`} className={`${inputCls} w-56`} disabled={ed} value={it.description} onChange={e => setItem(i, 'description', e.target.value)} /></td>
                    <td><button aria-label={`Quitar ${it.name || i + 1}`} disabled={ed} onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} className="text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button disabled={ed || !!busy} onClick={() => act('save', async () => { await apiSend('PUT', `/api/v1/sites/${siteId}/agents/catalog`, payload()); await load(); }, 'Catálogo guardado.')}>Guardar catálogo</Button>
        <Button variant="secondary" disabled={!can('wordpress:send') || !!busy || !d.saved} onClick={() => act('publish', async () => { setCheck(await apiSend('POST', `/api/v1/sites/${siteId}/agents/catalog/publish`)); }, 'Publicado en WordPress.')}><Send className="w-3.5 h-3.5" aria-hidden /> {busy === 'publish' ? 'Publicando…' : 'Publicar en WordPress'}</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => act('check', async () => setCheck(await apiGet(`/api/v1/sites/${siteId}/agents/validate`)))}>Comprobar en vivo</Button>
        {!d.saved && <span className="text-slate-500">Guarda el catálogo antes de publicarlo.</span>}
      </div>
      {msg && <p role="status" className="text-emerald-700">{msg}</p>}
      <ErrorBox error={error} />
      {error && /NO_CONNECTION|WordPress para este sitio/.test(String((error as Error).message)) && <button className="underline text-indigo-600" onClick={() => go('wordpress')}>Conectar WordPress</button>}
      {check && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1" aria-label="Comprobación en vivo">
          <h4 className="font-semibold">Lo que ven los agentes en {check.origin}</h4>
          {check.checks.map((c: any) => <p key={c.id} className="flex gap-2">{c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Bien" /> : <XCircle className="w-4 h-4 text-rose-600" aria-label="Falta" />}<span><strong>{c.label}:</strong> {c.detail}</span></p>)}
          {check.ok && (
            <div className="text-slate-500 space-y-1">
              <p>Para usarlo desde Claude o ChatGPT: agrega un conector personalizado (MCP remoto) con esta dirección:</p>
              <div className="flex items-center gap-2"><code className="font-mono">{check.mcpUrl}</code><button aria-label="Copiar dirección MCP" onClick={() => navigator.clipboard?.writeText(check.mcpUrl)}><Copy className="w-4 h-4" /></button></div>
            </div>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-semibold">Vista previa de agent.json</summary>
        <pre aria-label="Vista previa de agent.json" className="font-mono text-[11px] whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 p-2 rounded max-h-72 overflow-auto">{JSON.stringify(d.preview.agent, null, 2)}</pre>
      </details>
      <p className="text-[11px] text-slate-500">Todavía no hay un estándar único para agentes (compiten MCP, las "agent cards" de A2A, NLWeb y otros): esto publica lo más útil hoy, de solo lectura, y se puede ampliar cuando uno se imponga.</p>
    </div>
  );
}

/** Agentes de IA: can an autonomous agent use the site, and a catalog it can query directly. */
export function AgentsView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [tab, setTab] = useState<'nav' | 'catalog'>('nav');
  return (
    <Card>
      <div role="tablist" aria-label="Agentes de IA" className="flex flex-wrap gap-1 mb-4">
        {([['nav', 'Navegación de agentes'], ['catalog', 'Catálogo para agentes (MCP)']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'nav' ? <Navigation siteId={siteId} go={go} /> : <Catalog siteId={siteId} go={go} />}
    </Card>
  );
}
