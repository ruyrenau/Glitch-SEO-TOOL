import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { profileCsv, CsvError, renderTemplate, specificContent, jaccard, evaluateQualityGate, findMissingVariables, templateVariables, TemplateData } from '@glitch/content-engine';
import { prisma } from './client';
import { recordAuditEvent, currentActorId } from './audit';
import { WorkflowError } from './errors';

const json = (v: unknown) => v as Prisma.InputJsonValue;
export const MAX_BATCH = 500;

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export async function importDataset(siteId: string, input: { name: string; filename: string; csv: string }, actorUserId?: string | null) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new WorkflowError('SITE_NOT_FOUND', `Site ${siteId} not found`, 404);
  let profile;
  try {
    profile = profileCsv(input.csv);
  } catch (e) {
    if (e instanceof CsvError) throw new WorkflowError('INVALID_CSV', e.message, 400);
    throw e;
  }
  if (!profile.records.length) throw new WorkflowError('INVALID_CSV', 'The CSV has a header but no data rows', 400);
  const checksum = crypto.createHash('sha256').update(input.csv).digest('hex');
  const existing = await prisma.dataset.findUnique({ where: { siteId_checksum: { siteId, checksum } } });
  if (existing) throw new WorkflowError('DUPLICATE_DATASET', `This file was already imported as "${existing.name}"`, 409, { datasetId: existing.id });
  const ds = await prisma.dataset.create({
    data: {
      siteId,
      name: input.name,
      filename: input.filename,
      checksum,
      rowCount: profile.records.length,
      columns: json(profile.columns),
      data: json(profile.records),
      issues: json({ ...profile.issues, delimiter: profile.delimiter })
    }
  });
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId ?? null, action: 'dataset.imported', entity: 'Dataset', entityId: ds.id, details: { name: ds.name, rows: ds.rowCount, checksum } });
  return summarizeDataset(ds);
}

type DatasetRow = { id: string; name: string; filename: string; rowCount: number; columns: unknown; data: unknown; issues: unknown; createdAt: Date };
export function summarizeDataset(ds: DatasetRow, previewRows = 10) {
  return {
    id: ds.id,
    name: ds.name,
    filename: ds.filename,
    rowCount: ds.rowCount,
    columns: ds.columns as Array<{ name: string; variable: string; type: string; empty: number; unique: number; sample: string[] }>,
    issues: ds.issues as { duplicateRows: number[]; emptyCells: number; keyColumn: string | null; delimiter: string },
    preview: (ds.data as Array<Record<string, string>>).slice(0, previewRows),
    createdAt: ds.createdAt
  };
}

export async function listDatasets(siteId: string) {
  const rows = await prisma.dataset.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, include: { templates: { select: { id: true, name: true } } } });
  return rows.map(r => ({ ...summarizeDataset(r, 5), templates: r.templates }));
}

export async function deleteDataset(datasetId: string, actorUserId?: string | null) {
  const ds = await prisma.dataset.findUnique({ where: { id: datasetId }, include: { site: true } });
  if (!ds) throw new WorkflowError('DATASET_NOT_FOUND', `Dataset ${datasetId} not found`, 404);
  // Pages keep their own copy of the source row; only the template link is cleared.
  await prisma.generatedPage.updateMany({ where: { template: { datasetId } }, data: { templateId: null } });
  await prisma.dataset.delete({ where: { id: datasetId } });
  await recordAuditEvent({ workspaceId: ds.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'dataset.deleted', entity: 'Dataset', entityId: datasetId, details: { name: ds.name } });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateInput {
  name: string;
  titleTemplate: string;
  descTemplate: string;
  bodyTemplate: string;
  slugTemplate: string;
}

export async function createTemplate(datasetId: string, input: TemplateInput, actorUserId?: string | null) {
  const ds = await prisma.dataset.findUnique({ where: { id: datasetId }, include: { site: true } });
  if (!ds) throw new WorkflowError('DATASET_NOT_FOUND', `Dataset ${datasetId} not found`, 404);
  const columns = (ds.columns as Array<{ variable: string }>).map(c => c.variable);
  const unknown = templateVariables(input.titleTemplate, input.descTemplate, input.bodyTemplate, input.slugTemplate).filter(v => !columns.includes(v));
  if (unknown.length) throw new WorkflowError('UNKNOWN_VARIABLES', `Variables not in the dataset: ${unknown.map(v => `{{${v}}}`).join(', ')}`, 400, { unknown, available: columns });
  if (/<script|javascript:|on\w+\s*=/i.test(input.bodyTemplate)) throw new WorkflowError('UNSAFE_TEMPLATE', 'Templates cannot contain scripts or inline event handlers', 400);
  const t = await prisma.contentTemplate.create({ data: { datasetId, ...input } });
  await recordAuditEvent({ workspaceId: ds.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'template.created', entity: 'ContentTemplate', entityId: t.id, details: { name: t.name } });
  return t;
}

export async function listTemplates(siteId: string) {
  return prisma.contentTemplate.findMany({ where: { dataset: { siteId } }, orderBy: { createdAt: 'desc' }, include: { dataset: { select: { id: true, name: true, rowCount: true } }, _count: { select: { generatedPages: true } } } });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface Templates {
  title: string;
  meta: string;
  body: string;
  slug: string;
}

interface Existing {
  id: string;
  slug: string;
  content: string;
}

function renderPage(t: Templates, data: TemplateData) {
  return {
    title: renderTemplate(t.title, data).trim(),
    metaDescription: renderTemplate(t.meta, data).trim(),
    content: renderTemplate(t.body, data, { escape: true }),
    slug: slugify(renderTemplate(t.slug, data) || renderTemplate(t.title, data))
  };
}

/**
 * Builds pages for rows, comparing each page with the site's existing pages and with the
 * pages created earlier in the same run. Similarity is measured on the content specific to
 * each row (template boilerplate removed), so shared template text does not count.
 */
async function generatePages(siteId: string, t: Templates, rows: Array<{ data: TemplateData; rowIndex: number | null }>, templateId: string | null) {
  const existing: Existing[] = await prisma.generatedPage.findMany({ where: { siteId, NOT: { status: 'ARCHIVED' } }, select: { id: true, slug: true, content: true } });
  const boilerplate = renderTemplate(t.body, {});
  const known = existing.map(e => ({ slug: e.slug, shingles: specificContent(e.content, boilerplate).shingles }));
  const slugs = new Set(existing.map(e => e.slug));
  const created: Array<{ id: string; slug: string; status: string; rowIndex: number | null }> = [];
  const skipped: Array<{ rowIndex: number | null; slug: string; reason: string }> = [];

  for (const row of rows) {
    const page = renderPage(t, row.data);
    if (!page.slug) {
      skipped.push({ rowIndex: row.rowIndex, slug: '', reason: 'Empty slug' });
      continue;
    }
    if (slugs.has(page.slug)) {
      skipped.push({ rowIndex: row.rowIndex, slug: page.slug, reason: 'Slug already exists' });
      continue;
    }
    const spec = specificContent(page.content, boilerplate);
    let similarityScore = 0;
    let mostSimilar: string | null = null;
    for (const k of known) {
      const sim = spec.shingles.size || k.shingles.size ? jaccard(spec.shingles, k.shingles) : 1;
      if (sim > similarityScore) {
        similarityScore = sim;
        mostSimilar = k.slug;
      }
    }
    similarityScore = Math.round(similarityScore * 100) / 100;
    const missingVariables = findMissingVariables(row.data, t.title, t.meta, t.body, t.slug);
    const gate = evaluateQualityGate({ ...page, similarityScore, uniqueWords: spec.uniqueWords, missingVariables });
    const rec = await prisma.generatedPage.create({
      data: {
        siteId,
        templateId,
        ...page,
        sourceData: json(row.data),
        sourceRow: row.rowIndex,
        uniqueWords: spec.uniqueWords,
        status: gate.status,
        similarityScore,
        qualityChecks: json({ issues: gate.issues, mostSimilar, wordCount: spec.totalWords, template: t })
      }
    });
    slugs.add(page.slug);
    known.push({ slug: page.slug, shingles: spec.shingles });
    created.push({ id: rec.id, slug: rec.slug, status: rec.status, rowIndex: row.rowIndex });
  }
  return { created, skipped };
}

/** Single page from ad-hoc templates and one data row. */
export async function createGeneratedPage(
  siteId: string,
  input: { titleTemplate: string; bodyTemplate: string; metaTemplate: string; slugTemplate: string; data: TemplateData },
  actorUserId?: string | null
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new WorkflowError('SITE_NOT_FOUND', `Site ${siteId} not found`, 404);
  const t = { title: input.titleTemplate, meta: input.metaTemplate, body: input.bodyTemplate, slug: input.slugTemplate };
  const { created, skipped } = await generatePages(siteId, t, [{ data: input.data, rowIndex: null }], null);
  if (!created.length) throw new WorkflowError('DUPLICATE_SLUG', `A page with slug "${skipped[0]?.slug}" already exists for this site`);
  await recordAuditEvent({ workspaceId: site.workspaceId, userId: actorUserId ?? null, action: 'page.generated', entity: 'GeneratedPage', entityId: created[0].id, details: { slug: created[0].slug, status: created[0].status } });
  return prisma.generatedPage.findUniqueOrThrow({ where: { id: created[0].id } });
}

/** Generates pages for dataset rows (all rows, or the given 0-based indexes), at most MAX_BATCH per run. */
export async function generateFromTemplate(templateId: string, opts: { rows?: number[]; limit?: number } = {}, actorUserId?: string | null) {
  const tpl = await prisma.contentTemplate.findUnique({ where: { id: templateId }, include: { dataset: { include: { site: true } } } });
  if (!tpl || !tpl.dataset.siteId) throw new WorkflowError('TEMPLATE_NOT_FOUND', `Template ${templateId} not found`, 404);
  const records = tpl.dataset.data as Array<Record<string, string>>;
  const indexes = (opts.rows ?? records.map((_, i) => i)).filter(i => i >= 0 && i < records.length);
  const limit = Math.min(opts.limit ?? MAX_BATCH, MAX_BATCH);
  const selected = indexes.slice(0, limit);
  const t = { title: tpl.titleTemplate, meta: tpl.descTemplate, body: tpl.bodyTemplate, slug: tpl.slugTemplate };
  const { created, skipped } = await generatePages(tpl.dataset.siteId, t, selected.map(i => ({ data: records[i], rowIndex: i })), tpl.id);
  const byStatus: Record<string, number> = {};
  for (const c of created) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  await recordAuditEvent({ workspaceId: tpl.dataset.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'pages.generated', entity: 'ContentTemplate', entityId: tpl.id, details: { created: created.length, skipped: skipped.length, byStatus } });
  return { created: created.length, skipped, byStatus, remaining: Math.max(0, indexes.length - selected.length), pages: created };
}

export async function listGeneratedPages(siteId: string, filter: { status?: string; templateId?: string } = {}) {
  return prisma.generatedPage.findMany({
    where: { siteId, ...(filter.status ? { status: filter.status as Prisma.EnumPageStatusFilter['equals'] } : {}), ...(filter.templateId ? { templateId: filter.templateId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { sourceRow: 'asc' }],
    take: 1000,
    include: {
      approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
      publications: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, action: true, result: true, wpPostId: true, wpLink: true, error: true, createdAt: true } }
    }
  });
}

// ---------------------------------------------------------------------------
// Human review
// ---------------------------------------------------------------------------

export async function reviewPage(pageId: string, decision: 'approved' | 'rejected', reviewer: string, notes?: string, actorUserId?: string | null) {
  const page = await prisma.generatedPage.findUnique({ where: { id: pageId }, include: { site: true } });
  if (!page) throw new WorkflowError('PAGE_NOT_FOUND', `Page ${pageId} not found`, 404);
  if (decision === 'approved' && page.status === 'BLOCKED') throw new WorkflowError('PAGE_BLOCKED', 'Blocked pages cannot be approved; fix the data or template and regenerate');
  if (page.status === 'ARCHIVED') throw new WorkflowError('PAGE_ARCHIVED', 'Archived pages cannot be reviewed');
  if (page.status === 'SENT_AS_DRAFT' && decision === 'rejected') throw new WorkflowError('ALREADY_SENT', 'This page already exists as a draft in WordPress; edit or delete it there');
  await prisma.approval.create({ data: { generatedPageId: pageId, reviewer, action: decision, notes, userId: actorUserId ?? currentActorId() } });
  const updated = await prisma.generatedPage.update({ where: { id: pageId }, data: { status: decision === 'approved' ? 'APPROVED' : 'NEEDS_REVIEW' } });
  await recordAuditEvent({ workspaceId: page.site?.workspaceId ?? null, userId: actorUserId ?? null, action: `page.${decision}`, entity: 'GeneratedPage', entityId: pageId, details: { reviewer, notes } });
  return updated;
}

/** Reviews several pages; each result is reported separately (blocked pages are refused, not skipped silently). */
export async function bulkReview(pageIds: string[], decision: 'approved' | 'rejected', reviewer: string, notes?: string) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of pageIds) {
    try {
      await reviewPage(id, decision, reviewer, notes);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof WorkflowError ? e.code : (e as Error).message });
    }
  }
  return results;
}

/**
 * Deletes pages whose latest review is a rejection. Pages that reached WordPress (sent as draft or with
 * any publication attempt) are never deleted here. Each deletion is audited with the page's title and slug.
 */
export async function deleteRejectedPages(siteId: string, ids?: string[], actorUserId?: string | null) {
  const pages = await prisma.generatedPage.findMany({
    where: { siteId, ...(ids?.length ? { id: { in: ids } } : {}) },
    include: { site: true, approvals: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { publications: true } } }
  });
  const deleted: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const p of pages) {
    if (p.approvals[0]?.action !== 'rejected') {
      if (ids?.length) skipped.push({ id: p.id, reason: 'NOT_REJECTED' });
      continue;
    }
    if (p.status === 'SENT_AS_DRAFT' || p._count.publications > 0) {
      skipped.push({ id: p.id, reason: 'IN_WORDPRESS' });
      continue;
    }
    await prisma.generatedPage.delete({ where: { id: p.id } });
    await recordAuditEvent({ workspaceId: p.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'page.deleted', entity: 'GeneratedPage', entityId: p.id, details: { title: p.title, slug: p.slug, reason: 'rejected' } });
    deleted.push(p.id);
  }
  if (ids?.length) for (const id of ids) if (!pages.some(p => p.id === id)) skipped.push({ id, reason: 'NOT_FOUND' });
  return { deleted: deleted.length, deletedIds: deleted, skipped };
}

export async function archivePage(pageId: string, actorUserId?: string | null) {
  const page = await prisma.generatedPage.update({ where: { id: pageId }, data: { status: 'ARCHIVED' }, include: { site: true } });
  await recordAuditEvent({ workspaceId: page.site?.workspaceId ?? null, userId: actorUserId ?? null, action: 'page.archived', entity: 'GeneratedPage', entityId: pageId });
  return page;
}
