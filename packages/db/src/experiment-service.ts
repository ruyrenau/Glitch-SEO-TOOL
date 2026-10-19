import { Prisma } from '@prisma/client';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { WorkflowError } from './errors';
import { gscClientFor, wrapGscError } from './gsc-service';

/**
 * SEO experiments: "on day X I changed these pages". Compares Search Console clicks and
 * impressions of the changed pages before and after the change against a control group
 * (by default the rest of the site), so seasonality and Google updates cancel out.
 */

const json = (v: unknown) => v as Prisma.InputJsonValue;
const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);

export interface DayRow {
  date: string;
  clicks: number;
  impressions: number;
  /** Impression-weighted position sum (position × impressions). */
  posImpr: number;
}

export interface PeriodStats {
  days: number;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export type Verdict = 'positive' | 'negative' | 'inconclusive' | 'waiting' | 'low_data';

export interface ExperimentAnalysis {
  before: { from: string; to: string };
  after: { from: string; to: string };
  daysAfter: number;
  test: { before: PeriodStats; after: PeriodStats };
  control: { before: PeriodStats; after: PeriodStats; kind: 'site' | 'pages' };
  /** Relative change of test vs control (difference in differences on ratios). */
  effect: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  /** Two-sided p-value of the daily test share of clicks before vs after (Welch). */
  pValue: number | null;
  verdict: Verdict;
  /** 7-day rolling clicks, indexed so the before-period average = 100. */
  series: Array<{ date: string; test: number | null; control: number | null }>;
  pagesWithData: number;
}

function stats(rows: DayRow[]): PeriodStats {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const posImpr = rows.reduce((s, r) => s + r.posImpr, 0);
  return { days: rows.length, clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? posImpr / impressions : null };
}

const ratio = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b - 1);
/** (1 + test change) / (1 + control change) − 1. */
const did = (tb: number | null, ta: number | null, cb: number | null, ca: number | null) => {
  const t = ratio(ta, tb);
  const c = ratio(ca, cb);
  return t === null || c === null || c === -1 ? null : (1 + t) / (1 + c) - 1;
};

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function welchP(a: number[], b: number[]): number | null {
  if (a.length < 5 || b.length < 5) return null;
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const v = (x: number[], m: number) => x.reduce((s, y) => s + (y - m) ** 2, 0) / (x.length - 1);
  const ma = mean(a);
  const mb = mean(b);
  const se = Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length);
  if (!se) return ma === mb ? 1 : 0;
  return 2 * (1 - phi(Math.abs(ma - mb) / se));
}

/** Pure analysis over daily rows; `today` is the last day with final Search Console data. */
export function analyzeExperiment(input: { changeDate: string; windowDays: number; lastDataDate: string; test: DayRow[]; control: DayRow[]; controlKind: 'site' | 'pages'; pagesWithData: number }): ExperimentAnalysis {
  const change = parse(input.changeDate);
  const N = input.windowDays;
  const before = { from: iso(change - N * DAY), to: iso(change - DAY) };
  const lastAfter = Math.min(change + N * DAY, parse(input.lastDataDate));
  const after = { from: iso(change + DAY), to: iso(Math.max(lastAfter, change)) };
  const daysAfter = Math.max(0, Math.round((lastAfter - change) / DAY));

  // Fill every day so missing days count as zero clicks.
  const fill = (rows: DayRow[], from: string, to: string) => {
    const m = new Map(rows.map(r => [r.date, r]));
    const out: DayRow[] = [];
    for (let t = parse(from); t <= parse(to); t += DAY) out.push(m.get(iso(t)) ?? { date: iso(t), clicks: 0, impressions: 0, posImpr: 0 });
    return out;
  };
  const tB = fill(input.test, before.from, before.to);
  const cB = fill(input.control, before.from, before.to);
  const tA = daysAfter ? fill(input.test, after.from, after.to) : [];
  const cA = daysAfter ? fill(input.control, after.from, after.to) : [];
  const test = { before: stats(tB), after: stats(tA) };
  const control = { before: stats(cB), after: stats(cA), kind: input.controlKind };

  // Normalise per day so a shorter after-period compares fairly.
  const perDay = (s: PeriodStats, k: 'clicks' | 'impressions') => (s.days ? s[k] / s.days : null);
  const effect = {
    clicks: did(perDay(test.before, 'clicks'), perDay(test.after, 'clicks'), perDay(control.before, 'clicks'), perDay(control.after, 'clicks')),
    impressions: did(perDay(test.before, 'impressions'), perDay(test.after, 'impressions'), perDay(control.before, 'impressions'), perDay(control.after, 'impressions')),
    ctr: did(test.before.ctr, test.after.ctr, control.before.ctr, control.after.ctr),
    position: test.before.position !== null && test.after.position !== null && control.before.position !== null && control.after.position !== null ? test.after.position - test.before.position - (control.after.position - control.before.position) : null
  };

  const share = (t: DayRow[], c: DayRow[]) => t.map((r, i) => (r.clicks + c[i].clicks ? r.clicks / (r.clicks + c[i].clicks) : null)).filter((x): x is number => x !== null);
  const pValue = daysAfter >= 7 ? welchP(share(tB, cB), share(tA, cA)) : null;
  const verdict: Verdict =
    daysAfter < 7 ? 'waiting' : test.before.clicks < 30 && test.after.clicks < 30 ? 'low_data' : pValue !== null && pValue < 0.05 && effect.clicks !== null ? (effect.clicks > 0 ? 'positive' : 'negative') : 'inconclusive';

  // Chart: 7-day rolling clicks, indexed to the before-period average.
  const all = { t: fill(input.test, before.from, daysAfter ? after.to : before.to), c: fill(input.control, before.from, daysAfter ? after.to : before.to) };
  const baseT = perDay(test.before, 'clicks');
  const baseC = perDay(control.before, 'clicks');
  const roll = (rows: DayRow[], i: number) => {
    const w = rows.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((s, r) => s + r.clicks, 0) / w.length;
  };
  const series = all.t.map((r, i) => ({
    date: r.date,
    test: baseT ? Math.round((roll(all.t, i) / baseT) * 1000) / 10 : null,
    control: baseC ? Math.round((roll(all.c, i) / baseC) * 1000) / 10 : null
  }));
  return { before, after, daysAfter, test, control, effect, pValue, verdict, series, pagesWithData: input.pagesWithData };
}

// ---------------------------------------------------------------------------

export interface ExperimentInput {
  name: string;
  hypothesis?: string | null;
  changeDate: string;
  testUrls: string[];
  controlUrls?: string[];
  windowDays?: number;
}

function validate(site: { canonicalUrl: string }, b: ExperimentInput) {
  const host = new URL(site.canonicalUrl).hostname.replace(/^www\./, '');
  const foreign = [...b.testUrls, ...(b.controlUrls ?? [])].filter(u => new URL(u).hostname.replace(/^www\./, '') !== host);
  if (foreign.length) throw new WorkflowError('FOREIGN_URL', `Solo URLs de ${host}.`, 400, { foreign });
  const overlap = (b.controlUrls ?? []).filter(u => b.testUrls.includes(u));
  if (overlap.length) throw new WorkflowError('OVERLAP', 'Una URL no puede estar en el grupo de prueba y en el de control a la vez.', 400, { overlap });
  if (parse(b.changeDate) > Date.now()) throw new WorkflowError('FUTURE_DATE', 'La fecha del cambio no puede ser futura.', 400);
}

export async function listExperiments(siteId: string) {
  return prisma.seoExperiment.findMany({ where: { siteId }, orderBy: { changeDate: 'desc' }, include: { createdBy: { select: { name: true, email: true } } } });
}

export async function createExperiment(siteId: string, b: ExperimentInput, userId: string | null) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  validate(site, b);
  const e = await prisma.seoExperiment.create({
    data: { siteId, name: b.name, hypothesis: b.hypothesis ?? null, changeDate: b.changeDate, testUrls: json([...new Set(b.testUrls)]), controlUrls: json([...new Set(b.controlUrls ?? [])]), windowDays: b.windowDays ?? 28, createdById: userId }
  });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId, action: 'experiment.created', entity: 'SeoExperiment', entityId: e.id, details: { name: b.name, pages: b.testUrls.length } });
  return e;
}

export async function updateExperiment(id: string, b: Partial<ExperimentInput> & { notes?: string | null }, userId: string | null) {
  const e = await prisma.seoExperiment.findUniqueOrThrow({ where: { id }, include: { site: true } });
  const merged = { name: b.name ?? e.name, changeDate: b.changeDate ?? e.changeDate, testUrls: b.testUrls ?? (e.testUrls as string[]), controlUrls: b.controlUrls ?? (e.controlUrls as string[]) };
  validate(e.site, merged);
  const changesData = b.changeDate !== undefined || b.testUrls !== undefined || b.controlUrls !== undefined || b.windowDays !== undefined;
  const updated = await prisma.seoExperiment.update({
    where: { id },
    data: {
      name: merged.name,
      hypothesis: b.hypothesis === undefined ? undefined : b.hypothesis,
      notes: b.notes === undefined ? undefined : b.notes,
      changeDate: merged.changeDate,
      testUrls: json([...new Set(merged.testUrls)]),
      controlUrls: json([...new Set(merged.controlUrls)]),
      windowDays: b.windowDays ?? undefined,
      // The stored analysis no longer matches the experiment.
      ...(changesData ? { analysis: Prisma.DbNull, analyzedAt: null } : {})
    }
  });
  await recordAuditEvent({ workspaceId: e.site.workspaceId, userId, action: 'experiment.updated', entity: 'SeoExperiment', entityId: id, details: {} });
  return updated;
}

export async function deleteExperiment(id: string, userId: string | null) {
  const e = await prisma.seoExperiment.delete({ where: { id }, include: { site: { select: { workspaceId: true } } } });
  await recordAuditEvent({ workspaceId: e.site.workspaceId, userId, action: 'experiment.deleted', entity: 'SeoExperiment', entityId: id, details: { name: e.name } });
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** RE2 "includingRegex" filters, chunked to stay well under the API's expression limit. */
function regexChunks(urls: string[], max = 3500) {
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const u of urls) {
    const p = reEscape(u);
    if (cur.length && len + p.length + 1 > max) {
      out.push(`^(${cur.join('|')})$`);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) out.push(`^(${cur.join('|')})$`);
  return out;
}

/** Fetches daily Search Console data for the experiment and stores the analysis. */
export async function runExperimentAnalysis(id: string) {
  const e = await prisma.seoExperiment.findUniqueOrThrow({ where: { id }, include: { site: true } });
  if (!e.site.gscProperty) throw new WorkflowError('GSC_NO_PROPERTY', 'Conecta Search Console y elige la propiedad de este sitio para analizar experimentos.', 400);
  const client = await gscClientFor(e.site.workspaceId);
  const lastDataDate = iso(Date.now() - 3 * DAY);
  const change = parse(e.changeDate);
  const startDate = iso(change - e.windowDays * DAY);
  const endDate = iso(Math.min(change + e.windowDays * DAY, parse(lastDataDate)));
  if (parse(endDate) < parse(startDate)) throw new WorkflowError('NO_DATA_YET', 'Todavía no hay datos de Search Console para estas fechas.', 400);

  const byDay = async (urls: string[]) => {
    const map = new Map<string, DayRow>();
    const pages = new Set<string>();
    for (const re of regexChunks(urls)) {
      const rows = await client.query(e.site.gscProperty!, { startDate, endDate, dimensions: ['date', 'page'], maxRows: 100_000, filters: [{ dimension: 'page', operator: 'includingRegex', expression: re }] }).catch(wrapGscError);
      for (const r of rows) {
        pages.add(r.keys[1]);
        const d = map.get(r.keys[0]) ?? { date: r.keys[0], clicks: 0, impressions: 0, posImpr: 0 };
        d.clicks += r.clicks;
        d.impressions += r.impressions;
        d.posImpr += r.position * r.impressions;
        map.set(r.keys[0], d);
      }
    }
    return { rows: [...map.values()], pages: pages.size };
  };

  const testUrls = e.testUrls as string[];
  const controlUrls = e.controlUrls as string[];
  const test = await byDay(testUrls);
  let control: DayRow[];
  if (controlUrls.length) control = (await byDay(controlUrls)).rows;
  else {
    // Control = the whole site minus the test pages.
    const site = await client.query(e.site.gscProperty, { startDate, endDate, dimensions: ['date'], maxRows: 1000 }).catch(wrapGscError);
    const t = new Map(test.rows.map(r => [r.date, r]));
    control = site.map(r => {
      const x = t.get(r.keys[0]);
      return { date: r.keys[0], clicks: Math.max(0, r.clicks - (x?.clicks ?? 0)), impressions: Math.max(0, r.impressions - (x?.impressions ?? 0)), posImpr: Math.max(0, r.position * r.impressions - (x?.posImpr ?? 0)) };
    });
  }
  const analysis = analyzeExperiment({ changeDate: e.changeDate, windowDays: e.windowDays, lastDataDate, test: test.rows, control, controlKind: controlUrls.length ? 'pages' : 'site', pagesWithData: test.pages });
  return prisma.seoExperiment.update({ where: { id }, data: { analysis: json(analysis), analyzedAt: new Date() } });
}
