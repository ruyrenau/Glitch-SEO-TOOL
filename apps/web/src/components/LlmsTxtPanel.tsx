'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, XCircle, AlertTriangle, Info, Send } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmt } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

interface Check { id: string; label: string; ok: boolean; severity: 'error' | 'warn' | 'info'; detail: string }
interface Link { text: string; url: string; section: string; status: 'ok' | 'not-crawled' | 'broken' | 'non-indexable' | 'external' | 'invalid'; detail?: string }
interface Validation { url: string; found: boolean; status: number | null; servesHtml: boolean; fullFound: boolean; crawled?: boolean; result: { checks: Check[]; links: Link[]; sections: string[]; errors: number; warnings: number } | null }
interface Generated { text: string; links: number; sections: number; skipped: number; crawl: { startedAt: string } }

const LINK: Record<Link['status'], [string, 'good' | 'warn' | 'bad' | 'default']> = { ok: ['Bien', 'good'], 'not-crawled': ['No está en el crawl', 'warn'], broken: ['Rota', 'bad'], 'non-indexable': ['No indexable', 'warn'], external: ['Externa', 'default'], invalid: ['Inválida', 'bad'] };

async function download(path: string, name: string) {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? 'No se pudo descargar.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
}

/** llms.txt: checks the published file and generates one (and llms-full.txt) from the latest crawl. */
export function LlmsTxtPanel({ siteId, hasCrawl }: { siteId: string; hasCrawl: boolean }) {
  const [v, setV] = useState<Validation | null>(null);
  const [g, setG] = useState<Generated | null>(null);
  const [perSection, setPerSection] = useState(25);
  const [fullPages, setFullPages] = useState(30);
  const [summary, setSummary] = useState('');
  const { can } = useAuth();
  const [published, setPublished] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!g) return;
    setPublishing(true);
    setError(null);
    try {
      const r = await apiSend<{ url: string }>('POST', `/api/v1/sites/${siteId}/wordpress/llms`, { llms: g.text });
      setPublished(r.url);
    } catch (e) {
      setError(e);
    } finally {
      setPublishing(false);
    }
  };
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<Validation>(`/api/v1/sites/${siteId}/llms-txt`).then(setV, setError);
  }, [siteId]);
  const q = () => `perSection=${perSection}${summary.trim() ? `&summary=${encodeURIComponent(summary.trim())}` : ''}`;
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setG(await apiGet<Generated>(`/api/v1/sites/${siteId}/llms-txt/generate?${q()}`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const dl = (kind: 'llms' | 'full') => download(`/api/v1/sites/${siteId}/llms-txt/generate?${q()}&download=${kind}${kind === 'full' ? `&fullPages=${fullPages}` : ''}`, kind === 'full' ? 'llms-full.txt' : 'llms.txt').catch(setError);

  return (
    <Card title="llms.txt">
      <div className="text-xs space-y-4">
        <p className="text-slate-600 dark:text-slate-300">Un archivo en Markdown en la raíz del sitio (<span className="font-mono">/llms.txt</span>) que le da a los modelos de lenguaje un mapa limpio del sitio: nombre, resumen y enlaces a las páginas importantes con una descripción. <span className="font-mono">/llms-full.txt</span> incluye además el texto completo. Es un estándar nuevo y opcional: no reemplaza a robots.txt ni al sitemap.</p>

        <section aria-label="Validación del llms.txt publicado" className="space-y-2">
          <h3 className="font-semibold text-sm">El que tienes publicado</h3>
          {!v ? <Skeleton rows={2} /> : !v.found ? (
            <p className="flex items-center gap-2"><Info className="w-4 h-4 text-slate-400" aria-hidden /> {v.servesHtml ? `${v.url} devuelve una página HTML (probablemente un 404 personalizado), no un llms.txt.` : `No hay llms.txt en ${v.url}${v.status ? ` (HTTP ${v.status})` : ''}.`} Puedes generarlo abajo y subirlo a la raíz del sitio.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <a href={v.url} target="_blank" rel="noreferrer" className="font-mono underline">{v.url}</a>
                <Badge tone={v.result!.errors ? 'bad' : v.result!.warnings ? 'warn' : 'good'}>{v.result!.errors ? `${v.result!.errors} error(es)` : v.result!.warnings ? `${v.result!.warnings} aviso(s)` : 'Correcto'}</Badge>
                <Badge tone={v.fullFound ? 'good' : 'default'}>{v.fullFound ? 'llms-full.txt encontrado' : 'Sin llms-full.txt'}</Badge>
              </div>
              <ul className="space-y-1">
                {v.result!.checks.map(c => {
                  const Icon = c.ok ? CheckCircle2 : c.severity === 'error' ? XCircle : c.severity === 'warn' ? AlertTriangle : Info;
                  return <li key={c.id} className="flex gap-2"><Icon className={`w-4 h-4 shrink-0 ${c.ok ? 'text-emerald-600' : c.severity === 'error' ? 'text-rose-600' : c.severity === 'warn' ? 'text-amber-500' : 'text-slate-400'}`} aria-hidden /><span><strong>{c.label}</strong> — {c.detail}</span></li>;
                })}
              </ul>
              {!v.crawled && <p className="text-slate-500">Sin crawl del sitio no se puede comprobar si los enlaces funcionan.</p>}
              {v.result!.links.some(l => l.status !== 'ok' && l.status !== 'external') && (
                <table className="w-full">
                  <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Enlace</th><th>Sección</th><th>Estado</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {v.result!.links.filter(l => l.status !== 'ok' && l.status !== 'external').map(l => <tr key={l.url + l.text}><td className="py-1"><span className="font-semibold">{l.text}</span> <span className="font-mono text-[11px] break-all text-slate-500">{l.url}</span></td><td>{l.section}</td><td><Badge tone={LINK[l.status][1]}>{LINK[l.status][0]}</Badge> {l.detail}</td></tr>)}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>

        <section aria-label="Generar llms.txt" className="space-y-2">
          <h3 className="font-semibold text-sm">Generar desde el crawl</h3>
          {!hasCrawl ? <Empty>Haz un crawl del sitio para generar el llms.txt.</Empty> : (
            <>
              <p className="text-slate-500">Usa las páginas indexables del último crawl, agrupadas por carpeta, con su título y meta description. Primero las que más clics traen (Search Console) y las más enlazadas. Legales, etiquetas y carrito van a "Optional".</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[16rem]">Resumen del sitio (opcional) <input aria-label="Resumen del sitio" className={`${inputCls} w-full`} placeholder="Si lo dejas vacío se usa la meta description de la página principal" value={summary} onChange={e => setSummary(e.target.value)} maxLength={500} /></label>
                <label>Enlaces por sección <select aria-label="Enlaces por sección" className={inputCls} value={perSection} onChange={e => setPerSection(Number(e.target.value))}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                <Button onClick={generate} disabled={busy}>{busy ? 'Generando…' : 'Generar vista previa'}</Button>
              </div>
              {g && (
                <>
                  <p className="text-slate-500">{fmt(g.links)} enlaces en {fmt(g.sections)} secciones{g.skipped ? ` · ${fmt(g.skipped)} páginas no entraron por el límite` : ''}.</p>
                  <pre aria-label="Vista previa del llms.txt" className="font-mono text-[11px] whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900 p-2 rounded max-h-80 overflow-auto">{g.text}</pre>
                  <div className="flex flex-wrap items-end gap-3">
                    <Button onClick={publish} disabled={publishing || !can('wordpress:send')}><Send className="w-3.5 h-3.5" aria-hidden /> {publishing ? 'Publicando…' : 'Publicar en WordPress'}</Button>
                    <Button variant="secondary" onClick={() => dl('llms')}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar llms.txt</Button>
                    <label>Páginas en llms-full.txt <select aria-label="Páginas en llms-full.txt" className={inputCls} value={fullPages} onChange={e => setFullPages(Number(e.target.value))}>{[10, 30, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                    <Button variant="secondary" onClick={() => dl('full')}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar llms-full.txt</Button>
                  </div>
                  {published && <p role="status" className="text-emerald-700 dark:text-emerald-400">Publicado en <a className="underline" href={published} target="_blank" rel="noreferrer">{published}</a>. Vuelve a cargar esta sección para validarlo.</p>}
                  <p className="text-slate-500">Revisa el texto y pulsa "Publicar en WordPress" (necesita el plugin G.SEO – SEO), o descárgalo y súbelo a la raíz del sitio por FTP.</p>
                </>
              )}
            </>
          )}
        </section>
        <ErrorBox error={error} />
      </div>
    </Card>
  );
}
