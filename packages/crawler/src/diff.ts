import type { IssueSeverity } from '@glitch/core';

/** The fields of a crawled page that matter when comparing two crawls. */
export interface PageSnapshot {
  url: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1: string | null;
  isIndexable: boolean;
  indexabilityReason: string | null;
  wordCount: number;
  blockedByRobots: boolean;
  schemaTypes: string[];
}

export type ChangeType =
  | 'PAGE_ADDED'
  | 'PAGE_REMOVED'
  | 'STATUS_CHANGED'
  | 'PAGE_BROKEN'
  | 'PAGE_RECOVERED'
  | 'NOINDEX_ADDED'
  | 'BECAME_NON_INDEXABLE'
  | 'BECAME_INDEXABLE'
  | 'CANONICAL_CHANGED'
  | 'TITLE_CHANGED'
  | 'META_DESCRIPTION_CHANGED'
  | 'H1_CHANGED'
  | 'CONTENT_SHRUNK'
  | 'SCHEMA_REMOVED'
  | 'ROBOTS_BLOCKED_NEW';

export interface PageChange {
  type: ChangeType;
  url: string;
  before: unknown;
  after: unknown;
}

export interface CrawlDiff {
  changes: PageChange[];
  counts: Partial<Record<ChangeType, number>>;
  /** False when the newer crawl was cut short; "removed" pages are then not reported. */
  removalsReliable: boolean;
}

const ok = (s: number) => s >= 200 && s < 400;

export function diffCrawls(before: PageSnapshot[], after: PageSnapshot[], opts: { newerCrawlComplete: boolean }): CrawlDiff {
  const prev = new Map(before.map(p => [p.url, p]));
  const next = new Map(after.map(p => [p.url, p]));
  const changes: PageChange[] = [];
  const push = (type: ChangeType, url: string, b: unknown, a: unknown) => changes.push({ type, url, before: b, after: a });

  for (const [url, a] of next) {
    const b = prev.get(url);
    if (!b) {
      push('PAGE_ADDED', url, null, a.statusCode);
      continue;
    }
    if (b.statusCode !== a.statusCode && !(a.blockedByRobots && !b.blockedByRobots)) {
      if (ok(b.statusCode) && !ok(a.statusCode) && !a.blockedByRobots) push('PAGE_BROKEN', url, b.statusCode, a.statusCode || 'fetch error');
      else if (!ok(b.statusCode) && ok(a.statusCode)) push('PAGE_RECOVERED', url, b.statusCode || 'fetch error', a.statusCode);
      else push('STATUS_CHANGED', url, b.statusCode, a.statusCode);
    }
    if (!b.blockedByRobots && a.blockedByRobots) push('ROBOTS_BLOCKED_NEW', url, null, 'blocked');
    if (b.isIndexable && !a.isIndexable && ok(a.statusCode) && !a.blockedByRobots) {
      push(a.indexabilityReason === 'noindex' ? 'NOINDEX_ADDED' : 'BECAME_NON_INDEXABLE', url, 'indexable', a.indexabilityReason);
    }
    if (!b.isIndexable && a.isIndexable) push('BECAME_INDEXABLE', url, b.indexabilityReason, 'indexable');
    // Content comparisons only make sense when both versions were fetched as HTML.
    if (b.statusCode === 200 && a.statusCode === 200) {
      if ((b.canonical ?? null) !== (a.canonical ?? null)) push('CANONICAL_CHANGED', url, b.canonical, a.canonical);
      if ((b.title ?? '') !== (a.title ?? '')) push('TITLE_CHANGED', url, b.title, a.title);
      if ((b.metaDescription ?? '') !== (a.metaDescription ?? '')) push('META_DESCRIPTION_CHANGED', url, b.metaDescription, a.metaDescription);
      if ((b.h1 ?? '') !== (a.h1 ?? '')) push('H1_CHANGED', url, b.h1, a.h1);
      if (b.wordCount >= 150 && a.wordCount < b.wordCount * 0.5) push('CONTENT_SHRUNK', url, b.wordCount, a.wordCount);
      const lost = b.schemaTypes.filter(t => !a.schemaTypes.includes(t));
      if (lost.length) push('SCHEMA_REMOVED', url, b.schemaTypes, a.schemaTypes);
    }
  }
  if (opts.newerCrawlComplete) {
    for (const [url, b] of prev) if (!next.has(url)) push('PAGE_REMOVED', url, b.statusCode, null);
  }

  const counts: CrawlDiff['counts'] = {};
  for (const c of changes) counts[c.type] = (counts[c.type] ?? 0) + 1;
  return { changes, counts, removalsReliable: opts.newerCrawlComplete };
}

export interface AlertCandidate {
  type: string;
  severity: IssueSeverity;
  message: string;
  urls: string[];
  details?: Record<string, unknown>;
}

const urlsOf = (d: CrawlDiff, t: ChangeType) => d.changes.filter(c => c.type === t).map(c => c.url);

/**
 * Turns a diff into alerts. Only changes that usually mean "something broke"
 * alert; cosmetic edits stay in the diff view.
 */
export function alertsFromDiff(
  d: CrawlDiff,
  ctx: { pagesInNewerCrawl: number; robotsBefore?: { found: boolean; hash?: string | null }; robotsAfter?: { found: boolean; hash?: string | null } }
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const add = (type: string, severity: IssueSeverity, message: (n: number) => string, urls: string[], details?: Record<string, unknown>) => {
    if (urls.length) out.push({ type, severity, message: message(urls.length), urls: urls.slice(0, 200), details });
  };
  add('NOINDEX_ADDED', 'CRITICAL', n => `${n} page(s) that were indexable now have noindex`, urlsOf(d, 'NOINDEX_ADDED'));
  add('PAGE_BROKEN', 'HIGH', n => `${n} page(s) that answered 2xx/3xx now fail`, urlsOf(d, 'PAGE_BROKEN'), {
    statuses: Object.fromEntries(d.changes.filter(c => c.type === 'PAGE_BROKEN').slice(0, 50).map(c => [c.url, `${c.before} → ${c.after}`]))
  });
  add('BECAME_NON_INDEXABLE', 'HIGH', n => `${n} page(s) stopped being indexable`, urlsOf(d, 'BECAME_NON_INDEXABLE'), {
    reasons: Object.fromEntries(d.changes.filter(c => c.type === 'BECAME_NON_INDEXABLE').slice(0, 50).map(c => [c.url, c.after]))
  });
  add('CANONICAL_CHANGED', 'HIGH', n => `Canonical changed on ${n} page(s)`, urlsOf(d, 'CANONICAL_CHANGED'), {
    canonicals: Object.fromEntries(d.changes.filter(c => c.type === 'CANONICAL_CHANGED').slice(0, 50).map(c => [c.url, { before: c.before, after: c.after }]))
  });
  add('ROBOTS_BLOCKED_NEW', 'HIGH', n => `${n} previously crawlable page(s) are now blocked by robots.txt`, urlsOf(d, 'ROBOTS_BLOCKED_NEW'));
  add('CONTENT_SHRUNK', 'MEDIUM', n => `Main content shrank by more than half on ${n} page(s)`, urlsOf(d, 'CONTENT_SHRUNK'));
  add('SCHEMA_REMOVED', 'MEDIUM', n => `Structured data types disappeared from ${n} page(s)`, urlsOf(d, 'SCHEMA_REMOVED'));
  const titles = urlsOf(d, 'TITLE_CHANGED');
  if (ctx.pagesInNewerCrawl >= 10 && titles.length / ctx.pagesInNewerCrawl >= 0.2) {
    add('MASS_TITLE_CHANGE', 'MEDIUM', n => `Titles changed on ${n} pages (${Math.round((n / ctx.pagesInNewerCrawl) * 100)}% of the crawl), often a template change`, titles);
  }
  const rb = ctx.robotsBefore;
  const ra = ctx.robotsAfter;
  if (rb && ra) {
    if (rb.found && !ra.found) out.push({ type: 'ROBOTS_UNREACHABLE', severity: 'HIGH', message: 'robots.txt was reachable in the previous crawl and is not now', urls: [] });
    else if (rb.hash && ra.hash && rb.hash !== ra.hash) out.push({ type: 'ROBOTS_CHANGED', severity: 'MEDIUM', message: 'robots.txt content changed since the previous crawl', urls: [] });
  }
  return out;
}
