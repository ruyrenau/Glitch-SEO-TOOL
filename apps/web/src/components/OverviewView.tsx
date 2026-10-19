'use client';

import React, { useEffect, useState } from 'react';
import { Activity, BadgeCheck, BarChart3, Bot, FlaskConical, Gauge, Link2, MousePointerClick, Search, Send, ShieldAlert, Sparkles, Target, Trophy } from 'lucide-react';
import { apiGet, fmt, fmtDate } from '@/lib/api';
import type { SiteOverview, GoFn } from '@/lib/types';
import { Badge, Card, Empty, ErrorBox, Kpi, Skeleton, Button } from './ui';
import { ALERT_LABEL } from './AlertsView';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tone = 'good' | 'warn' | 'bad' | 'default';
const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`);
const share = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const trendTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? 'default' : v > 0.03 ? 'good' : v < -0.03 ? 'bad' : 'default');

/** One module on the desk: a few headline numbers and a link to the full section. */
function Tile({ title, icon: Icon, nav, go, empty, emptyText, status, children }: { title: string; icon: React.ComponentType<{ className?: string }>; nav: string; go: GoFn; empty: boolean; emptyText: string; status?: [string, Tone]; children?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#151824] p-4 flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
        <h3 className="text-sm font-semibold flex-1">{title}</h3>
        {status && <Badge tone={status[1]}>{status[0]}</Badge>}
      </header>
      {empty ? <p className="text-xs text-slate-500 flex-1">{emptyText}</p> : <div className="text-xs space-y-2 flex-1">{children}</div>}
      <button onClick={() => go(nav as never)} className="self-start text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">{empty ? 'Empezar →' : 'Ver detalle →'}</button>
    </section>
  );
}

/** Big number with label and optional change. */
function Stat({ label, value, delta, tone }: { label: string; value: React.ReactNode; delta?: string | null; tone?: Tone }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-black tabular-nums">{value}</span>
        {delta && <span className={`text-[11px] tabular-nums ${tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500'}`}>{delta}</span>}
      </div>
    </div>
  );
}

const VERDICT: Record<string, [string, Tone]> = { positive: ['Funcionó', 'good'], negative: ['Empeoró', 'bad'], inconclusive: ['Sin efecto claro', 'warn'], waiting: ['Esperando datos', 'default'], low_data: ['Poco tráfico', 'warn'] };
const TASK: Record<string, Tone> = { ok: 'good', partial: 'warn', fail: 'bad' };

export function OverviewView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [data, setData] = useState<SiteOverview | null>(null);
  const [desk, setDesk] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setData(null);
    setDesk(null);
    setError(null);
    apiGet<SiteOverview>(`/api/v1/sites/${siteId}/overview`).then(setData).catch(setError);
    apiGet<any>(`/api/v1/sites/${siteId}/dashboard`).then(setDesk).catch(setError);
  }, [siteId]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !desk) return <Skeleton rows={6} />;
  const logs = data.logs;
  const { crawl, gsc, ga4, vitals, serp, aiVisibility: ai, agents, backlinks, entities, experiments, gaps, wordpress, monitor } = desk;
  const critical = (crawl?.issues.CRITICAL ?? 0) + (crawl?.issues.HIGH ?? 0);

  return (
    <div className="space-y-6">
      {data.site.isDemo && (
        <p className="text-xs text-fuchsia-700 dark:text-fuchsia-300">
          <Badge tone="demo">DEMO</Badge> Sitio de demostración con datos sintéticos, procesados con los mismos pipelines que los datos reales.
        </p>
      )}

      {/* Headline numbers: traffic and health at a glance. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Clics de Google (28 días)" value={gsc ? fmt(gsc.clicks) : '—'} tone="brand" hint={gsc ? `${pct(gsc.clicksChange) ?? 'sin periodo anterior'} vs 28 días previos` : 'Conecta Search Console'} />
        <Kpi label="Sesiones (28 días)" value={ga4 ? fmt(ga4.sessions) : '—'} hint={ga4 ? `${pct(ga4.sessionsChange) ?? 'sin periodo anterior'} · ${fmt(ga4.keyEvents)} conversiones` : 'Conecta Google Analytics'} />
        <Kpi label="Issues críticos y altos" value={crawl ? fmt(critical) : '—'} tone={!crawl ? 'default' : critical ? 'bad' : 'good'} hint={crawl ? `Crawl del ${fmtDate(crawl.date)}` : 'Haz un crawl'} />
        <Kpi label="Alertas abiertas" value={fmt(data.openAlertsCount)} tone={data.openAlertsCount ? 'warn' : 'good'} hint="Cambios peligrosos entre crawls y monitoreo" />
      </div>

      {data.openAlerts.length > 0 && (
        <Card title={`Alertas abiertas (${data.openAlertsCount})`} actions={<Button variant="secondary" onClick={() => go('alerts')}>Ver alertas</Button>}>
          <ul className="space-y-2 text-xs">
            {data.openAlerts.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={a.severity === 'CRITICAL' || a.severity === 'HIGH' ? 'bad' : 'warn'}>{ALERT_LABEL[a.type] ?? a.type}</Badge>
                <span>{a.message}</span>
                <span className="text-slate-500">· {fmtDate(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Todos los módulos</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Tile title="Search Console" icon={Search} nav="gsc" go={go} empty={!gsc} emptyText="Conecta Search Console e importa datos para ver clics, impresiones y posición.">
          {gsc && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Clics" value={fmt(gsc.clicks)} delta={pct(gsc.clicksChange)} tone={trendTone(gsc.clicksChange)} />
                <Stat label="Impresiones" value={fmt(gsc.impressions)} delta={pct(gsc.impressionsChange)} tone={trendTone(gsc.impressionsChange)} />
                <Stat label="Posición" value={gsc.position ?? '—'} />
              </div>
              <p className="text-slate-500">Últimos 28 días hasta {gsc.until}.</p>
            </>
          )}
        </Tile>

        <Tile title="Google Analytics" icon={BarChart3} nav="ga4" go={go} empty={!ga4} emptyText="Conecta GA4 para ver sesiones, conversiones y visitas que llegan desde IAs.">
          {ga4 && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Sesiones" value={fmt(ga4.sessions)} delta={pct(ga4.sessionsChange)} tone={trendTone(ga4.sessionsChange)} />
              <Stat label="Conversiones" value={fmt(ga4.keyEvents)} delta={pct(ga4.keyEventsChange)} tone={trendTone(ga4.keyEventsChange)} />
              <Stat label="Desde IAs" value={fmt(ga4.aiSessions)} />
            </div>
          )}
        </Tile>

        <Tile title="Crawl y salud técnica" icon={ShieldAlert} nav="crawler" go={go} empty={!crawl} emptyText="Haz un crawl para auditar el sitio: estados, indexabilidad, títulos, enlaces y más." status={crawl ? (critical ? ['Revisar', 'bad'] : ['Sano', 'good']) : undefined}>
          {crawl && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Páginas" value={fmt(crawl.pages)} />
                <Stat label="Indexables" value={fmt(crawl.indexable)} />
                <Stat label="Errores 4xx/5xx" value={fmt(crawl.errors4xx + crawl.errors5xx)} tone={crawl.errors4xx + crawl.errors5xx ? 'bad' : 'good'} />
              </div>
              <p className="flex flex-wrap gap-1">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(s => (crawl.issues[s] ? <Badge key={s} tone={s === 'CRITICAL' || s === 'HIGH' ? 'bad' : 'warn'}>{crawl.issues[s]} {({ CRITICAL: 'críticos', HIGH: 'altos', MEDIUM: 'medios', LOW: 'bajos' } as const)[s]}</Badge> : null))}
                {!Object.keys(crawl.issues).length && <span className="text-slate-500">Sin issues abiertos.</span>}
              </p>
              <p className="text-slate-500">Crawl del {fmtDate(crawl.date)}.</p>
            </>
          )}
        </Tile>

        <Tile title="Core Web Vitals" icon={Gauge} nav="vitals" go={go} empty={!vitals} emptyText="Mide la velocidad de tus páginas clave en móvil y escritorio." status={vitals?.avgScore != null ? (vitals.avgScore >= 90 ? ['Rápido', 'good'] : vitals.avgScore >= 50 ? ['Mejorable', 'warn'] : ['Lento', 'bad']) : undefined}>
          {vitals && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Puntaje medio" value={vitals.avgScore ?? '—'} />
                <Stat label="Páginas lentas" value={fmt(vitals.slow)} tone={vitals.slow ? 'bad' : 'good'} />
                <Stat label="Aprueban (reales)" value={vitals.fieldPages ? `${vitals.fieldPassing}/${vitals.fieldPages}` : '—'} />
              </div>
              <p className="text-slate-500">{vitals.urls} URL(s) medidas · última el {fmtDate(vitals.date)}.</p>
            </>
          )}
        </Tile>

        <Tile title="Autoridad y SERP" icon={Trophy} nav="authority" go={go} empty={!serp && !backlinks} emptyText="Sigue tus keywords en Google (SerpAPI) y revisa tus backlinks desde un CSV.">
          {serp && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="En top 3" value={`${serp.top3}/${serp.keywords}`} />
              <Stat label="En top 10" value={`${serp.top10}/${serp.keywords}`} />
              <Stat label="AI Overview te cita" value={serp.aiOverviews ? `${serp.aiCitesUs}/${serp.aiOverviews}` : '—'} />
            </div>
          )}
          {backlinks && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Backlinks vivos" value={fmt(backlinks.live)} />
              <Stat label="Perdidos" value={fmt(backlinks.lost)} tone={backlinks.lost ? 'bad' : 'good'} />
              <Stat label="Dominios" value={fmt(backlinks.domains)} />
            </div>
          )}
          {serp?.date && <p className="text-slate-500">SERP revisada el {serp.date}{serp.avgPosition ? ` · posición media ${serp.avgPosition}` : ''}.</p>}
        </Tile>

        <Tile title="Brechas de contenido" icon={Target} nav="gaps" go={go} empty={!gaps} emptyText="Descubre qué keywords tienen tus competidores en el top 10 y tú no.">
          {gaps && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="No apareces" value={fmt(gaps.missing)} tone={gaps.missing ? 'bad' : 'good'} />
                <Stat label="Detrás de ellos" value={fmt(gaps.weak)} />
                <Stat label="Briefs" value={`${gaps.briefs}/${gaps.clusters}`} />
              </div>
              {gaps.top.length > 0 && <ul className="space-y-0.5">{gaps.top.map((t: any) => <li key={t.lead}><Badge tone={t.action === 'new' ? 'bad' : 'warn'}>{t.action === 'new' ? 'Nueva' : 'Mejorar'}</Badge> {t.lead}</li>)}</ul>}
            </>
          )}
        </Tile>

        <Tile title="Visibilidad en IA" icon={Sparkles} nav="geo" go={go} empty={!ai} emptyText="Registra preguntas y revisa si ChatGPT, Gemini, Claude o Perplexity te mencionan.">
          {ai && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Te mencionan" value={share(ai.mentionRate)} />
                <Stat label="Te citan" value={share(ai.citeRate)} />
                <Stat label="Preguntas" value={fmt(ai.prompts)} />
              </div>
              <p className="text-slate-500">{ai.date ? `${ai.observations} respuestas en los 30 días hasta ${ai.date}.` : 'Aún sin respuestas registradas.'}</p>
            </>
          )}
        </Tile>

        <Tile title="Listo para IA" icon={Bot} nav="aiready" go={go} empty={!crawl?.aiReadiness} emptyText="Califica qué tan fácil es para las IAs citar cada página (usa el último crawl)." status={crawl?.aiReadiness ? (crawl.aiReadiness.average >= 80 ? ['Excelente', 'good'] : crawl.aiReadiness.average >= 60 ? ['Bien', 'good'] : crawl.aiReadiness.average >= 40 ? ['Mejorable', 'warn'] : ['Bajo', 'bad']) : undefined}>
          {crawl?.aiReadiness && (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Puntaje medio" value={`${crawl.aiReadiness.average}/100`} />
              <Stat label="Páginas calificadas" value={fmt(crawl.aiReadiness.pages)} />
            </div>
          )}
        </Tile>

        <Tile title="Agentes de IA" icon={MousePointerClick} nav="agents" go={go} empty={!agents} emptyText="Revisa si un agente de IA puede encontrar tus precios, contactarte y usar tu botón principal.">
          {agents && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Puntaje para agentes" value={agents.average !== null ? `${agents.average}/100` : '—'} />
                <Stat label="Catálogo MCP" value={agents.catalogItems !== null ? `${agents.catalogItems} items` : 'Sin crear'} />
              </div>
              {agents.tasks.length > 0 && <p className="flex flex-wrap gap-1">{agents.tasks.map((t: any) => <Badge key={t.label} tone={TASK[t.status] ?? 'default'}>{t.label}</Badge>)}</p>}
            </>
          )}
        </Tile>

        <Tile title="Entidades y E-E-A-T" icon={BadgeCheck} nav="entities" go={go} empty={!entities} emptyText="Define tu organización y autores para que Google y las IAs sepan quién eres.">
          {entities && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Organización" value={entities.orgName ? '✓' : '—'} />
              <Stat label="Autores" value={fmt(entities.authors)} />
              <Stat label="Perfiles (sameAs)" value={fmt(entities.sameAs)} />
            </div>
          )}
        </Tile>

        <Tile title="Experimentos SEO" icon={FlaskConical} nav="experiments" go={go} empty={!experiments} emptyText="Anota cada cambio y mide si funcionó contra un grupo de control.">
          {experiments && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Funcionaron" value={fmt(experiments.positive)} tone="good" />
                <Stat label="Empeoraron" value={fmt(experiments.negative)} tone={experiments.negative ? 'bad' : 'default'} />
                <Stat label="Sin resultado" value={fmt(experiments.pending)} />
              </div>
              <ul className="space-y-0.5">{experiments.latest.map((x: any) => <li key={x.name + x.changeDate} className="flex flex-wrap gap-1 items-center">{x.verdict ? <Badge tone={VERDICT[x.verdict][1]}>{VERDICT[x.verdict][0]}</Badge> : <Badge>Sin analizar</Badge>} {x.name}{x.effect !== null && <span className="text-slate-500">({pct(x.effect)})</span>}</li>)}</ul>
            </>
          )}
        </Tile>

        <Tile title="WordPress y cambios SEO" icon={Send} nav="seochanges" go={go} empty={!wordpress} emptyText="Conecta WordPress para aplicar títulos, metas y enlaces desde aquí, con aprobación." status={wordpress ? (wordpress.connected ? ['Conectado', 'good'] : ['Sin conexión', 'warn']) : undefined}>
          {wordpress && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Por aprobar" value={fmt(wordpress.proposed)} tone={wordpress.proposed ? 'warn' : 'default'} />
              <Stat label="Aplicados" value={fmt(wordpress.applied)} />
              <Stat label="Con error" value={fmt(wordpress.failed)} tone={wordpress.failed ? 'bad' : 'default'} />
            </div>
          )}
        </Tile>

        <Tile title="Logs y bots" icon={Link2} nav="logs" go={go} empty={!logs} emptyText="Importa un log de Nginx o Apache para ver cómo rastrean Google y los bots de IA.">
          {logs && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Solicitudes" value={fmt(logs.requests)} />
                <Stat label="Googlebot" value={fmt(logs.googlebotRequests)} />
                <Stat label="Bots de IA" value={fmt(logs.aiBotRequests)} />
              </div>
              <p className="text-slate-500">{fmtDate(logs.period.start)} → {fmtDate(logs.period.end)} · {fmt(data.sitemapUrls)} URLs de sitemap.</p>
            </>
          )}
        </Tile>

        <Tile title="Monitoreo automático" icon={Activity} nav="monitor" go={go} empty={!monitor} emptyText="Programa importaciones, mediciones y avisos para que el sitio se vigile solo.">
          {monitor && (
            <p className="flex flex-wrap gap-1">
              {([['gsc', 'Search Console diario'], ['vitals', 'Core Web Vitals'], ['serp', 'SERP semanal'], ['notify', 'Avisos']] as const).map(([k, l]) => <Badge key={k} tone={monitor[k] ? 'good' : 'default'}>{monitor[k] ? '✓' : '○'} {l}</Badge>)}
            </p>
          )}
        </Tile>
      </div>

      <Card title="Actividad reciente" actions={<Button variant="secondary" onClick={() => go('audit')}>Audit log</Button>}>
        {data.recentEvents.length ? (
          <ul className="space-y-2 text-xs">
            {data.recentEvents.map(e => (
              <li key={e.id} className="flex justify-between gap-3">
                <span className="font-mono">{e.action}</span>
                <span className="text-slate-500 shrink-0">{fmtDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Sin eventos todavía.</Empty>
        )}
      </Card>
    </div>
  );
}
