'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, Link2, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmt, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

interface Status { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null }
interface Property { siteUrl: string; permissionLevel: string }
type PageRow = { page: string; clicks: number; impressions: number; ctr: number; position: number; statusCode?: number; reason?: string | null };
type QueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number; pages: number; topPage: string };
interface Report {
  property: string | null;
  import: { id: string; startDate: string; endDate: string; completedAt: string; pageRows: number; queryRows: number; truncated: boolean } | null;
  lastImport: { status: string; error: string | null; createdAt: string } | null;
  totals?: { clicks: number; impressions: number; ctr: number; position: number; pages: number; queries: number };
  daily?: Array<{ date: string; clicks: number; impressions: number }>;
  topPages?: PageRow[];
  topQueries?: QueryRow[];
  opportunities?: QueryRow[];
  lowCtr?: PageRow[];
  cannibalization?: QueryRow[];
  crawl?: {
    crawledAt: string;
    nonIndexableWithImpressions: PageRow[];
    nonIndexableWithImpressionsCount: number;
    indexableWithoutImpressions: string[];
    indexableWithoutImpressionsCount: number;
    notInCrawl: PageRow[];
    notInCrawlCount: number;
    shownButNotInLogs: PageRow[];
    shownButNotInLogsCount: number | null;
  } | null;
  sitemap?: { urls: number; withoutImpressionsCount: number; withoutImpressions: string[] } | null;
}

const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

function DailyChart({ days }: { days: Array<{ date: string; clicks: number; impressions: number }> }) {
  if (!days.length) return null;
  const maxI = Math.max(...days.map(d => d.impressions), 1);
  const maxC = Math.max(...days.map(d => d.clicks), 1);
  const w = 100 / days.length;
  return (
    <figure className="space-y-1">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-32" role="img" aria-label="Clics e impresiones por día">
        {days.map((d, i) => (
          <rect key={d.date} x={i * w + w * 0.1} width={w * 0.8} y={40 - (d.impressions / maxI) * 38} height={(d.impressions / maxI) * 38} className="fill-indigo-200 dark:fill-indigo-900">
            <title>{`${d.date}: ${d.impressions} impresiones, ${d.clicks} clics`}</title>
          </rect>
        ))}
        <polyline fill="none" strokeWidth="0.6" className="stroke-indigo-600 dark:stroke-indigo-400" points={days.map((d, i) => `${i * w + w / 2},${40 - (d.clicks / maxC) * 38}`).join(' ')} />
      </svg>
      <figcaption className="flex justify-between text-[11px] text-slate-500">
        <span>{days[0].date}</span>
        <span><span className="inline-block w-2 h-2 bg-indigo-200 dark:bg-indigo-900 rounded-sm" /> impresiones · <span className="inline-block w-3 h-0.5 bg-indigo-600 align-middle" /> clics (escalas distintas)</span>
        <span>{days[days.length - 1].date}</span>
      </figcaption>
    </figure>
  );
}

function PageTable({ rows, extra }: { rows: PageRow[]; extra?: (r: PageRow) => React.ReactNode }) {
  if (!rows.length) return <Empty>Nada en esta lista.</Empty>;
  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800"><th className="py-2">Página</th><th className="text-right">Clics</th><th className="text-right">Impresiones</th><th className="text-right">CTR</th><th className="text-right">Posición</th>{extra && <th className="pl-3">Detalle</th>}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={r.page}>
              <td className="py-1.5 font-mono text-[11px] break-all"><a href={r.page} target="_blank" rel="noreferrer" className="hover:underline">{path(r.page)}</a></td>
              <td className="text-right tabular-nums">{fmt(r.clicks)}</td>
              <td className="text-right tabular-nums">{fmt(r.impressions)}</td>
              <td className="text-right tabular-nums">{r.ctr}%</td>
              <td className="text-right tabular-nums">{r.position}</td>
              {extra && <td className="pl-3">{extra(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryTable({ rows, showPages }: { rows: QueryRow[]; showPages?: boolean }) {
  if (!rows.length) return <Empty>Nada en esta lista.</Empty>;
  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800"><th className="py-2">Consulta</th><th className="text-right">Clics</th><th className="text-right">Impresiones</th><th className="text-right">CTR</th><th className="text-right">Posición</th><th className="pl-3">{showPages ? 'Páginas' : 'Página principal'}</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={r.query}>
              <td className="py-1.5">{r.query}</td>
              <td className="text-right tabular-nums">{fmt(r.clicks)}</td>
              <td className="text-right tabular-nums">{fmt(r.impressions)}</td>
              <td className="text-right tabular-nums">{r.ctr}%</td>
              <td className="text-right tabular-nums">{r.position}</td>
              <td className="pl-3 font-mono text-[11px] break-all">{showPages ? `${r.pages} páginas (la que más aparece: ${path(r.topPage)})` : path(r.topPage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  ['pages', 'Páginas'],
  ['queries', 'Consultas'],
  ['opportunities', 'Oportunidades'],
  ['lowctr', 'CTR bajo'],
  ['cannibal', 'Canibalización'],
  ['cross', 'Cruce con crawl, logs y sitemap']
] as const;

export function GscView({ siteId, go, notice }: { siteId: string; go: (nav: string) => void; notice?: { kind: 'connected' | 'error'; message?: string } | null }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [props, setProps] = useState<Property[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [property, setProperty] = useState('');
  const [days, setDays] = useState(90);
  const [job, setJob] = useState<JobRow | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('pages');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await apiGet<Status>('/api/v1/gsc/status');
      setStatus(s);
      const r = await apiGet<Report>(`/api/v1/sites/${siteId}/gsc/report`);
      setReport(r);
      setProperty(r.property ?? '');
      if (s.connected) setProps(await apiGet<Property[]>('/api/v1/gsc/properties'));
    } catch (e) {
      setError(e);
    }
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load]);

  const saveProperty = async () => {
    setError(null);
    setSaved(null);
    try {
      const r = await apiSend<{ gscProperty: string | null; matchesSite: boolean | null }>('PUT', `/api/v1/sites/${siteId}/gsc`, { property: property || null });
      setSaved(r.matchesSite === false ? 'Guardado. Ojo: esa propiedad no parece corresponder al dominio de este sitio.' : 'Propiedad guardada.');
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const runImport = async () => {
    setError(null);
    try {
      const { jobId } = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/gsc/import`, { days });
      const done = await waitForJob<JobRow>(jobId, setJob, 1500);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? `La importación terminó con estado ${done.status}.`);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setJob(null);
    }
  };

  const disconnect = async () => {
    if (!confirm('¿Desconectar la cuenta de Google? Se revoca el permiso. Los datos ya importados se conservan.')) return;
    try {
      await apiSend('DELETE', '/api/v1/gsc/connection');
      setProps(null);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  if (!status) return error ? <ErrorBox error={error} /> : <Skeleton rows={5} />;
  const r = report;

  return (
    <div className="space-y-5">
      {notice?.kind === 'connected' && <div role="status" className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs"><CheckCircle2 className="w-4 h-4" aria-hidden /> Cuenta de Google conectada. Ahora elige la propiedad de este sitio.</div>}
      {notice?.kind === 'error' && <ErrorBox error={new Error(notice.message ?? 'No se pudo conectar con Google.')} />}
      <ErrorBox error={error} />

      <Card title="1. Cuenta de Google">
        <div className="text-xs space-y-3">
          <p className="text-slate-600 dark:text-slate-400">Search Console es la herramienta de Google que dice cuántas veces apareció tu sitio en los resultados (impresiones), cuántas veces hicieron clic y en qué posición. Esta conexión solo lee datos; no cambia nada en tu cuenta.</p>
          {!status.configured ? (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
              Falta configurar el servidor: agrega <code>GSC_CLIENT_ID</code> y <code>GSC_CLIENT_SECRET</code> al archivo <code>.env</code> y reinicia la app. El manual explica cómo crearlos en Google Cloud.
            </div>
          ) : status.connected ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="good">Conectada</Badge>
              <span>{status.email ?? 'Cuenta de Google'} · desde {fmtDate(status.connectedAt)}</span>
              {can('site:manage') && <Button variant="secondary" onClick={disconnect}><LogOut className="w-3.5 h-3.5" aria-hidden /> Desconectar</Button>}
              {can('site:manage') && <a className="text-indigo-600 dark:text-indigo-400 underline" href={`${API_URL}/api/v1/gsc/oauth/start`}>Reconectar</a>}
            </div>
          ) : can('site:manage') ? (
            <div className="space-y-2">
              <a href={`${API_URL}/api/v1/gsc/oauth/start`} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"><Link2 className="w-4 h-4" aria-hidden /> Conectar con Google</a>
              <p className="text-slate-500">Te llevará a Google. Elige la cuenta que tiene acceso a Search Console y acepta el permiso de lectura. Si Google dice que la app no está verificada, pulsa "Continuar": es tu propia app en modo de prueba.</p>
            </div>
          ) : (
            <p className="text-amber-600">Pide a un administrador que conecte la cuenta de Google.</p>
          )}
        </div>
      </Card>

      {status.connected && (
        <Card title="2. Propiedad de este sitio">
          <div className="text-xs space-y-2">
            <p className="text-slate-600 dark:text-slate-400">Una propiedad es el sitio tal como está registrado en Search Console: puede ser un prefijo de URL (<span className="font-mono">https://www.misitio.com/</span>) o un dominio completo (<span className="font-mono">sc-domain:misitio.com</span>). Si tienes ambas, el dominio completo incluye todo.</p>
            {!props ? <Skeleton rows={1} /> : !props.length ? (
              <p className="text-amber-600">Esta cuenta no tiene propiedades verificadas en Search Console. Revisa que conectaste la cuenta correcta.</p>
            ) : (
              <div className="flex flex-wrap gap-2 items-center">
                <select aria-label="Propiedad de Search Console" className={inputCls} value={property} onChange={e => setProperty(e.target.value)}>
                  <option value="">Elige una propiedad…</option>
                  {props.map(p => <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl}</option>)}
                </select>
                <Button disabled={!property || property === r?.property || !can('site:manage')} onClick={saveProperty}>Guardar</Button>
                {saved && <span className="text-emerald-600">{saved}</span>}
              </div>
            )}
          </div>
        </Card>
      )}

      {status.connected && r?.property && (
        <Card title="3. Importar datos">
          <div className="text-xs space-y-2">
            <p className="text-slate-600 dark:text-slate-400">Trae clics, impresiones, CTR y posición por página y por consulta. Google publica los datos con unos 2 días de retraso. Los datos se actualizan solos cada mañana; también puedes importar ahora.</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select aria-label="Periodo" className={inputCls} value={days} onChange={e => setDays(Number(e.target.value))}>
                <option value={28}>Últimos 28 días</option>
                <option value={90}>Últimos 3 meses</option>
                <option value={180}>Últimos 6 meses</option>
                <option value={480}>Últimos 16 meses (máximo de Google)</option>
              </select>
              {job ? (
                <span className="flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {job.status === 'QUEUED' ? 'En cola…' : 'Importando…'} {job.logs?.slice(-1)[0]?.msg ?? ''}</span>
              ) : (
                <Button disabled={!can('seo:operate')} onClick={runImport}><RefreshCw className="w-3.5 h-3.5" aria-hidden /> Importar ahora</Button>
              )}
            </div>
            {r.import && <p className="text-slate-500">Datos del {r.import.startDate} al {r.import.endDate} · importados {fmtDate(r.import.completedAt)} · {fmt(r.import.pageRows)} páginas, {fmt(r.import.queryRows)} combinaciones de consulta y página.{r.import.truncated && ' Se alcanzó el límite de 100,000 filas: las consultas con menos impresiones no se incluyeron.'}</p>}
            {r.lastImport?.status === 'failed' && <p className="text-rose-600">La última importación falló: {r.lastImport.error}</p>}
          </div>
        </Card>
      )}

      {r?.import && r.totals && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Clics" value={fmt(r.totals.clicks)} hint={`${r.import.startDate} → ${r.import.endDate}`} tone="brand" />
            <Kpi label="Impresiones" value={fmt(r.totals.impressions)} hint="Veces que el sitio apareció en Google" />
            <Kpi label="CTR medio" value={`${r.totals.ctr}%`} hint="Clics ÷ impresiones" />
            <Kpi label="Posición media" value={r.totals.position} hint="Ponderada por impresiones" />
          </div>
          <Card title="Evolución diaria"><DailyChart days={r.daily ?? []} /></Card>

          <Card
            title="Análisis"
            actions={<Button variant="secondary" onClick={() => go('explorer')}>Ver por URL en el Explorador <ArrowRight className="w-3.5 h-3.5" aria-hidden /></Button>}
          >
            <div role="tablist" aria-label="Análisis de Search Console" className="flex flex-wrap gap-1 mb-3">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{label}</button>
              ))}
            </div>
            <div className="text-xs space-y-3">
              {tab === 'pages' && (<><p className="text-slate-500">Las páginas que más clics reciben.</p><PageTable rows={r.topPages ?? []} /></>)}
              {tab === 'queries' && (<><p className="text-slate-500">Lo que la gente busca en Google cuando aparece tu sitio.</p><QueryTable rows={r.topQueries ?? []} /></>)}
              {tab === 'opportunities' && (<><p className="text-slate-500"><strong>Las mejoras más baratas:</strong> consultas en posición 4 a 15 con demanda real. Subir unas posiciones, a la primera página o al top 3, suele multiplicar los clics. Mejora el contenido de la página principal de cada consulta y enlázala desde otras páginas.</p><QueryTable rows={r.opportunities ?? []} /></>)}
              {tab === 'lowctr' && (<><p className="text-slate-500"><strong>Buena posición, pocos clics:</strong> la gente ve la página pero no la elige. Casi siempre se arregla con un título y una meta description más atractivos; puedes cambiarlos desde el Explorador → Editar en WordPress.</p><PageTable rows={r.lowCtr ?? []} /></>)}
              {tab === 'cannibal' && (<><p className="text-slate-500"><strong>Varias páginas compiten por la misma búsqueda.</strong> Google alterna entre ellas y ninguna sube. Decide cuál debe posicionar y enlaza o redirige las otras hacia ella.</p><QueryTable rows={r.cannibalization ?? []} showPages /></>)}
              {tab === 'cross' && (
                !r.crawl ? <Empty>Haz un crawl del sitio para cruzarlo con Search Console.</Empty> : (
                  <div className="space-y-5">
                    <section>
                      <h4 className="font-semibold text-sm">No indexables con impresiones <Badge tone={r.crawl.nonIndexableWithImpressionsCount ? 'bad' : 'good'}>{fmt(r.crawl.nonIndexableWithImpressionsCount)}</Badge></h4>
                      <p className="text-slate-500 mb-2">Google las muestra, pero el crawl dice que no deberían indexarse (noindex, canonical a otra, error o bloqueo). Si fue a propósito, saldrán solas; si no, estás a punto de perder ese tráfico.</p>
                      <PageTable rows={r.crawl.nonIndexableWithImpressions} extra={x => <span className="text-rose-600">{x.statusCode} · {x.reason}</span>} />
                    </section>
                    <section>
                      <h4 className="font-semibold text-sm">Con impresiones pero el crawl no las encontró <Badge tone={r.crawl.notInCrawlCount ? 'warn' : 'good'}>{fmt(r.crawl.notInCrawlCount)}</Badge></h4>
                      <p className="text-slate-500 mb-2">Ninguna página rastreada las enlaza (huérfanas), quedaron fuera del límite del crawl o son URLs viejas. Enlaza las que importan.</p>
                      <PageTable rows={r.crawl.notInCrawl} />
                    </section>
                    {r.crawl.shownButNotInLogsCount !== null && (
                      <section>
                        <h4 className="font-semibold text-sm">Con impresiones pero Googlebot no las visitó en el último log <Badge tone="warn">{fmt(r.crawl.shownButNotInLogsCount)}</Badge></h4>
                        <p className="text-slate-500 mb-2">Google tiene una versión guardada que no ha vuelto a revisar en ese periodo. Si cambiaste algo en ellas, Google aún no lo sabe.</p>
                        <PageTable rows={r.crawl.shownButNotInLogs} />
                      </section>
                    )}
                    <section>
                      <h4 className="font-semibold text-sm">Indexables sin ninguna impresión <Badge tone={r.crawl.indexableWithoutImpressionsCount ? 'warn' : 'good'}>{fmt(r.crawl.indexableWithoutImpressionsCount)}</Badge></h4>
                      <p className="text-slate-500 mb-2">Páginas que podrían aparecer en Google y en el periodo no aparecieron ni una vez: contenido débil, duplicado o sin enlaces. Mejóralas, júntalas o quítalas.</p>
                      <ul className="max-h-60 overflow-auto font-mono text-[11px] space-y-0.5">{r.crawl.indexableWithoutImpressions.map(u => <li key={u}>{path(u)}</li>)}</ul>
                    </section>
                    {r.sitemap && (
                      <section>
                        <h4 className="font-semibold text-sm">URLs del sitemap sin impresiones <Badge tone="warn">{fmt(r.sitemap.withoutImpressionsCount)} de {fmt(r.sitemap.urls)}</Badge></h4>
                        <ul className="max-h-60 overflow-auto font-mono text-[11px] space-y-0.5">{r.sitemap.withoutImpressions.map(u => <li key={u}>{path(u)}</li>)}</ul>
                      </section>
                    )}
                  </div>
                )
              )}
            </div>
          </Card>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" aria-hidden /> Para exportar por URL, usa el Explorador → pestaña Search Console → CSV.</p>
        </>
      )}
      {status.connected && r?.property && !r.import && !job && <Empty>Todavía no hay datos importados para este sitio. Pulsa "Importar ahora".</Empty>}
    </div>
  );
}
