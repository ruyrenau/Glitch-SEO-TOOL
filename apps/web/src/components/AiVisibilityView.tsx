'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Download, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { API_URL, apiGet, apiSend, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';
import { TimeChart } from './MonitorView';

type Engine = 'chatgpt' | 'claude' | 'gemini' | 'google_ai';
type Trend = 'mejoro' | 'neutral' | 'empeoro' | 'primera';
const ENGINES: Record<Engine, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_ai: 'Google (IA)' };
const POS = [
  [1, '1.er lugar'],
  [3, 'Top 3'],
  [4, '4+']
] as const;
const TREND: Record<Trend, { label: string; tone: 'good' | 'bad' | 'default'; icon: React.ComponentType<{ className?: string }> }> = {
  mejoro: { label: 'Mejoró', tone: 'good', icon: ArrowUp },
  empeoro: { label: 'Empeoró', tone: 'bad', icon: ArrowDown },
  neutral: { label: 'Neutral', tone: 'default', icon: Minus },
  primera: { label: 'Primera', tone: 'default', icon: Minus }
};
const mScore = (on: boolean, p: number | null) => (!on ? 0 : p === 1 ? 5 : p === 3 ? 4 : p === 4 ? 3 : 0);
const cScore = (on: boolean, p: number | null) => (!on ? 0 : p === 1 ? 3 : p === 3 ? 2 : p === 4 ? 1 : 0);
const today = () => new Date().toISOString().slice(0, 10);

interface Prompt { id: string; text: string; keyword: string; active: boolean; _count?: { observations: number } }
interface Cell { date: string; mentionScore: number; citeScore: number; total: number; trend: Trend; checks: number }
interface Matrix {
  keywords: string[];
  rows: Array<{ prompt: Prompt; cells: Record<Engine, Cell | null> }>;
  evolution: Array<{ week: string; all: number } & Partial<Record<Engine, number>>>;
  byKeyword: Array<{ keyword: string; checks: number; avgPoints: number; mentionRate: number; citeRate: number }>;
  insights: Array<{ tone: 'bad' | 'good' | 'warn' | 'info'; text: string }>;
}
interface Obs {
  id: string; date: string; engine: Engine; mentioned: boolean; mentionPos: number | null; mentionText: string | null; mentionComment: string | null;
  cited: boolean; citePos: number | null; citeText: string | null; citeComment: string | null; mentionScore: number; citeScore: number; mentionTrend: Trend; citeTrend: Trend;
}
/** touched = the user answered this row (or it was loaded from a saved check); until then no result or trend is shown. */
interface Row { on: boolean; pos: number | null; text: string; comment: string; touched: boolean }
const EMPTY: Row = { on: false, pos: null, text: '', comment: '', touched: false };

function TrendBadge({ t }: { t: Trend }) {
  const x = TREND[t];
  const Icon = x.icon;
  return <Badge tone={x.tone}><Icon className="inline w-3 h-3 mr-0.5" aria-hidden />{x.label}</Badge>;
}

/** One row of the check form: Aparece / Cita → position → pasted answer → result → trend → comments. */
function CheckRow({ label, verb, row, set, score, previous }: { label: string; verb: string; row: Row; set: (r: Row) => void; score: number; previous: number | null }) {
  const trend: Trend = previous === null ? 'primera' : score > previous ? 'mejoro' : score < previous ? 'empeoro' : 'neutral';
  return (
    <tr className="align-top border-t border-slate-200 dark:border-slate-800">
      <th scope="row" className="py-2 pr-2 text-left font-semibold">{label}</th>
      <td className="py-2 pr-2">
        <div role="radiogroup" aria-label={`${verb} (${label})`} className="flex gap-2">
          {[true, false].map(v => (
            <label key={String(v)} className="flex items-center gap-1"><input type="radio" checked={row.touched && row.on === v} onChange={() => set({ ...row, on: v, pos: v ? row.pos : null, touched: true })} />{v ? 'Sí' : 'No'}</label>
          ))}
        </div>
      </td>
      <td className="py-2 pr-2">
        <select aria-label={`Posición (${label})`} className={inputCls} disabled={!row.on} value={row.pos ?? ''} onChange={e => set({ ...row, pos: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>
          {POS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="py-2 pr-2 min-w-[16rem]">
        <textarea aria-label={`Respuesta (${label})`} rows={3} className={`${inputCls} w-full`} disabled={!row.on} placeholder={row.on ? 'Pega aquí la respuesta de la IA' : ''} value={row.on ? row.text : ''} onChange={e => set({ ...row, text: e.target.value })} />
      </td>
      <td className="py-2 pr-2 text-center">{row.touched ? <><span className="text-lg font-black tabular-nums">{score}</span><span className="block text-[10px] text-slate-500">puntos</span></> : <span className="text-slate-400">—</span>}</td>
      <td className="py-2 pr-2">{row.touched && (!row.on || row.pos) ? <TrendBadge t={trend} /> : <span className="text-slate-400">—</span>}{previous !== null && <span className="block text-[10px] text-slate-500 mt-0.5">antes {previous}</span>}</td>
      <td className="py-2 min-w-[12rem]"><textarea aria-label={`Comentarios (${label})`} rows={3} className={`${inputCls} w-full`} value={row.comment} onChange={e => set({ ...row, comment: e.target.value })} /></td>
    </tr>
  );
}

export function AiVisibilityView({ siteId, go }: { siteId: string; go: GoFn }) {
  const { can } = useAuth();
  const [tab, setTab] = useState<'matrix' | 'record' | 'prompts' | 'analysis'>('matrix');
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // check form
  const [promptId, setPromptId] = useState('');
  const [engine, setEngine] = useState<Engine>('chatgpt');
  const [date, setDate] = useState(today());
  const [direct, setDirect] = useState<Row>(EMPTY);
  const [cite, setCite] = useState<Row>(EMPTY);
  const [history, setHistory] = useState<Obs[]>([]);
  // new question
  const [newText, setNewText] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  // analysis
  const [analyses, setAnalyses] = useState<Array<{ id: string; text: string; model: string; createdAt: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([apiGet<Prompt[]>(`/api/v1/sites/${siteId}/ai-visibility/prompts`), apiGet<Matrix>(`/api/v1/sites/${siteId}/ai-visibility/matrix${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`)]);
      setPrompts(p);
      setMatrix(m);
      setPromptId(id => id || p.find(x => x.active)?.id || '');
    } catch (e) {
      setError(e);
    }
  }, [siteId, keyword]);
  useEffect(() => {
    load();
  }, [load]);

  // History of the selected question × engine; fills the form if that date already has a check.
  useEffect(() => {
    if (!promptId) return setHistory([]);
    apiGet<Obs[]>(`/api/v1/sites/${siteId}/ai-visibility/history?promptId=${promptId}&engine=${engine}`).then(setHistory).catch(setError);
  }, [siteId, promptId, engine]);
  useEffect(() => {
    const o = history.find(h => h.date === date);
    setDirect(o ? { on: o.mentioned, pos: o.mentionPos, text: o.mentionText ?? '', comment: o.mentionComment ?? '', touched: true } : EMPTY);
    setCite(o ? { on: o.cited, pos: o.citePos, text: o.citeText ?? '', comment: o.citeComment ?? '', touched: true } : EMPTY);
  }, [history, date]);
  const prev = useMemo(() => [...history].filter(h => h.date < date).pop() ?? null, [history, date]);

  useEffect(() => {
    if (tab === 'analysis' && !analyses) apiGet<typeof analyses>(`/api/v1/sites/${siteId}/ai-visibility/analyses`).then(setAnalyses).catch(setError);
  }, [tab, analyses, siteId]);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveCheck = () =>
    run(async () => {
      await apiSend('POST', `/api/v1/sites/${siteId}/ai-visibility/observations`, {
        promptId, engine, date,
        mentioned: direct.on, mentionPos: direct.on ? direct.pos : null, mentionText: direct.on ? direct.text : null, mentionComment: direct.comment || null,
        cited: cite.on, citePos: cite.on ? cite.pos : null, citeText: cite.on ? cite.text : null, citeComment: cite.comment || null
      });
      setHistory(await apiGet<Obs[]>(`/api/v1/sites/${siteId}/ai-visibility/history?promptId=${promptId}&engine=${engine}`));
      await load();
    }, 'Revisión guardada.');
  const addPrompt = () =>
    run(async () => {
      const p = await apiSend<Prompt>('POST', `/api/v1/sites/${siteId}/ai-visibility/prompts`, { text: newText, keyword: newKeyword });
      setNewText('');
      setPromptId(p.id);
      await load();
    }, 'Pregunta agregada.');

  if (!prompts || !matrix) return error ? <ErrorBox error={error} /> : <Skeleton rows={6} />;
  const canEdit = can('content:edit');
  const sel = prompts.find(p => p.id === promptId);
  const engines = Object.keys(ENGINES) as Engine[];
  const tabs = [['matrix', 'Matriz'], ['record', 'Registrar revisión'], ['prompts', `Preguntas (${prompts.length})`], ['analysis', 'Análisis']] as const;
  const weekX = (w: string) => +new Date(`${w}T12:00:00`);

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Mide si ChatGPT, Claude, Gemini y la IA de Google te <strong>mencionan</strong> (Directo) o te <strong>citan</strong> como fuente cuando alguien hace preguntas de cola larga.
          Escala: Directo 1.er lugar 5 · top 3 4 · más abajo 3. Citación 1.er lugar 3 · top 3 2 · más abajo 1. Máximo 8 puntos por revisión.
          Por ahora se registra a mano; la consulta automática se activará cuando conectes las claves de API en <button className="underline" onClick={() => go('settings')}>Configuración</button>.
        </p>
      </Card>

      <div role="tablist" aria-label="Secciones de visibilidad en IA" className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{label}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {msg && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}

      {tab === 'matrix' && (
        <>
          <Card
            title="Matriz por pregunta y motor"
            actions={
              <div className="flex gap-2">
                <select aria-label="Filtrar por keyword" className={inputCls} value={keyword} onChange={e => setKeyword(e.target.value)}>
                  <option value="">Todas las keywords</option>
                  {matrix.keywords.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <a href={`${API_URL}/api/v1/sites/${siteId}/ai-visibility/export.csv`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:bg-slate-800 dark:border-slate-700"><Download className="w-3.5 h-3.5" aria-hidden /> CSV</a>
              </div>
            }
          >
            {!matrix.rows.length ? (
              <Empty>Agrega tus preguntas en la pestaña "Preguntas" y registra la primera revisión.</Empty>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-500 text-left"><th className="py-2 pr-3">Pregunta</th><th className="pr-3">Keyword</th>{engines.map(e => <th key={e} className="text-center px-2">{ENGINES[e]}</th>)}</tr></thead>
                  <tbody>
                    {matrix.rows.map(r => (
                      <tr key={r.prompt.id} className={`border-t border-slate-100 dark:border-slate-800 ${r.prompt.active ? '' : 'opacity-50'}`}>
                        <td className="py-2 pr-3 max-w-md">{r.prompt.text}</td>
                        <td className="pr-3 text-slate-500">{r.prompt.keyword}</td>
                        {engines.map(e => {
                          const c = r.cells[e];
                          return (
                            <td key={e} className="px-2 text-center">
                              <button className="w-full rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" title={c ? `${c.checks} revisiones · última ${c.date}` : 'Sin revisar'} onClick={() => { setPromptId(r.prompt.id); setEngine(e); setDate(today()); setTab('record'); }}>
                                {c ? (
                                  <>
                                    <span className="block text-base font-black tabular-nums">{c.total}<span className="text-[10px] font-normal text-slate-500">/8</span></span>
                                    <span className="block text-[10px] text-slate-500">D{c.mentionScore} · C{c.citeScore}</span>
                                    <TrendBadge t={c.trend} />
                                  </>
                                ) : <span className="text-slate-400">—</span>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-500 mt-2">D = Directo (mención) · C = Citación. Haz clic en una celda para registrar una revisión o ver su historial.</p>
              </div>
            )}
          </Card>

          {matrix.insights.length > 0 && (
            <Card title="Qué cambió">
              <ul className="space-y-1.5 text-xs">
                {matrix.insights.map((i, k) => (
                  <li key={k} className="flex gap-2"><Badge tone={i.tone === 'bad' ? 'bad' : i.tone === 'good' ? 'good' : i.tone === 'warn' ? 'warn' : 'default'}>{i.tone === 'bad' ? 'Bajó' : i.tone === 'good' ? 'Subió' : i.tone === 'warn' ? 'Atención' : 'Nota'}</Badge><span>{i.text}</span></li>
                ))}
              </ul>
            </Card>
          )}

          {matrix.evolution.length > 0 && (
            <Card title="Evolución semanal (promedio de puntos por revisión, de 0 a 8)">
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                <TimeChart title="Todos los motores" series={[{ label: 'Promedio', points: matrix.evolution.map(w => ({ x: weekX(w.week), y: w.all })) }]} events={[]} />
                {engines.map(e => <TimeChart key={e} title={ENGINES[e]} series={[{ label: ENGINES[e], points: matrix.evolution.map(w => ({ x: weekX(w.week), y: w[e] ?? null })) }]} events={[]} />)}
              </div>
              {matrix.byKeyword.length > 0 && (
                <table className="w-full text-xs mt-5">
                  <thead><tr className="text-slate-500 text-left"><th className="py-1">Keyword</th><th className="text-right">Revisiones</th><th className="text-right">Promedio</th><th className="text-right">Mencionada</th><th className="text-right">Citada</th></tr></thead>
                  <tbody>{matrix.byKeyword.map(k => <tr key={k.keyword} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1">{k.keyword}</td><td className="text-right tabular-nums">{k.checks}</td><td className="text-right tabular-nums">{k.avgPoints}</td><td className="text-right tabular-nums">{k.mentionRate} %</td><td className="text-right tabular-nums">{k.citeRate} %</td></tr>)}</tbody>
                </table>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'record' && (
        <Card title="Registrar revisión">
          {!prompts.length ? <Empty>Primero agrega una pregunta en la pestaña "Preguntas".</Empty> : (
            <div className="space-y-4 text-xs">
              <div className="grid md:grid-cols-[2fr_1fr_1fr_1fr] gap-3">
                <label className="space-y-1"><span className="block font-semibold">Palabra compuesta o pregunta completa</span>
                  <select aria-label="Pregunta" className={`${inputCls} w-full`} value={promptId} onChange={e => setPromptId(e.target.value)}>
                    {prompts.map(p => <option key={p.id} value={p.id}>{p.text}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><span className="block font-semibold">Keyword</span><input aria-label="Keyword" className={`${inputCls} w-full`} readOnly value={sel?.keyword ?? ''} /></label>
                <label className="space-y-1"><span className="block font-semibold">Motor</span>
                  <select aria-label="Motor de IA" className={`${inputCls} w-full`} value={engine} onChange={e => setEngine(e.target.value as Engine)}>
                    {engines.map(e => <option key={e} value={e}>{ENGINES[e]}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><span className="block font-semibold">Fecha del análisis</span><input type="date" aria-label="Fecha" className={`${inputCls} w-full`} value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
              </div>
              <div className="overflow-auto">
                <table className="w-full">
                  <thead><tr className="text-slate-500 text-left"><th className="py-1 pr-2" /><th className="pr-2">Aparece / Cita</th><th className="pr-2">Posición</th><th className="pr-2">Respuesta</th><th className="pr-2 text-center">Resultado</th><th className="pr-2">Tendencia</th><th>Comentarios</th></tr></thead>
                  <tbody>
                    <CheckRow label="Directo" verb="Aparece" row={direct} set={setDirect} score={mScore(direct.on, direct.pos)} previous={prev ? prev.mentionScore : null} />
                    <CheckRow label="Citación" verb="Cita" row={cite} set={setCite} score={cScore(cite.on, cite.pos)} previous={prev ? prev.citeScore : null} />
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3">
                <Button disabled={!canEdit || busy || !promptId || !direct.touched || !cite.touched || (direct.on && !direct.pos) || (cite.on && !cite.pos)} onClick={saveCheck}>{history.some(h => h.date === date) ? 'Actualizar revisión' : 'Guardar revisión'}</Button>
                {(!direct.touched || !cite.touched) && <span className="text-amber-700 dark:text-amber-400">Contesta Sí o No en las dos filas.</span>}
                <span className="text-slate-500">Total: <strong>{mScore(direct.on, direct.pos) + cScore(cite.on, cite.pos)}</strong> de 8 · comparado con {prev ? `la revisión del ${prev.date}` : 'nada (primera revisión)'}</span>
              </div>
              {history.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Historial de esta pregunta en {ENGINES[engine]}</h4>
                  <div className="overflow-auto max-h-80">
                    <table className="w-full">
                      <thead><tr className="text-slate-500 text-left"><th className="py-1">Fecha</th><th>Fila</th><th>Sí/No</th><th>Posición</th><th>Resultado</th><th>Tendencia</th><th>Comentarios</th><th /></tr></thead>
                      <tbody>
                        {history.slice().reverse().map(h => (
                          <React.Fragment key={h.id}>
                            <tr className="border-t border-slate-200 dark:border-slate-800">
                              <td className="py-1" rowSpan={2}><button className="underline" onClick={() => setDate(h.date)}>{h.date}</button></td>
                              <td>Directo</td><td>{h.mentioned ? 'Sí' : 'No'}</td><td>{POS.find(p => p[0] === h.mentionPos)?.[1] ?? '—'}</td><td className="tabular-nums">{h.mentionScore}</td><td><TrendBadge t={h.mentionTrend} /></td><td className="max-w-xs truncate" title={h.mentionComment ?? ''}>{h.mentionComment}</td>
                              <td rowSpan={2}>{canEdit && <button aria-label={`Borrar revisión del ${h.date}`} className="p-1 text-slate-400 hover:text-rose-600" onClick={() => confirm(`¿Borrar la revisión del ${h.date}?`) && run(async () => { await apiSend('DELETE', `/api/v1/ai-observations/${h.id}`); setHistory(await apiGet<Obs[]>(`/api/v1/sites/${siteId}/ai-visibility/history?promptId=${promptId}&engine=${engine}`)); await load(); })}><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                            </tr>
                            <tr><td>Citación</td><td>{h.cited ? 'Sí' : 'No'}</td><td>{POS.find(p => p[0] === h.citePos)?.[1] ?? '—'}</td><td className="tabular-nums">{h.citeScore}</td><td><TrendBadge t={h.citeTrend} /></td><td className="max-w-xs truncate" title={h.citeComment ?? ''}>{h.citeComment}</td></tr>
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {tab === 'prompts' && (
        <Card title="Preguntas a medir">
          <div className="text-xs space-y-3">
            {canEdit && (
              <div className="grid md:grid-cols-[2fr_1fr_auto] gap-2 items-end">
                <label className="space-y-1"><span className="block font-semibold">Palabra compuesta o pregunta completa</span><input aria-label="Nueva pregunta" className={`${inputCls} w-full`} placeholder="¿Cuál es la mejor universidad en línea de México?" value={newText} onChange={e => setNewText(e.target.value)} /></label>
                <label className="space-y-1"><span className="block font-semibold">Keyword (grupo)</span><input aria-label="Keyword de la nueva pregunta" list="ai-keywords" className={`${inputCls} w-full`} placeholder="Políticas Públicas" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} /><datalist id="ai-keywords">{matrix.keywords.map(k => <option key={k} value={k} />)}</datalist></label>
                <Button disabled={busy || newText.trim().length < 3 || !newKeyword.trim()} onClick={addPrompt}><Plus className="w-3.5 h-3.5" aria-hidden /> Agregar</Button>
              </div>
            )}
            {!prompts.length ? <Empty>Sin preguntas todavía.</Empty> : (
              <table className="w-full">
                <thead><tr className="text-slate-500 text-left"><th className="py-1">Pregunta</th><th>Keyword</th><th className="text-right">Revisiones</th><th className="text-center">Activa</th><th /></tr></thead>
                <tbody>
                  {prompts.map(p => (
                    <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-2">{p.text}</td>
                      <td className="pr-2 text-slate-500">{p.keyword}</td>
                      <td className="text-right tabular-nums pr-2">{p._count?.observations ?? 0}</td>
                      <td className="text-center"><input type="checkbox" aria-label={`Activa: ${p.text}`} disabled={!canEdit} checked={p.active} onChange={e => run(async () => { await apiSend('PATCH', `/api/v1/ai-prompts/${p.id}`, { active: e.target.checked }); await load(); })} /></td>
                      <td className="text-right">{canEdit && <button aria-label={`Borrar pregunta: ${p.text}`} className="p-1 text-slate-400 hover:text-rose-600" onClick={() => confirm(`¿Borrar "${p.text}" y todas sus revisiones?`) && run(async () => { await apiSend('DELETE', `/api/v1/ai-prompts/${p.id}`); await load(); })}><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-slate-500">Desmarca "Activa" para dejar de medir una pregunta sin perder su historial.</p>
          </div>
        </Card>
      )}

      {tab === 'analysis' && (
        <Card title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4" aria-hidden /> Análisis con IA</span>}>
          <div className="text-xs space-y-3">
            <p className="text-slate-600 dark:text-slate-300">Claude lee la matriz, la evolución por semana y extractos de las respuestas que pegaste, y escribe qué subió, qué bajó, qué competidores aparecen y qué acciones tomar. Cada análisis consume crédito de tu clave de Anthropic (unos centavos de dólar).</p>
            <div className="flex items-center gap-3">
              <Button disabled={busy || !can('seo:operate')} onClick={() => run(async () => { const a = await apiSend<{ id: string; text: string; model: string; createdAt: string }>('POST', `/api/v1/sites/${siteId}/ai-visibility/analyses`, {}); setAnalyses(x => [a, ...(x ?? [])]); }, 'Análisis listo.')}><Sparkles className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Analizando…' : 'Analizar con IA'}</Button>
              <button className="text-indigo-600 dark:text-indigo-400 underline inline-flex items-center gap-1" onClick={() => go('settings')}>Configurar claves <ArrowRight className="w-3 h-3" aria-hidden /></button>
            </div>
            {!analyses ? <Skeleton rows={3} /> : !analyses.length ? <Empty>Todavía no hay análisis.</Empty> : analyses.map(a => (
              <article key={a.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="text-[11px] text-slate-500 mb-2">{fmtDate(a.createdAt)} · {a.model}</p>
                <div className="whitespace-pre-wrap leading-relaxed">{a.text}</div>
              </article>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
