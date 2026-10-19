'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, XCircle, MinusCircle } from 'lucide-react';
import { apiGet, fmt, fmtDate } from '@/lib/api';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

type CheckId = string;
interface CheckDef { label: string; weight: number; why: string; fix: string }
interface PageRow { url: string; title: string | null; score: number; grade: string; clicks: number | null; impressions: number | null; failing: CheckId[]; checks: Array<{ id: CheckId; score: number; detail: string }> }
interface Bot { agent: string; owner: string; use: string; allowed: boolean }
interface Data {
  crawl: { id: string; startedAt: string; mode: string } | null;
  signals: { robots: { found: boolean; bots: Bot[] }; llmsTxt: { found: boolean; lines: number } };
  checks: Record<CheckId, CheckDef>;
  summary: { pages: number; average: number; grade: string; distribution: Record<string, number>; byCheck: Array<{ id: CheckId; label: string; weight: number; failing: number; pct: number }>; priority: string[]; blockedSearch: string[]; capped: boolean; hasGsc: boolean } | null;
  pages: PageRow[];
}
interface Crawl { id: string; status: string; startedAt: string; urlsCrawled: number; mode: string; detailPurgedAt: string | null }

const GRADE: Record<string, [string, 'good' | 'warn' | 'bad' | 'default']> = { excelente: ['Excelente', 'good'], bien: ['Bien', 'good'], mejorable: ['Mejorable', 'warn'], bajo: ['Bajo', 'bad'] };
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

/** "Listo para IA": how quotable each page is for ChatGPT, Gemini, Perplexity and AI Overviews. */
export function AiReadinessView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [crawls, setCrawls] = useState<Crawl[] | null>(null);
  const [crawlId, setCrawlId] = useState<string>('');
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [check, setCheck] = useState<string>('all');
  const [grade, setGrade] = useState<string>('all');
  const [sort, setSort] = useState<'priority' | 'score' | 'impressions'>('priority');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Crawl[]>(`/api/v1/sites/${siteId}/crawls`).then(c => setCrawls(c.filter(r => r.status === 'completed' && !r.detailPurgedAt)), () => setCrawls([]));
  }, [siteId]);
  useEffect(() => {
    setD(null);
    setError(null);
    apiGet<Data>(`/api/v1/sites/${siteId}/ai-readiness${crawlId ? `?crawlRunId=${crawlId}` : ''}`).then(setD, setError);
  }, [siteId, crawlId]);

  const rows = useMemo(() => {
    if (!d) return [];
    const term = q.trim().toLowerCase();
    const pri = new Map(d.summary?.priority.map((u, i) => [u, i]) ?? []);
    return d.pages
      .filter(p => (check === 'all' || p.failing.includes(check)) && (grade === 'all' || p.grade === grade) && (!term || p.url.toLowerCase().includes(term) || (p.title ?? '').toLowerCase().includes(term)))
      .sort((a, b) =>
        sort === 'score' ? a.score - b.score : sort === 'impressions' ? (b.impressions ?? -1) - (a.impressions ?? -1) : (pri.get(a.url) ?? 999) - (pri.get(b.url) ?? 999) || (b.impressions ?? 0) * (100 - b.score) - (a.impressions ?? 0) * (100 - a.score) || a.score - b.score
      );
  }, [d, check, grade, sort, q]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={6} />;

  const csv = () => {
    const ids = Object.keys(d.checks);
    const lines = [['URL', 'Título', 'Puntaje', 'Nivel', 'Clics', 'Impresiones', ...ids.map(i => d.checks[i].label)]];
    for (const p of rows) lines.push([p.url, p.title ?? '', String(p.score), p.grade, String(p.clicks ?? ''), String(p.impressions ?? ''), ...ids.map(i => String(Math.round((p.checks.find(c => c.id === i)?.score ?? 0) * 100)) + '%')]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'listo-para-ia.csv';
    a.click();
  };

  return (
    <div className="space-y-4">
      <Card title="Qué mide">
        <p className="text-xs text-slate-600 dark:text-slate-300">Qué tan fácil es para ChatGPT, Gemini, Perplexity o los AI Overviews de Google leer cada página, sacar una respuesta y citarla. Son 11 revisiones fijas sobre el HTML del crawl (sin IA), con un puntaje de 0 a 100 y la corrección de cada una.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-xs">
          <label>Crawl <select aria-label="Crawl" className={inputCls} value={crawlId} onChange={e => setCrawlId(e.target.value)}>
            <option value="">El más reciente</option>
            {(crawls ?? []).map(c => <option key={c.id} value={c.id}>{fmtDate(c.startedAt)} · {fmt(c.urlsCrawled)} URLs{c.mode === 'list' ? ' · lista' : ''}</option>)}
          </select></label>
        </div>
      </Card>

      <Card title="Acceso de los bots de IA">
        <div className="text-xs space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge tone={d.signals.robots.found ? 'default' : 'warn'}>{d.signals.robots.found ? 'robots.txt encontrado' : 'Sin robots.txt: todos pueden entrar'}</Badge>
            <Badge tone={d.signals.llmsTxt.found ? 'good' : 'default'}>{d.signals.llmsTxt.found ? `llms.txt encontrado (${d.signals.llmsTxt.lines} líneas)` : 'Sin llms.txt (opcional)'}</Badge>
          </div>
          {d.summary && d.summary.blockedSearch.length > 0 && <p className="text-rose-700 dark:text-rose-400 font-semibold">Bloqueas a {d.summary.blockedSearch.join(', ')}: esos buscadores con IA no pueden leer ni citar tu sitio.</p>}
          <table className="w-full">
            <thead><tr className="text-slate-500 text-left"><th className="py-1">Bot</th><th>De</th><th>Para qué</th><th>Acceso</th></tr></thead>
            <tbody>{d.signals.robots.bots.map(b => (
              <tr key={b.agent} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 font-mono">{b.agent}</td><td>{b.owner}</td><td className="text-slate-500">{b.use}</td>
                <td>{b.allowed ? <Badge tone="good">Permitido</Badge> : <Badge tone="bad">Bloqueado</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="text-slate-500">Bloquear bots de entrenamiento (GPTBot, ClaudeBot, CCBot, Google-Extended) es una decisión de negocio; bloquear los de búsqueda (OAI-SearchBot, PerplexityBot, Googlebot, Bingbot) te saca de sus respuestas.</p>
        </div>
      </Card>

      {!d.crawl || !d.summary ? (
        <Empty>Haz un crawl del sitio para calificar sus páginas. <button className="text-indigo-600 underline" onClick={() => go('crawler')}>Ir a Crawl y auditoría</button></Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Kpi label="Puntaje medio" value={`${d.summary.average}/100`} hint={GRADE[d.summary.grade][0]} tone={d.summary.average >= 60 ? 'good' : d.summary.average >= 40 ? 'warn' : 'bad'} />
            {(['excelente', 'bien', 'mejorable', 'bajo'] as const).map(g => <Kpi key={g} label={GRADE[g][0]} value={fmt(d.summary!.distribution[g])} hint="páginas" />)}
          </div>
          {d.summary.capped && <p className="text-xs text-amber-700">Se calificaron las primeras 5,000 páginas del crawl (por profundidad).</p>}

          <Card title="Lo que más falta en el sitio">
            <ul className="text-xs space-y-1.5">
              {d.summary.byCheck.map(c => (
                <li key={c.id} className="flex items-center gap-3">
                  <button className="w-56 text-left hover:underline" onClick={() => setCheck(c.id)}>{c.label}</button>
                  <div className="flex-1 h-2 rounded bg-slate-100 dark:bg-slate-800"><div className={`h-2 rounded ${c.pct >= 50 ? 'bg-rose-500' : c.pct >= 20 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.pct}%` }} /></div>
                  <span className="w-36 text-right tabular-nums text-slate-500">{fmt(c.failing)} páginas ({c.pct}%)</span>
                </li>
              ))}
            </ul>
            {!d.summary.hasGsc && <p className="mt-2 text-xs text-slate-500">Conecta Search Console para ordenar las páginas por demanda real.</p>}
          </Card>

          <Card title={`Páginas (${fmt(rows.length)})`} actions={<Button variant="secondary" onClick={csv} disabled={!rows.length}><Download className="w-3.5 h-3.5" aria-hidden /> CSV</Button>}>
            <div className="flex flex-wrap items-end gap-3 text-xs mb-3">
              <label>Falla en <select aria-label="Falla en" className={inputCls} value={check} onChange={e => setCheck(e.target.value)}><option value="all">Cualquiera</option>{Object.entries(d.checks).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}</select></label>
              <label>Nivel <select aria-label="Nivel" className={inputCls} value={grade} onChange={e => setGrade(e.target.value)}><option value="all">Todos</option>{Object.entries(GRADE).map(([g, [l]]) => <option key={g} value={g}>{l}</option>)}</select></label>
              <label>Orden <select aria-label="Orden" className={inputCls} value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="priority">Prioridad (demanda × lo que falta)</option><option value="score">Puntaje más bajo</option><option value="impressions">Más impresiones</option></select></label>
              <input aria-label="Buscar página" placeholder="Buscar URL o título" className={`${inputCls} flex-1 min-w-[12rem]`} value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {!rows.length ? <Empty>Ninguna página con estos filtros.</Empty> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {rows.slice(0, 300).map(p => (
                  <li key={p.url} className="py-2">
                    <button className="w-full flex items-center gap-3 text-left" aria-expanded={open === p.url} onClick={() => setOpen(open === p.url ? null : p.url)}>
                      <span className={`w-12 text-right text-base font-black tabular-nums ${p.score >= 60 ? 'text-emerald-600' : p.score >= 40 ? 'text-amber-600' : 'text-rose-600'}`}>{p.score}</span>
                      <span className="flex-1 min-w-0"><span className="block font-mono text-[11px] truncate">{path(p.url)}</span><span className="block text-slate-500 truncate">{p.title}</span></span>
                      {p.impressions !== null && <span className="tabular-nums text-slate-500 w-28 text-right">{fmt(p.impressions)} impr.</span>}
                      <span className="text-slate-500 w-24 text-right">{p.failing.length} por mejorar</span>
                    </button>
                    {open === p.url && (
                      <ul className="mt-2 ml-14 space-y-1.5" aria-label={`Revisiones de ${path(p.url)}`}>
                        {p.checks.map(c => {
                          const def = d.checks[c.id];
                          const Icon = c.score >= 1 ? CheckCircle2 : c.score > 0 ? MinusCircle : XCircle;
                          return (
                            <li key={c.id} className="flex gap-2">
                              <Icon className={`w-4 h-4 shrink-0 ${c.score >= 1 ? 'text-emerald-600' : c.score > 0 ? 'text-amber-500' : 'text-rose-600'}`} aria-hidden />
                              <div>
                                <span className="font-semibold">{def.label}</span> <span className="text-slate-400">({Math.round(c.score * def.weight)}/{def.weight})</span> — {c.detail}
                                {c.score < 1 && <div className="text-slate-500"><strong>Cómo mejorarlo:</strong> {def.fix} <em>{def.why}</em></div>}
                              </div>
                            </li>
                          );
                        })}
                        <li><a className="text-indigo-600 hover:underline" href={p.url} target="_blank" rel="noreferrer">Abrir la página</a></li>
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {rows.length > 300 && <p className="text-xs text-slate-500 mt-2">Se muestran 300; descarga el CSV para verlas todas.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
