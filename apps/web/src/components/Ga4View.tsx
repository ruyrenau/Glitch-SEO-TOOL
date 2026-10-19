'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Link2, Loader2, RefreshCw } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmt, fmtDate, waitForJob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn, JobRow } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';
import { TimeChart } from './MonitorView';

interface Status { configured: boolean; connected: boolean; email: string | null; analytics: boolean }
interface Prop { property: string; displayName: string; account: string }
interface Metrics { sessions: number; users: number; engagementRate: number; avgEngagementSec: number; keyEvents: number; conversionRate: number; revenue: number }
type PageRow = Metrics & { page: string; url: string; title: string | null; clicks?: number | null; impressions?: number | null; position?: number | null };
interface Report {
  property: string | null;
  propertyName: string | null;
  import: { startDate: string; endDate: string; completedAt: string } | null;
  lastImport: { status: string; error: string | null; createdAt: string } | null;
  totals?: { organic: Metrics; allSessions: number; organicShare: number; ai: Metrics; aiShare: number };
  channels?: Array<{ channel: string; sessions: number; keyEvents: number; share: number }>;
  daily?: Array<{ date: string; organic: number; total: number }>;
  organicPages?: PageRow[];
  lowEngagement?: PageRow[];
  ai?: { engines: Array<Metrics & { engine: string }>; pages: Array<PageRow & { engines: Array<{ engine: string; sessions: number }> }> };
  hasGsc?: boolean;
}

const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const money = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
function downloadCsv(name: string, lines: Array<Array<string | number | null>>) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
}
const PageCell = ({ p }: { p: PageRow }) => (
  <td className="py-1.5 pr-2">
    <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] break-all hover:underline">{p.page}</a>
    {p.title && <div className="text-slate-500 truncate max-w-md">{p.title}</div>}
  </td>
);

/** Google Analytics 4: what happens after the click (organic landing pages, AI assistant referrals). */
export function Ga4View({ siteId, go, notice }: { siteId: string; go: GoFn; notice?: { kind: 'connected' | 'error'; message?: string } | null }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [props, setProps] = useState<Prop[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [property, setProperty] = useState('');
  const [days, setDays] = useState(90);
  const [job, setJob] = useState<JobRow | null>(null);
  const [tab, setTab] = useState<'organic' | 'ai' | 'low' | 'channels'>('organic');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await apiGet<Status>('/api/v1/ga4/status');
      setStatus(s);
      const r = await apiGet<Report>(`/api/v1/sites/${siteId}/ga4/report`);
      setReport(r);
      setProperty(r.property ?? '');
      if (s.connected && s.analytics) setProps(await apiGet<Prop[]>('/api/v1/ga4/properties'));
    } catch (e) {
      setError(e);
    }
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setError(null);
    setSaved(null);
    try {
      await apiSend('PUT', `/api/v1/sites/${siteId}/ga4`, { property: property || null });
      setSaved('Propiedad guardada.');
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const runImport = async () => {
    setError(null);
    try {
      const { jobId } = await apiSend<{ jobId: string }>('POST', `/api/v1/sites/${siteId}/ga4/import`, { days });
      const done = await waitForJob<JobRow>(jobId, setJob, 1500);
      if (done.status !== 'COMPLETED') throw new Error(done.error ?? `La importación terminó con estado ${done.status}.`);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setJob(null);
    }
  };

  if (!status) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  const connectUrl = `${API_URL}/api/v1/gsc/oauth/start?back=ga4`;
  const r = report;
  const t = r?.totals;

  return (
    <div className="space-y-4">
      <Card title="Conexión">
        <div className="text-xs space-y-3">
          <p className="text-slate-600 dark:text-slate-300">Search Console dice qué pasa antes del clic; Analytics, qué pasa después: si la gente se queda, convierte o se va. Se usa la misma cuenta de Google, solo lectura.</p>
          {!status.configured ? (
            <p className="text-amber-700">Falta configurar GSC_CLIENT_ID y GSC_CLIENT_SECRET en el archivo .env (ver Search Console en el manual).</p>
          ) : !status.connected ? (
            <a href={connectUrl} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"><Link2 className="w-4 h-4" aria-hidden /> Conectar con Google</a>
          ) : !status.analytics ? (
            <div className="space-y-2">
              <p className="text-amber-700 dark:text-amber-400 font-semibold">La cuenta {status.email} está conectada, pero sin permiso de Google Analytics.</p>
              <p className="text-slate-500">En Google Cloud agrega el permiso <span className="font-mono">analytics.readonly</span> en Google Auth Platform → Acceso a datos, y habilita "Google Analytics Data API" y "Google Analytics Admin API". Después vuelve a conectar y marca la casilla de Analytics.</p>
              {can('site:manage') && <a href={connectUrl} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"><RefreshCw className="w-4 h-4" aria-hidden /> Volver a conectar con Google</a>}
            </div>
          ) : (
            <>
              <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden /> Conectado como {status.email}.</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1">
                  <span className="block font-semibold">Propiedad de GA4 de este sitio</span>
                  <select aria-label="Propiedad de GA4" className={inputCls} value={property} onChange={e => setProperty(e.target.value)} disabled={!can('site:manage')}>
                    <option value="">Elige una propiedad…</option>
                    {(props ?? []).map(p => <option key={p.property} value={p.property}>{p.displayName}{p.account ? ` · ${p.account}` : ''}</option>)}
                  </select>
                </label>
                <Button variant="secondary" disabled={!can('site:manage') || property === (r?.property ?? '')} onClick={save}>Guardar</Button>
                {props && !props.length && <span className="text-amber-700">Tu cuenta no tiene propiedades de GA4.</span>}
              </div>
              {saved && <p role="status" className="text-emerald-700">{saved}</p>}
              {r?.property && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="block font-semibold">Periodo</span>
                    <select aria-label="Periodo de GA4" className={inputCls} value={days} onChange={e => setDays(Number(e.target.value))}>
                      <option value={28}>Últimos 28 días</option>
                      <option value={90}>Últimos 3 meses</option>
                      <option value={180}>Últimos 6 meses</option>
                      <option value={365}>Último año</option>
                    </select>
                  </label>
                  {job ? (
                    <span className="flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Importando…</span>
                  ) : (
                    <Button disabled={!can('seo:operate')} onClick={runImport}>Importar ahora</Button>
                  )}
                  {r.import && <span className="text-slate-500">Datos del {r.import.startDate} al {r.import.endDate} (importados {fmtDate(r.import.completedAt)}).</span>}
                </div>
              )}
              {r?.lastImport?.status === 'failed' && <p className="text-rose-600">La última importación falló: {r.lastImport.error}</p>}
            </>
          )}
          {notice?.kind === 'error' && <p role="alert" className="text-rose-600">No se pudo conectar: {notice.message}</p>}
          <ErrorBox error={error} />
        </div>
      </Card>

      {!r?.import || !t ? (
        status.connected && status.analytics && r?.property ? <Empty>Pulsa "Importar ahora" para traer los datos de Analytics.</Empty> : null
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <Kpi label="Sesiones orgánicas" value={fmt(t.organic.sessions)} hint={`${t.organicShare} % del total`} tone="brand" />
            <Kpi label="Usuarios orgánicos" value={fmt(t.organic.users)} />
            <Kpi label="Tasa de interacción" value={`${t.organic.engagementRate} %`} hint="sesiones con interacción" tone={t.organic.engagementRate >= 55 ? 'good' : t.organic.engagementRate >= 40 ? 'warn' : 'bad'} />
            <Kpi label="Tiempo medio" value={secs(t.organic.avgEngagementSec)} hint="de interacción por sesión" />
            <Kpi label="Eventos clave" value={fmt(t.organic.keyEvents)} hint={`${t.organic.conversionRate} % de las sesiones`} />
            <Kpi label="Sesiones desde IAs" value={fmt(t.ai.sessions)} hint={`${t.aiShare} % del total`} tone="brand" />
          </div>
          {t.organic.revenue > 0 && <p className="text-xs text-slate-500">Ingresos del tráfico orgánico: <strong>{money(t.organic.revenue)}</strong> (moneda de la propiedad).</p>}
          <TimeChart title="Sesiones por día" series={[{ label: 'Búsqueda orgánica', points: (r.daily ?? []).map(d => ({ x: +new Date(`${d.date}T12:00:00`), y: d.organic })) }, { label: 'Todos los canales', points: (r.daily ?? []).map(d => ({ x: +new Date(`${d.date}T12:00:00`), y: d.total })) }]} events={[]} />

          <Card>
            <div role="tablist" aria-label="Google Analytics" className="flex flex-wrap gap-1 mb-3">
              {([['organic', 'Orgánico por página'], ['ai', 'Desde IAs'], ['low', 'Clics sin interacción'], ['channels', 'Canales']] as const).map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
              ))}
            </div>
            <div className="text-xs space-y-2">
              {tab === 'organic' && (
                <>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <p className="text-slate-500">Páginas de entrada de quien llega desde Google (búsqueda orgánica).{r.hasGsc ? ' Con clics y posición de Search Console.' : ''}</p>
                    <Button variant="secondary" onClick={() => downloadCsv('ga4-organico.csv', [['Página', 'Sesiones', 'Usuarios', 'Interacción %', 'Tiempo medio (s)', 'Eventos clave', 'Conversión %', 'Ingresos', 'Clics GSC', 'Posición'], ...(r.organicPages ?? []).map(p => [p.url, p.sessions, p.users, p.engagementRate, p.avgEngagementSec, p.keyEvents, p.conversionRate, p.revenue, p.clicks ?? '', p.position ?? ''])])}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>
                  </div>
                  {!r.organicPages?.length ? <Empty>Sin sesiones orgánicas en el periodo.</Empty> : (
                    <div className="overflow-auto max-h-[32rem]">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-white dark:bg-[#151824]"><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-2">Página</th><th className="text-right">Sesiones</th><th className="text-right">Interacción</th><th className="text-right">Tiempo medio</th><th className="text-right">Eventos clave</th><th className="text-right">Conversión</th>{r.hasGsc && <><th className="text-right">Clics GSC</th><th className="text-right">Posición</th></>}</tr></thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {r.organicPages.map(p => (
                            <tr key={p.page}>
                              <PageCell p={p} />
                              <td className="text-right tabular-nums">{fmt(p.sessions)}</td>
                              <td className={`text-right tabular-nums ${p.engagementRate < 40 ? 'text-rose-600' : ''}`}>{p.engagementRate} %</td>
                              <td className="text-right tabular-nums">{secs(p.avgEngagementSec)}</td>
                              <td className="text-right tabular-nums">{fmt(p.keyEvents)}</td>
                              <td className="text-right tabular-nums">{p.conversionRate} %</td>
                              {r.hasGsc && <><td className="text-right tabular-nums">{p.clicks === null ? '—' : fmt(p.clicks ?? 0)}</td><td className="text-right tabular-nums">{p.position ?? '—'}</td></>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {tab === 'ai' && (
                <>
                  <p className="text-slate-500">Visitas que llegan desde ChatGPT, Perplexity, Gemini, Copilot, Claude y otros asistentes. Es el resultado real de aparecer en sus respuestas: compáralo con <button className="text-indigo-600 underline" onClick={() => go('geo')}>Visibilidad en IA</button> y <button className="text-indigo-600 underline" onClick={() => go('aiready')}>Listo para IA</button>.</p>
                  {!r.ai?.engines.length ? <Empty>Ninguna visita desde asistentes de IA en el periodo.</Empty> : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {r.ai.engines.map(e => <Kpi key={e.engine} label={e.engine} value={fmt(e.sessions)} hint={`${e.engagementRate} % interacción · ${fmt(e.keyEvents)} eventos clave`} />)}
                      </div>
                      <table className="w-full">
                        <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-2">Página</th><th className="text-right">Sesiones</th><th className="pl-3">De dónde</th><th className="text-right">Interacción</th><th className="text-right">Eventos clave</th></tr></thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {r.ai.pages.map(p => (
                            <tr key={p.page}>
                              <PageCell p={p} />
                              <td className="text-right tabular-nums">{fmt(p.sessions)}</td>
                              <td className="pl-3">{p.engines.map(e => `${e.engine} ${fmt(e.sessions)}`).join(' · ')}</td>
                              <td className="text-right tabular-nums">{p.engagementRate} %</td>
                              <td className="text-right tabular-nums">{fmt(p.keyEvents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}

              {tab === 'low' && (
                <>
                  <p className="text-slate-500"><strong>Llegan desde Google pero no interactúan</strong> (menos de 40 % de sesiones con interacción, mínimo 20 sesiones). La página no cumple lo que promete el resultado: revisa que el título coincida con el contenido, que la respuesta esté arriba y que cargue rápido.</p>
                  {!r.lowEngagement?.length ? <Empty>Ninguna página con baja interacción.</Empty> : (
                    <table className="w-full">
                      <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-2">Página</th><th className="text-right">Sesiones</th><th className="text-right">Interacción</th><th className="text-right">Tiempo medio</th>{r.hasGsc && <th className="text-right">Clics GSC</th>}</tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {r.lowEngagement.map(p => (
                          <tr key={p.page}><PageCell p={p} /><td className="text-right tabular-nums">{fmt(p.sessions)}</td><td className="text-right tabular-nums text-rose-600">{p.engagementRate} %</td><td className="text-right tabular-nums">{secs(p.avgEngagementSec)}</td>{r.hasGsc && <td className="text-right tabular-nums">{p.clicks === null ? '—' : fmt(p.clicks ?? 0)}</td>}</tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {tab === 'channels' && (
                <table className="w-full max-w-xl">
                  <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-2">Canal</th><th className="text-right">Sesiones</th><th className="text-right">% del total</th><th className="text-right">Eventos clave</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(r.channels ?? []).map(c => <tr key={c.channel}><td className="py-1.5">{c.channel} {c.channel === 'Organic Search' && <Badge tone="good">SEO</Badge>}</td><td className="text-right tabular-nums">{fmt(c.sessions)}</td><td className="text-right tabular-nums">{c.share} %</td><td className="text-right tabular-nums">{fmt(c.keyEvents)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
          <p className="text-[11px] text-slate-500">GA4 aplica umbrales de privacidad: en páginas con poco tráfico algunos valores pueden faltar o salir en cero.</p>
        </>
      )}
    </div>
  );
}
