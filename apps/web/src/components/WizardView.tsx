'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Bell, BookOpen, Bot, CheckCircle2, Circle, Code2, FileBarChart, FileSearch, FileText, Gauge, Globe, Layers, Loader2, PencilLine, Play, ScanSearch, Search, Send, Settings, ShieldAlert, Sparkles
} from 'lucide-react';
import { apiGet, apiSend, fmt, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CrawlRun, JobRow, Site, GoFn } from '@/lib/types';
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

type SectionCard = { nav: string; icon: React.ComponentType<{ className?: string }>; title: string; what: string; when: string; needs?: string };
const GROUPS: Array<{ title: string; cards: SectionCard[] }> = [
  {
    title: 'SEO técnico',
    cards: [
      { nav: 'explorer', icon: ScanSearch, title: 'Explorador SEO', what: 'Todas las URLs del crawl en pestañas, como Screaming Frog: títulos, metas, H1, imágenes, canonicals, recursos, enlaces externos, estructura y búsqueda personalizada.', when: 'Para revisar página por página y exportar listas a CSV.' },
      { nav: 'issues', icon: AlertTriangle, title: 'Issues técnicos', what: 'Los problemas del crawl ordenados por gravedad, con las URLs afectadas y qué hacer para arreglarlos.', when: 'Para tener una lista de trabajo priorizada.' },
      { nav: 'crawler', icon: ShieldAlert, title: 'Crawl y auditoría', what: 'Crawls con más opciones (hasta 100,000 URLs, JavaScript, exclusiones, modo lista) y programados para que corran solos.', when: 'Para crawls grandes o periódicos.' },
      { nav: 'alerts', icon: Bell, title: 'Alertas', what: 'Compara cada crawl con el anterior y avisa si algo se rompió: noindex nuevo, páginas caídas, canonical cambiado.', when: 'Después de cada deploy o con un crawl programado.' },
      { nav: 'vitals', icon: Gauge, title: 'Core Web Vitals', what: 'Reporte de velocidad tipo GTmetrix: nota, captura, LCP, CLS e INP, problemas principales, peso por tipo de archivo y cascada.', when: 'Para páginas importantes que tardan en cargar.' },
      { nav: 'logs', icon: FileText, title: 'Logs y sitemap', what: 'Sube los logs del servidor para ver qué páginas visita Googlebot y los bots de IA, y cuáles del sitemap nunca visita.', when: 'Para entender cómo te rastrea Google de verdad.', needs: 'Archivo de logs de Nginx o Apache' },
      { nav: 'schema', icon: Code2, title: 'Schema.org', what: 'Genera datos estructurados para cualquier tipo de negocio o página, los rellena desde una URL, los valida y los crea en masa desde un CSV.', when: 'Para que Google y las IAs entiendan qué es cada página.' }
    ]
  },
  {
    title: 'Contenido',
    cards: [
      { nav: 'contentaudit', icon: FileSearch, title: 'Análisis de contenido', what: 'Páginas duplicadas, casi duplicadas o con poco texto; páginas que pierden clics mes a mes; y tus búsquedas agrupadas por tema con la página que debe posicionar cada una.', when: 'Para decidir qué fusionar, qué refrescar y qué página crear.', needs: 'Un crawl y, para declive y temas, Search Console' },
      { nav: 'seochanges', icon: PencilLine, title: 'Cambios SEO', what: 'Corrige títulos, meta descriptions, slugs y alt de imágenes directo en WordPress, con aprobación y opción de revertir.', when: 'Cuando el explorador encontró algo que quieres arreglar.', needs: 'Conectar WordPress' },
      { nav: 'programmatic', icon: Layers, title: 'Contenido programático', what: 'Genera muchas páginas desde un CSV y una plantilla, con control de calidad y aprobación antes de enviarlas como borrador.', when: 'Para páginas por ciudad, producto o servicio.' },
      { nav: 'wordpress', icon: Send, title: 'WordPress', what: 'Conecta el sitio con una contraseña de aplicación para enviar borradores y editar campos SEO.', when: 'Una sola vez por sitio.', needs: 'Usuario de WordPress con permiso de edición' }
    ]
  },
  {
    title: 'Google',
    cards: [
      { nav: 'gsc', icon: Search, title: 'Search Console', what: 'Clics, impresiones y posición de cada página y consulta, cruzados con el crawl: oportunidades, CTR bajo, canibalización con recomendaciones y páginas que Google muestra pero no deberían indexarse.', when: 'Para decidir qué arreglar primero según el tráfico real.', needs: 'Conectar tu cuenta de Google' }
    ]
  },
  {
    title: 'IA (AEO y GEO)',
    cards: [
      { nav: 'aiready', icon: Bot, title: 'Listo para IA', what: 'Califica de 0 a 100 qué tan fácil es para ChatGPT, Gemini, Perplexity y AI Overviews citar cada página, y revisa qué bots de IA deja entrar tu robots.txt.', when: 'Para preparar tus páginas para las respuestas de IA.', needs: 'Un crawl' },
      { nav: 'geo', icon: Sparkles, title: 'Visibilidad en IA', what: 'Registra semana a semana si las IAs mencionan tu marca (Directo) o citan tu sitio (Citación) en tus preguntas clave, con puntos, tendencia y un análisis de Claude.', when: 'Para medir si te recomiendan y si vas subiendo.' }
    ]
  },
  {
    title: 'Seguimiento y clientes',
    cards: [
      { nav: 'monitor', icon: Activity, title: 'Monitoreo', what: 'Crawl, Search Console y Core Web Vitals automáticos, cómo evoluciona el sitio y qué cambió. Puede avisarte de lo importante por Slack, Teams, Discord o webhook.', when: 'Para no revisar todo a mano cada semana.' },
      { nav: 'reports', icon: FileBarChart, title: 'Reportes', what: 'Un reporte para el cliente con Search Console, salud técnica, velocidad, evolución y visibilidad en IA, por enlace sin login o en PDF.', when: 'Para mostrar el avance al cliente.' },
      { nav: 'settings', icon: Settings, title: 'Configuración', what: 'Claves de API (Anthropic, OpenAI, Google, SerpAPI) que usan las funciones de IA. Solo para administradores.', when: 'Una sola vez.' },
      { nav: 'manual', icon: BookOpen, title: 'Manual de uso', what: 'Qué hace cada sección, cómo se usa y sus límites.', when: 'Cuando tengas dudas.' }
    ]
  }
];

interface Extra { ai: { average: number; pages: number; blocked: string[] } | null; dup: { exact: number; near: number; thin: number } | null }
interface Setup { gsc: boolean | null; monitor: boolean | null; wordpress: boolean | null; ai: boolean | null; reports: boolean | null }

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

export function WizardView({ sites, siteId, select, reload, go }: { sites: Site[]; siteId: string; select: (id: string) => void; reload: () => Promise<void>; go: GoFn }) {
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
  const [extra, setExtra] = useState<Extra>({ ai: null, dup: null });
  const [setup, setSetup] = useState<Setup | null>(null);

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
  // Beyond the explorer: AI readiness and duplicate content of the same crawl (best effort).
  useEffect(() => {
    setExtra({ ai: null, dup: null });
    if (!run || !current) return;
    apiGet<{ summary: { average: number; pages: number; blockedSearch: string[] } | null }>(`/api/v1/sites/${current.id}/ai-readiness?crawlRunId=${run.id}`)
      .then(r => r.summary && setExtra(e => ({ ...e, ai: { average: r.summary!.average, pages: r.summary!.pages, blocked: r.summary!.blockedSearch } })))
      .catch(() => undefined);
    apiGet<{ totals: { exactGroups: number; nearGroups: number; thin: number } | null }>(`/api/v1/sites/${current.id}/content/duplicates?crawlRunId=${run.id}`)
      .then(r => r.totals && setExtra(e => ({ ...e, dup: { exact: r.totals!.exactGroups, near: r.totals!.nearGroups, thin: r.totals!.thin } })))
      .catch(() => undefined);
  }, [run, current]);
  // What is already set up for this site (for "Siguientes pasos").
  useEffect(() => {
    setSetup(null);
    if (!current || !siteReady) return;
    const id = current.id;
    type Mon = { gsc: { enabled: boolean; connected: boolean; property: string | null }; crawl: { enabled: boolean }; vitals: { enabled: boolean } };
    const ok = <T,>(p: Promise<T>, f: (v: T) => boolean) => p.then(f, () => null);
    const mon = apiGet<Mon>(`/api/v1/sites/${id}/monitor`);
    Promise.all([
      ok(mon, m => m.gsc.connected && !!m.gsc.property),
      ok(mon, m => m.crawl.enabled || m.gsc.enabled || m.vitals.enabled),
      ok(apiGet<{ connection: unknown }>(`/api/v1/sites/${id}/wordpress`), w => !!w.connection),
      ok(apiGet<unknown[]>(`/api/v1/sites/${id}/ai-visibility/prompts`), l => l.length > 0),
      ok(apiGet<unknown[]>(`/api/v1/sites/${id}/reports`), l => l.length > 0)
    ]).then(([gsc, monitor, wordpress, ai, reports]) => setSetup({ gsc, monitor, wordpress, ai, reports }));
  }, [current, siteReady]);

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
  const NEXT: Array<{ key: keyof Setup; nav: string; title: string; why: string; done: string }> = [
    { key: 'gsc', nav: 'gsc', title: 'Conecta Search Console', why: 'Con clics e impresiones reales se ordena todo por tráfico, se detecta canibalización y contenido en declive, y se agrupan tus búsquedas por tema.', done: 'Search Console conectado.' },
    { key: 'monitor', nav: 'monitor', title: 'Activa el Monitoreo y los avisos', why: 'Crawl, Search Console y velocidad automáticos, con un mensaje a Slack, Teams o Discord cuando algo cae.', done: 'Monitoreo activo.' },
    { key: 'wordpress', nav: 'wordpress', title: 'Conecta WordPress', why: 'Para corregir títulos, descripciones y alt desde la herramienta, con aprobación y opción de revertir.', done: 'WordPress conectado.' },
    { key: 'ai', nav: 'geo', title: 'Empieza a medir tu visibilidad en IA', why: 'Agrega tus preguntas clave y registra cada semana si ChatGPT, Gemini o Claude te mencionan o citan.', done: 'Ya mides tu visibilidad en IA.' },
    { key: 'reports', nav: 'reports', title: 'Crea tu primer reporte para el cliente', why: 'Un enlace sin login o un PDF con lo más importante.', done: 'Ya creaste un reporte.' }
  ];

  return (
    <div className="space-y-5 max-w-5xl">
      <Card>
        <div className="flex gap-4 items-start">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center"><Sparkles className="w-5 h-5" aria-hidden /></div>
          <div className="space-y-1.5 text-sm">
            <p className="font-bold text-base">Bienvenido. En tres pasos tendrás tu primera auditoría SEO y de IA.</p>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              1) Le dices a la herramienta qué sitio revisar. 2) La herramienta lo recorre como lo haría Google, página por página. 3) Te muestra qué encontró (SEO técnico, contenido y preparación para IA) y a qué sección ir. 4) Te sugiere qué conectar después.
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
                    <Button variant="secondary" onClick={() => go('explorer', { tab: f.tab, filter: f.filter })}>Ver estas URLs <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
                  </li>
                ))}
              </ul>
            )}
            {(extra.ai || extra.dup) && (
              <>
                <h4 className="font-semibold text-sm pt-2">Contenido e IA</h4>
                <ul className="space-y-2">
                  {extra.ai && (
                    <li className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                      <Badge tone={extra.ai.average >= 60 ? 'good' : extra.ai.average >= 40 ? 'warn' : 'bad'}>{extra.ai.average}/100</Badge>
                      <div className="flex-1 min-w-[14rem]">
                        <div className="font-semibold">Puntaje medio "Listo para IA" de {fmt(extra.ai.pages)} páginas</div>
                        <div className="text-slate-500">{extra.ai.blocked.length ? `Tu robots.txt bloquea a ${extra.ai.blocked.join(', ')}: esos buscadores con IA no pueden citarte.` : 'Qué tan fácil es para ChatGPT, Gemini y AI Overviews sacar una respuesta de tus páginas y citarlas.'}</div>
                      </div>
                      <Button variant="secondary" onClick={() => go('aiready')}>Ver qué falta <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
                    </li>
                  )}
                  {extra.dup && extra.dup.exact + extra.dup.near + extra.dup.thin > 0 && (
                    <li className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                      <Badge tone="warn">{fmt(extra.dup.exact + extra.dup.near + extra.dup.thin)}</Badge>
                      <div className="flex-1 min-w-[14rem]">
                        <div className="font-semibold">{fmt(extra.dup.exact)} grupos duplicados, {fmt(extra.dup.near)} casi duplicados y {fmt(extra.dup.thin)} páginas con poco texto</div>
                        <div className="text-slate-500">El contenido repetido o pobre compite consigo mismo y se cita menos.</div>
                      </div>
                      <Button variant="secondary" onClick={() => go('contentaudit')}>Ver páginas <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
                    </li>
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="Siguientes pasos" state={step3 === 'active' ? 'active' : 'todo'}>
        {step3 === 'todo' ? null : (
          <ul className="space-y-2" aria-label="Siguientes pasos">
            {NEXT.map(n => {
              const done = setup?.[n.key] === true;
              return (
                <li key={n.key} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  {done ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-label="Hecho" /> : <Circle className="w-5 h-5 text-slate-300 shrink-0" aria-label="Pendiente" />}
                  <div className="flex-1 min-w-[14rem]">
                    <div className="font-semibold">{n.title}</div>
                    <div className="text-slate-500">{done ? n.done : n.why}</div>
                  </div>
                  <Button variant="secondary" onClick={() => go(n.nav)}>{done ? 'Abrir' : 'Ir'} <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>
                </li>
              );
            })}
          </ul>
        )}
      </Step>

      <Card title="Todo lo que puedes hacer">
        <p className="text-xs text-slate-500 mb-3">Cada tarjeta explica para qué sirve la sección y cuándo usarla. El botón te lleva directo.</p>
        <div className="space-y-5">
          {GROUPS.map(g => (
            <section key={g.title} aria-label={g.title}>
              <h4 className="font-semibold text-xs uppercase tracking-wide text-slate-500 mb-2">{g.title}</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                {g.cards.map(s => {
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
            </section>
          ))}
        </div>
      </Card>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" aria-hidden /> Puedes volver a este inicio guiado cuando quieras desde el menú.</p>
    </div>
  );
}
