import { decryptSecret, encryptSecret } from '@glitch/core';
import { AI_PROVIDERS, AiError, AiProvider, analyzeWithClaude } from '@glitch/connectors';
import { prisma } from './client';
import { recordAuditEvent, currentActorId } from './audit';
import { WorkflowError } from './errors';

/**
 * "Visibilidad en IA": how often AI answers (ChatGPT, Claude, Gemini, Google AI) mention or cite the brand
 * for long-tail questions. Each check has two rows, scored with the team's scale:
 *   Directo (brand mentioned):  1st place 5 · top 3 4 · lower 3 · not mentioned 0
 *   Citación (site cited):      1st place 3 · top 3 2 · lower 1 · not cited 0
 */

export const AI_ENGINES = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_ai: 'Google (IA)' } as const;
export type AiEngine = keyof typeof AI_ENGINES;
export type Pos = 1 | 3 | 4;
export type Trend = 'mejoro' | 'neutral' | 'empeoro' | 'primera';

export const mentionScore = (on: boolean, pos: number | null | undefined) => (!on ? 0 : pos === 1 ? 5 : pos === 3 ? 4 : 3);
export const citeScore = (on: boolean, pos: number | null | undefined) => (!on ? 0 : pos === 1 ? 3 : pos === 3 ? 2 : 1);
const trendOf = (now: number, before: number | null): Trend => (before === null ? 'primera' : now > before ? 'mejoro' : now < before ? 'empeoro' : 'neutral');
const isEngine = (e: string): e is AiEngine => e in AI_ENGINES;

// ---------------------------------------------------------------- questions

export async function listAiPrompts(siteId: string) {
  return prisma.aiPrompt.findMany({ where: { siteId }, orderBy: [{ keyword: 'asc' }, { text: 'asc' }], include: { _count: { select: { observations: true } } } });
}

export async function createAiPrompt(siteId: string, input: { text: string; keyword: string }) {
  const text = input.text.trim();
  const keyword = input.keyword.trim();
  if (!text || !keyword) throw new WorkflowError('REQUIRED', 'Escribe la pregunta y su keyword.', 400);
  const dup = await prisma.aiPrompt.findFirst({ where: { siteId, text } });
  if (dup) throw new WorkflowError('DUPLICATE_PROMPT', 'Esa pregunta ya está en la lista.', 409);
  return prisma.aiPrompt.create({ data: { siteId, text, keyword } });
}

export async function updateAiPrompt(id: string, input: { text?: string; keyword?: string; active?: boolean }) {
  return prisma.aiPrompt.update({ where: { id }, data: { ...(input.text !== undefined ? { text: input.text.trim() } : {}), ...(input.keyword !== undefined ? { keyword: input.keyword.trim() } : {}), ...(input.active !== undefined ? { active: input.active } : {}) } });
}

export async function deleteAiPrompt(id: string) {
  const p = await prisma.aiPrompt.delete({ where: { id }, include: { site: true } });
  await recordAuditEvent({ workspaceId: p.site.workspaceId, userId: null, action: 'ai_prompt.deleted', entity: 'AiPrompt', entityId: id, details: { text: p.text } });
  return { deleted: true };
}

// ---------------------------------------------------------------- checks

export interface ObservationInput {
  promptId: string;
  engine: string;
  date: string;
  mentioned: boolean;
  mentionPos?: number | null;
  mentionText?: string | null;
  mentionComment?: string | null;
  cited: boolean;
  citePos?: number | null;
  citeText?: string | null;
  citeComment?: string | null;
}

const posOrNull = (on: boolean, p: number | null | undefined) => {
  if (!on) return null;
  if (p !== 1 && p !== 3 && p !== 4) throw new WorkflowError('POSITION_REQUIRED', 'Elige la posición: 1, top 3 o 4+.', 400);
  return p;
};

/** Saves (or replaces) the check of one question in one engine on one date. */
export async function saveAiObservation(siteId: string, input: ObservationInput) {
  if (!isEngine(input.engine)) throw new WorkflowError('UNKNOWN_ENGINE', 'Motor de IA desconocido.', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new WorkflowError('INVALID_DATE', 'Fecha inválida.', 400);
  const prompt = await prisma.aiPrompt.findFirst({ where: { id: input.promptId, siteId } });
  if (!prompt) throw new WorkflowError('PROMPT_NOT_FOUND', 'La pregunta no existe en este sitio.', 404);
  const data = {
    mentioned: input.mentioned,
    mentionPos: posOrNull(input.mentioned, input.mentionPos),
    mentionText: input.mentioned ? input.mentionText?.slice(0, 20_000) || null : null,
    mentionComment: input.mentionComment?.slice(0, 2000) || null,
    cited: input.cited,
    citePos: posOrNull(input.cited, input.citePos),
    citeText: input.cited ? input.citeText?.slice(0, 20_000) || null : null,
    citeComment: input.citeComment?.slice(0, 2000) || null
  };
  return prisma.aiObservation.upsert({
    where: { promptId_engine_date: { promptId: input.promptId, engine: input.engine, date: input.date } },
    create: { siteId, promptId: input.promptId, engine: input.engine, date: input.date, createdById: currentActorId(), ...data },
    update: data
  });
}

export async function deleteAiObservation(id: string) {
  await prisma.aiObservation.delete({ where: { id } });
  return { deleted: true };
}

type Obs = Awaited<ReturnType<typeof prisma.aiObservation.findMany>>[number];
const scored = (o: Obs, prev: Obs | null) => {
  const m = mentionScore(o.mentioned, o.mentionPos);
  const c = citeScore(o.cited, o.citePos);
  const pm = prev ? mentionScore(prev.mentioned, prev.mentionPos) : null;
  const pc = prev ? citeScore(prev.cited, prev.citePos) : null;
  return { ...o, mentionScore: m, citeScore: c, total: m + c, mentionTrend: trendOf(m, pm), citeTrend: trendOf(c, pc), totalTrend: trendOf(m + c, pm === null ? null : pm + (pc ?? 0)) };
};
export type ScoredObservation = ReturnType<typeof scored>;

/** All checks of one question in one engine, oldest first, with scores and trend against the previous check. */
export async function aiHistory(siteId: string, promptId: string, engine: string) {
  const rows = await prisma.aiObservation.findMany({ where: { siteId, promptId, engine }, orderBy: { date: 'asc' } });
  return rows.map((o, i) => scored(o, i ? rows[i - 1] : null));
}

// ---------------------------------------------------------------- matrix, evolution, rules

const weekStart = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - dow * 86400_000).toISOString().slice(0, 10);
};

export async function aiMatrix(siteId: string, filter: { keyword?: string } = {}) {
  const prompts = await prisma.aiPrompt.findMany({ where: { siteId, ...(filter.keyword ? { keyword: filter.keyword } : {}) }, orderBy: [{ keyword: 'asc' }, { text: 'asc' }] });
  const obs = await prisma.aiObservation.findMany({ where: { siteId, promptId: { in: prompts.map(p => p.id) } }, orderBy: { date: 'asc' } });
  const byKey = new Map<string, Obs[]>();
  for (const o of obs) {
    const k = `${o.promptId}|${o.engine}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(o);
  }
  const engines = Object.keys(AI_ENGINES) as AiEngine[];
  const rows = prompts.map(p => ({
    prompt: { id: p.id, text: p.text, keyword: p.keyword, active: p.active },
    cells: Object.fromEntries(
      engines.map(e => {
        const list = byKey.get(`${p.id}|${e}`) ?? [];
        if (!list.length) return [e, null];
        const last = scored(list[list.length - 1], list.length > 1 ? list[list.length - 2] : null);
        return [e, { date: last.date, mentionScore: last.mentionScore, citeScore: last.citeScore, total: last.total, trend: last.totalTrend, checks: list.length, observationId: last.id }];
      })
    ) as Record<AiEngine, null | { date: string; mentionScore: number; citeScore: number; total: number; trend: Trend; checks: number; observationId: string }>
  }));

  // Evolution: average points per checked question, per week and engine (so adding questions does not inflate it).
  const weeks = new Map<string, Map<string, number[]>>();
  for (const o of obs) {
    const w = weekStart(o.date);
    if (!weeks.has(w)) weeks.set(w, new Map());
    const m = weeks.get(w)!;
    if (!m.has(o.engine)) m.set(o.engine, []);
    m.get(o.engine)!.push(mentionScore(o.mentioned, o.mentionPos) + citeScore(o.cited, o.citePos));
  }
  const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
  const evolution = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, m]) => ({ week, all: avg([...m.values()].flat()), ...Object.fromEntries([...m.entries()].map(([e, xs]) => [e, avg(xs)])) as Partial<Record<AiEngine, number>> }));

  const byKeyword = new Map<string, { checks: number; points: number; mentioned: number; cited: number }>();
  for (const o of obs) {
    const kw = prompts.find(p => p.id === o.promptId)!.keyword;
    const a = byKeyword.get(kw) ?? { checks: 0, points: 0, mentioned: 0, cited: 0 };
    a.checks++;
    a.points += mentionScore(o.mentioned, o.mentionPos) + citeScore(o.cited, o.citePos);
    if (o.mentioned) a.mentioned++;
    if (o.cited) a.cited++;
    byKeyword.set(kw, a);
  }

  // Rules: what moved between the last two checks of each question × engine.
  const insights: Array<{ tone: 'bad' | 'good' | 'warn' | 'info'; text: string }> = [];
  for (const r of rows) {
    for (const e of engines) {
      const list = byKey.get(`${r.prompt.id}|${e}`) ?? [];
      if (list.length < 2) continue;
      const a = scored(list[list.length - 1], list[list.length - 2]);
      const b = list[list.length - 2];
      const before = mentionScore(b.mentioned, b.mentionPos) + citeScore(b.cited, b.citePos);
      if (a.total - before <= -3) insights.push({ tone: 'bad', text: `"${r.prompt.text}" en ${AI_ENGINES[e]}: bajó de ${before} a ${a.total} puntos (${b.date} → ${a.date}).${b.mentioned && !a.mentioned ? ' Dejó de mencionarte.' : ''}${b.cited && !a.cited ? ' Dejó de citarte.' : ''}` });
      else if (a.total - before >= 3) insights.push({ tone: 'good', text: `"${r.prompt.text}" en ${AI_ENGINES[e]}: subió de ${before} a ${a.total} puntos (${b.date} → ${a.date}).` });
    }
  }
  for (const e of engines) {
    const all = obs.filter(o => o.engine === e);
    if (all.length >= 3 && !all.some(o => o.mentioned || o.cited)) insights.push({ tone: 'warn', text: `${AI_ENGINES[e]} no te ha mencionado ni citado en ${all.length} revisiones.` });
  }
  const notChecked = prompts.filter(p => p.active && !obs.some(o => o.promptId === p.id));
  if (notChecked.length) insights.push({ tone: 'info', text: `${notChecked.length} ${notChecked.length === 1 ? 'pregunta activa no tiene' : 'preguntas activas no tienen'} ninguna revisión todavía.` });
  const rank = { bad: 0, warn: 1, good: 2, info: 3 } as const;
  insights.sort((x, y) => rank[x.tone] - rank[y.tone]);

  return {
    engines: AI_ENGINES,
    keywords: [...new Set((await prisma.aiPrompt.findMany({ where: { siteId }, select: { keyword: true } })).map(p => p.keyword))].sort(),
    rows,
    evolution,
    byKeyword: [...byKeyword.entries()].map(([keyword, a]) => ({ keyword, checks: a.checks, avgPoints: Math.round((a.points / a.checks) * 100) / 100, mentionRate: Math.round((a.mentioned / a.checks) * 100), citeRate: Math.round((a.cited / a.checks) * 100) })),
    insights
  };
}

export async function aiCsv(siteId: string) {
  const rows = await prisma.aiObservation.findMany({ where: { siteId }, include: { prompt: true }, orderBy: [{ date: 'asc' }] });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.promptId}|${r.engine}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const label: Record<Trend, string> = { mejoro: 'Mejoró', neutral: 'Neutral', empeoro: 'Empeoró', primera: 'Primera' };
  const pos = (p: number | null) => (p === 1 ? '1' : p === 3 ? 'Top 3' : p === 4 ? '4+' : '');
  const out = [['Pregunta', 'Keyword', 'Motor', 'Fecha', 'Fila', 'Aparece', 'Posición', 'Respuesta', 'Resultado', 'Tendencia', 'Comentarios'].join(',')];
  for (const list of groups.values()) {
    list.forEach((o, i) => {
      const s = scored(o, i ? list[i - 1] : null);
      const base = [o.prompt.text, o.prompt.keyword, AI_ENGINES[o.engine as AiEngine] ?? o.engine, o.date];
      out.push([...base, 'Directo', o.mentioned ? 'Sí' : 'No', pos(o.mentionPos), o.mentionText, s.mentionScore, label[s.mentionTrend], o.mentionComment].map(esc).join(','));
      out.push([...base, 'Citación', o.cited ? 'Sí' : 'No', pos(o.citePos), o.citeText, s.citeScore, label[s.citeTrend], o.citeComment].map(esc).join(','));
    });
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- AI analysis

export async function listAiAnalyses(siteId: string) {
  return prisma.aiAnalysis.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, take: 10 });
}

/** Sends the matrix (and excerpts of the pasted answers) to Claude for a written analysis. */
export async function runAiAnalysis(siteId: string, actorUserId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const key = await prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId: site.workspaceId, provider: 'anthropic' } } });
  if (!key) throw new WorkflowError('AI_KEY_MISSING', 'Agrega una clave de Anthropic en Configuración → Claves de API para usar el análisis con IA.', 400);
  const m = await aiMatrix(siteId);
  if (!m.rows.some(r => Object.values(r.cells).some(Boolean))) throw new WorkflowError('NO_DATA', 'Registra al menos una revisión antes de pedir el análisis.', 400);
  const recent = await prisma.aiObservation.findMany({ where: { siteId }, include: { prompt: true }, orderBy: { date: 'desc' }, take: 40 });
  const lines = [
    `Sitio: ${site.name} (${site.canonicalUrl})`,
    'Escala: Directo (mención de la marca) 1.º lugar 5, top 3 4, más abajo 3, no aparece 0. Citación (el sitio aparece como fuente) 1.º 3, top 3 2, más abajo 1, no citado 0. Máximo 8 por revisión.',
    '',
    'Matriz (última revisión por pregunta y motor; total = directo + citación; tendencia contra la revisión anterior):',
    ...m.rows.map(r => `- [${r.prompt.keyword}] "${r.prompt.text}": ${Object.entries(r.cells).map(([e, c]) => `${AI_ENGINES[e as AiEngine]} ${c ? `${c.total} (D${c.mentionScore}/C${c.citeScore}, ${c.trend}, ${c.date})` : 'sin revisar'}`).join(' · ')}`),
    '',
    'Promedio semanal de puntos por revisión:',
    ...m.evolution.map(w => `- semana del ${w.week}: total ${w.all}${(Object.keys(AI_ENGINES) as AiEngine[]).map(e => (w[e] !== undefined ? `, ${AI_ENGINES[e]} ${w[e]}` : '')).join('')}`),
    '',
    'Por keyword:',
    ...m.byKeyword.map(k => `- ${k.keyword}: ${k.checks} revisiones, promedio ${k.avgPoints}, mencionada ${k.mentionRate} %, citada ${k.citeRate} %`),
    '',
    'Extractos de respuestas pegadas (más recientes primero; pueden estar incompletos):',
    ...recent.flatMap(o => [o.mentionText ? `- ${o.date} ${AI_ENGINES[o.engine as AiEngine]} "${o.prompt.text}" (directo): ${o.mentionText.slice(0, 600).replace(/\s+/g, ' ')}` : null, o.citeText ? `- ${o.date} ${AI_ENGINES[o.engine as AiEngine]} "${o.prompt.text}" (citación): ${o.citeText.slice(0, 400).replace(/\s+/g, ' ')}` : null].filter(Boolean) as string[])
  ];
  const system =
    'Eres analista de visibilidad de marca en respuestas de IA (GEO). Escribe en español de México, claro y directo, para un equipo de marketing. ' +
    'Con los datos que recibes: 1) resume en 2-3 frases cómo va la visibilidad; 2) lista qué subió y qué bajó, con preguntas y motores concretos; ' +
    '3) si los extractos lo permiten, di qué competidores o fuentes aparecen en lugar de la marca; 4) propone 3-5 acciones concretas de contenido o SEO. ' +
    'No inventes datos que no estén en el material; si algo no se puede saber con estos datos, dilo. Usa títulos cortos y viñetas.';
  try {
    const r = await analyzeWithClaude(decryptSecret(key.keyEnc), system, lines.join('\n'));
    const saved = await prisma.aiAnalysis.create({ data: { siteId, provider: 'anthropic', model: r.model, text: r.text, createdById: actorUserId } });
    await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId, action: 'ai_analysis.created', entity: 'AiAnalysis', entityId: saved.id, details: { model: r.model } });
    return saved;
  } catch (e) {
    if (e instanceof AiError) throw new WorkflowError(`AI_${e.code}`, e.message, e.code === 'AUTH' ? 400 : e.code === 'RATE_LIMIT' ? 429 : 502);
    throw e;
  }
}

// ---------------------------------------------------------------- API keys (Admins)

export async function listAiKeys(workspaceId: string) {
  const keys = await prisma.aiProviderKey.findMany({ where: { workspaceId } });
  return (Object.keys(AI_PROVIDERS) as AiProvider[]).map(p => {
    const k = keys.find(x => x.provider === p);
    return { provider: p, label: AI_PROVIDERS[p].label, usedFor: AI_PROVIDERS[p].usedFor, configured: !!k, hint: k ? `…${k.keyHint}` : null, updatedAt: k?.updatedAt ?? null };
  });
}

export async function setAiKey(workspaceId: string, provider: string, key: string, actorUserId: string | null) {
  if (!(provider in AI_PROVIDERS)) throw new WorkflowError('UNKNOWN_PROVIDER', 'Proveedor desconocido.', 400);
  const k = key.trim();
  if (k.length < 20 || /\s/.test(k)) throw new WorkflowError('INVALID_KEY', 'La clave parece incompleta. Pégala completa, sin espacios.', 400);
  const prefix = AI_PROVIDERS[provider as AiProvider].keyPrefix;
  if (prefix && !k.startsWith(prefix)) throw new WorkflowError('INVALID_KEY', `Las claves de ${AI_PROVIDERS[provider as AiProvider].label} empiezan con "${prefix}".`, 400);
  await prisma.aiProviderKey.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    create: { workspaceId, provider, keyEnc: encryptSecret(k), keyHint: k.slice(-4), updatedById: actorUserId },
    update: { keyEnc: encryptSecret(k), keyHint: k.slice(-4), updatedById: actorUserId }
  });
  await recordAuditEvent({ workspaceId, userId: actorUserId, action: 'ai_key.set', entity: 'AiProviderKey', entityId: provider, details: { provider, hint: k.slice(-4) } });
  return listAiKeys(workspaceId);
}

export async function deleteAiKey(workspaceId: string, provider: string, actorUserId: string | null) {
  await prisma.aiProviderKey.deleteMany({ where: { workspaceId, provider } });
  await recordAuditEvent({ workspaceId, userId: actorUserId, action: 'ai_key.deleted', entity: 'AiProviderKey', entityId: provider, details: { provider } });
  return listAiKeys(workspaceId);
}
