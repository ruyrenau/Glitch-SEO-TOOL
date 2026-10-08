'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Bell, BookOpen, CheckCircle2, Circle, FileText, Gauge, Globe, Layers, Loader2, PencilLine, Play, ScanSearch, Search, Send, ShieldAlert, Sparkles
} from 'lucide-react';
import { apiGet, apiSend, fmt, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CrawlRun, JobRow, Site } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, inputCls } from './ui';

interface Summary {
  totals: { urls: number; html: number; images: number; resources?: number; external?: number };
  tabs: Array<{ id: string; label: string; filters: Array<{ id: string; label: string; count: number }> }>;
}

/** Findings worth showing first, in plain words, with where to look. */
const FINDINGS: Array<{ tab: string; filter: string; label: string; why: string; tone: 'bad' | 'warn' }> = [
  { tab: 'response', filter: '5xx', label: 'páginas con error del servidor (5xx)', why: 'Google no puede leerlas y, si siguen así, las saca del índice.', tone: 'bad' },
  { tab: 'response', filter: '4xx', label: 'páginas que no existen (4xx)', why: 'Enlaces rotos: el visitante y Google llegan a una página vacía.', tone: 'bad' },
  { tab: 'resources', filter: 'broken', label: 'archivos rotos (CSS, JS, imágenes, PDF)', why: 'Pueden romper el diseño o funciones de la página.', tone: 'bad' },
  { tab: 'external', filter: 'broken', label: 'enlaces externos rotos', why: 'Apuntan a páginas de otros sitios que ya no responden.', tone: 'warn' },
  { tab: 'titles', filter: 'missing', label: 'páginas sin título', why: 'El título es lo que Google muestra en azul en los resultados.', tone: 'bad' },
  { tab: 'titles', filter: 'duplicate', label: 'títulos duplicados', why: 'Varias páginas compiten entre sí por la misma búsqueda.', tone: 'warn' },
  { tab: 'titles', filter: 'over-60', label: 'títulos de más de 60 caracteres', why: 'Google los corta con "…" en los resultados.', tone: 'warn' },
  { tab: 'meta', filter: 'missing', label: 'páginas sin meta description', why: 'Google inventa el texto bajo el título; suele atraer menos clics.', tone: 'warn' },
  { tab: 'h1', filter: 'missing', label: 'páginas sin H1', why: 'El H1 le dice a Google y al lector de qué trata la página.', tone: 'warn' },
  { tab: 'images', filter: 'missing-alt', label: 'imágenes sin texto alternativo', why: 'Sin alt, Google Imágenes y los lectores de pantalla no saben qué muestran.', tone: 'warn' },
  { tab: 'internal', filter: 'non-indexable', label: 'páginas no indexables', why: 'No pueden aparecer en Google (noindex, canonical a otra URL, error o bloqueo). Revisa que sea a propósito.', tone: 'warn' }
];

const SECTIONS: Array<{ nav: string; icon: React.ComponentType<{ className?: string }>; title: string; what: string; when: string; needs?: string }> = [
  { nav: 'explorer', icon: ScanSearch, title: 'Explorador SEO', what: 'Todas las URLs del crawl en pestañas, como Screaming Frog: títulos, metas, H1, imágenes, canonicals, recursos, enlaces externos, estructura y búsqueda personalizada.', when: 'Para revisar página por página y exportar listas a CSV.' },
  { nav: 'issues', icon: AlertTriangle, title: 'Issues técnicos', what: 'Los problemas del crawl ordenados por gravedad, con las URLs afectadas y qué hacer para arreglarlos.', when: 'Para tener una lista de trabajo priorizada.' },
  { nav: 'seochanges', icon: PencilLine, title: 'Cambios SEO', what: 'Corrige títulos, meta descriptions, slugs y alt de imágenes directo en WordPress, con aprobación y opción de revertir.', when: 'Cuando el explorador encontró algo que quieres arreglar.', needs: 'Conectar WordPress' },
  { nav: 'gsc', icon: Search, title: 'Search Console', what: 'Clics, impresiones y posición de cada página y consulta en Google, cruzados con el crawl: oportunidades, CTR bajo, canibalización y páginas que Google muestra pero no deberían indexarse.', when: 'Para decidir qué arreglar primero según el tráfico real.', needs: 'Conectar tu cuenta de Google' },
  { nav: 'alerts', icon: Bell, title: 'Alertas', what: 'Compara cada crawl con el anterior y avisa si algo se rompió: noindex nuevo, páginas caídas, canonical cambiado.', when: 'Después de cada deploy o con un crawl programado.' },
  { nav: 'vitals', icon: Gauge, title: 'Core Web Vitals', what: 'Mide la velocidad de una página con Lighthouse (LCP, CLS, INP) y explica qué la hace lenta.', when: 'Para páginas importantes que tardan en cargar.' },
  { nav: 'logs', icon: FileText, title: 'Logs y sitemap', what: 'Sube los logs del servidor para ver qué páginas visita Googlebot y los bots de IA, y cuáles del sitemap nunca visita.', when: 'Para entender cómo te rastrea Google de verdad.', needs: 'Archivo de logs de Nginx o Apache' },
  { nav: 'wordpress', icon: Send, title: 'WordPress', what: 'Conecta el sitio con una contraseña de aplicación para enviar borradores y editar campos SEO.', when: 'Una sola vez por sitio.', needs: 'Usuario de WordPress con permiso de edición' },
  { nav: 'programmatic', icon: Layers, title: 'Contenido programático', what: 'Genera muchas páginas desde un CSV y una plantilla, con control de calidad y aprobación antes de enviarlas como borrador.', when: 'Para páginas por ciudad, producto o servicio.' },
  { nav: 'crawler', icon: ShieldAlert, title: 'Crawl y auditoría', what: 'Lanza crawls con más opciones (hasta 100,000 URLs, JavaScript, exclusiones) y prográmalos para que corran solos.', when: 'Para crawls grandes o periódicos.' },
  { nav: 'manual', icon: BookOpen, title: 'Manual de uso', what: 'Qué hace cada sección, cómo se usa y sus límites.', when: 'Cuando tengas dudas.' }
];

function Step({ n, title, state, children }: { n: number; title: string; state: 'done' | 'active' | 'todo'; children?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border p-5 ${state === 'active' ? 'border-indigo-500 bg-white dark:bg-[#151824] shadow-sm' : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-[#151824]/60'}`}>
      <h3 className="flex items-center gap-2 font-bold text-sm">
        {state === 'done' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden /> : <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${state === 'active' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>{n}</span>}
        <span>Paso {n}: {title}</span>
        {state === 'done' && <span className="sr-only">(completado)</span>}
      </h3>
      {children && <div className="mt-3 text-xs space-y-3">{children}</div>}
    </section>
  );
}

export function WizardView({ sites, siteId, select, reload, go }: { sites: Site[]; siteId: string; select: (id: string) => void; reload: () => Promise<void>; go: (nav: string) => void }) {
  const { can } = useAuth();
  const current = sites.find(s => s.id === siteId) ?? null;
  const [mode, setMode] = useState<'new' | 'existing'>(sites.length ? 'existing' : 'new');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [env, setEnv] = useState<Site['environment']>('production');
  const [size, setSize] = useState(500);
  const [renderJs, setRenderJs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [run, setRun] = useState<CrawlRun | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [siteReady, setSiteReady] = useState(!!current && sites.length > 0);

  // Latest finished crawl of the chosen site (to jump straight to step 3).
  useEffect(() => {
    setRun(null);
    setSummary(null);
    if (!current || !siteReady) return;
    apiGet<CrawlRun[]>(`/api/v1/sites/${current.id}/crawls`)
      .then(list => setRun(list.find(r => r.status === 'completed') ?? null))
      .catch(() => undefined);
  }, [current, siteReady]);
  useEffect(() => {
    if (!run) return;
    apiGet<Summary>(`/api/v1/crawls/${run.id}/explorer/summary`).then(setSummary).catch(setError);
  }, [run]);

  const normalized = (() => {
    const raw = url.trim();
    if (!raw) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return u.hostname.includes('.') || u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? u : null;
    } catch {
      return null;
    }
  })();

  const createSite = async () => {
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      const site = await apiSend<Site>('POST', '/api/v1/sites', { name: name.trim() || normalized.hostname, domain: normalized.hostname, canonicalUrl: normalized.origin + '/', environment: env });
      await reload();
      select(site.id);
      setSiteReady(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const startCrawl = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${current.id}/crawls`, { maxUrls: size, renderJs, rps: 2 });
      const done = await waitForJob<JobRow>(jobId, setJob, 1500);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? `El crawl terminó con estado ${done.status}.`);
      const id = (done.result as { crawlRunId?: string } | null)?.crawlRunId;
      const list = await apiGet<CrawlRun[]>(`/api/v1/sites/${current.id}/crawls`);
      setRun(list.find(r => r.id === id) ?? list.find(r => r.status === 'completed') ?? null);
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setJob(null);
    }
  };

  const count = (tab: string, filter: string) => summary?.tabs.find(t => t.id === tab)?.filters.find(f => f.id === filter)?.count ?? 0;
  const findings = summary ? FINDINGS.map(f => ({ ...f, n: count(f.tab, f.filter) })).filter(f => f.n > 0) : [];
  const step1: 'done' | 'active' = siteReady && current ? 'done' : 'active';
  const step2: 'done' | 'active' | 'todo' = step1 !== 'done' ? 'todo' : run ? 'done' : 'active';
  const step3: 'active' | 'todo' = run ? 'active' : 'todo';

  return (
    <div className="space-y-5 max-w-5xl">
      <Card>
        <div className="flex gap-4 items-start">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center"><Sparkles className="w-5 h-5" aria-hidden /></div>
          <div className="space-y-1.5 text-sm">
            <p className="font-bold text-base">Bienvenido. En tres pasos tendrás tu primera auditoría SEO.</p>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              1) Le dices a la herramienta qué sitio revisar. 2) La herramienta lo recorre como lo haría Google, página por página. 3) Te muestra qué encontró y a qué sección ir para cada cosa.
              No se modifica nada en tu sitio: solo se lee, como un visitante.
            </p>
          </div>
        </div>
      </Card>

      <ErrorBox error={error} />

      <Step n={1} title="¿Qué sitio quieres analizar?" state={step1}>
        {step1 === 'done' && current ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>Sitio elegido: <strong>{current.name}</strong> <span className="font-mono text-slate-500">{current.canonicalUrl}</span></span>
            <Button variant="secondary" onClick={() => { setSiteReady(false); setRun(null); }}>Cambiar de sitio</Button>
          </div>
        ) : (
          <>
            {sites.length > 0 && (
              <div role="radiogroup" aria-label="Sitio nuevo o existente" className="flex gap-4">
                <label className="flex items-center gap-2"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Un sitio nuevo</label>
                <label className="flex items-center gap-2"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Uno que ya agregué</label>
              </div>
            )}
            {mode === 'existing' && sites.length > 0 ? (
              <div className="flex flex-wrap gap-2 items-end">
                <label className="space-y-1">
                  <span className="block font-semibold">Sitio</span>
                  <select aria-label="Sitio existente" className={inputCls} value={siteId} onChange={e => select(e.target.value)}>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name} · {s.canonicalUrl}</option>)}
                  </select>
                </label>
                <Button disabled={!siteId} onClick={() => setSiteReady(true)}>Usar este sitio <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
              </div>
            ) : (
              <>
                <p className="text-slate-600 dark:text-slate-400">Escribe la dirección de la página principal, por ejemplo <span className="font-mono">https://www.misitio.com</span>. La herramienta empezará ahí y seguirá los enlaces.</p>
                <div className="grid md:grid-cols-[2fr_1fr_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="block font-semibold">URL a analizar</span>
                    <input aria-label="URL a analizar" className={`${inputCls} w-full`} placeholder="https://www.misitio.com" value={url} onChange={e => setUrl(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold">Nombre (opcional)</span>
                    <input aria-label="Nombre del sitio" className={`${inputCls} w-full`} placeholder={normalized?.hostname ?? 'Mi sitio'} value={name} onChange={e => setName(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold">Tipo</span>
                    <select aria-label="Tipo de sitio" className={`${inputCls} w-full`} value={env} onChange={e => setEnv(e.target.value as Site['environment'])}>
                      <option value="production">Sitio publicado</option>
                      <option value="staging">Pruebas (staging)</option>
                      <option value="development">Desarrollo</option>
                    </select>
                  </label>
                </div>
                {url && !normalized && <p className="text-rose-600">Esa dirección no parece válida. Revisa que tenga un dominio, como misitio.com.</p>}
                {normalized && <p className="text-slate-500">Se analizará <span className="font-mono">{normalized.origin}/</span>. Solo se recorren páginas de ese mismo dominio.</p>}
                {!can('site:manage') && <p className="text-amber-600">Tu rol no puede agregar sitios. Pide a un administrador que lo agregue, o elige uno existente.</p>}
                <Button disabled={!normalized || busy || !can('site:manage')} onClick={createSite}>{busy ? 'Guardando…' : 'Guardar y continuar'} <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
              </>
            )}
          </>
        )}
      </Step>

      <Step n={2} title="Recorrer el sitio (crawl)" state={step2}>
        {step2 === 'todo' ? null : (
          <>
            <p className="text-slate-600 dark:text-slate-400">
              La herramienta visita la página principal, sigue cada enlace y guarda de cada página su título, descripción, encabezados, imágenes, enlaces y errores. También revisa sus archivos (CSS, JavaScript, imágenes, PDF) y los enlaces a otros sitios.
              Va despacio para no cargar el servidor: unas 2 páginas por segundo.
            </p>
            {run && (
              <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden /> Ya hay un crawl terminado de este sitio con {fmt(run.urlsCrawled)} URLs. Puedes ver los resultados abajo o hacer uno nuevo.</p>
            )}
            <div className="flex flex-wrap gap-4 items-end">
              <label className="space-y-1">
                <span className="block font-semibold">¿Cuántas páginas como máximo?</span>
                <select aria-label="Cuántas páginas" className={inputCls} value={size} onChange={e => setSize(Number(e.target.value))}>
                  <option value={500}>500 (recomendado para empezar, ~5 min)</option>
                  <option value={1000}>1,000 (~10 min)</option>
                  <option value={2500}>2,500 (~25 min)</option>
                  <option value={5000}>5,000 (~45 min)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2" title="Úsalo si el sitio está hecho con React, Vue, Angular o similar y la página aparece vacía sin JavaScript.">
                <input type="checkbox" checked={renderJs} onChange={e => setRenderJs(e.target.checked)} /> Ejecutar JavaScript (solo si el sitio lo necesita; es más lento)
              </label>
            </div>
            <p className="text-slate-500">Para crawls más grandes, exclusiones o crawls programados, usa la sección <button className="underline text-indigo-600 dark:text-indigo-400" onClick={() => go('crawler')}>Crawl y auditoría</button>.</p>
            {job ? (
              <div className="space-y-1.5" role="status">
                <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {job.status === 'QUEUED' ? 'En cola…' : `Recorriendo: ${fmt(job.progressDetail?.crawled ?? 0)} páginas, ${fmt(job.progressDetail?.queued ?? 0)} por visitar`}</div>
                <div className="h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-indigo-500 transition-all" style={{ width: `${Math.max(3, job.progress)}%` }} /></div>
                {job.progressDetail?.current && <div className="font-mono text-[11px] text-slate-500 truncate">{job.progressDetail.current}</div>}
                <p className="text-slate-500">Puedes ir a otra sección; el crawl sigue en segundo plano.</p>
              </div>
            ) : (
              <Button disabled={busy || !can('seo:operate')} onClick={startCrawl}><Play className="w-3.5 h-3.5" aria-hidden /> {run ? 'Hacer un crawl nuevo' : 'Empezar el crawl'}</Button>
            )}
            {!can('seo:operate') && <p className="text-amber-600">Tu rol no puede lanzar crawls. Pide a un SEO Manager o administrador que lo haga.</p>}
          </>
        )}
      </Step>

      <Step n={3} title="Qué encontró y a dónde ir" state={step3}>
        {step3 === 'todo' ? null : !summary ? (
          <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Cargando resultados…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                ['URLs revisadas', summary.totals.urls],
                ['Páginas que cargan bien', summary.totals.html],
                ['Imágenes', summary.totals.images],
                ['Archivos y enlaces externos', (summary.totals.resources ?? 0) + (summary.totals.external ?? 0)]
              ].map(([l, v]) => (
                <div key={l as string} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500">{l}</div>
                  <div className="text-lg font-bold tabular-nums">{fmt(v as number)}</div>
                </div>
              ))}
            </div>
            <h4 className="font-semibold text-sm pt-2">Lo primero que revisaría</h4>
            {!findings.length ? (
              <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden /> No se encontraron problemas comunes. Revisa igual el Explorador y los Issues para el detalle.</p>
            ) : (
              <ul className="space-y-2">
                {findings.map(f => (
                  <li key={`${f.tab}-${f.filter}`} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <Badge tone={f.tone}>{fmt(f.n)}</Badge>
                    <div className="flex-1 min-w-[14rem]">
                      <div className="font-semibold">{f.label}</div>
                      <div className="text-slate-500">{f.why}</div>
                    </div>
                    <Button variant="secondary" onClick={() => go('explorer')}>Ver en el Explorador <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-slate-500">En el Explorador, elige la pestaña y el filtro del mismo nombre (por ejemplo Títulos → Duplicado) para ver las URLs.</p>
          </>
        )}
      </Step>

      <Card title="Todo lo que puedes hacer">
        <p className="text-xs text-slate-500 mb-3">Cada tarjeta explica para qué sirve la sección y cuándo usarla. El botón te lleva directo.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            return (
              <div key={s.nav} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-sm"><Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" aria-hidden /> {s.title}</div>
                <p className="text-slate-600 dark:text-slate-300">{s.what}</p>
                <p className="text-slate-500"><strong>Cuándo:</strong> {s.when}</p>
                {s.needs && <p className="text-slate-500 flex items-center gap-1"><Circle className="w-2.5 h-2.5" aria-hidden /> Necesitas: {s.needs}</p>}
                <div className="mt-auto pt-1"><Button variant="secondary" onClick={() => go(s.nav)}>Ir a {s.title} <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button></div>
              </div>
            );
          })}
        </div>
      </Card>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" aria-hidden /> Puedes volver a este inicio guiado cuando quieras desde el menú.</p>
    </div>
  );
}
