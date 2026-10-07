import { describe, it, expect } from 'vitest';
import { diffCrawls, alertsFromDiff, PageSnapshot } from '@glitch/crawler';

const page = (url: string, o: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url,
  statusCode: 200,
  title: `Title ${url}`,
  metaDescription: 'd',
  canonical: url,
  h1: 'h',
  isIndexable: true,
  indexabilityReason: null,
  wordCount: 400,
  blockedByRobots: false,
  schemaTypes: ['WebPage'],
  ...o
});

describe('diffCrawls', () => {
  const before = [page('/a'), page('/b'), page('/c'), page('/d'), page('/gone'), page('/e', { statusCode: 404, isIndexable: false, indexabilityReason: 'HTTP 404' })];
  const after = [
    page('/a', { isIndexable: false, indexabilityReason: 'noindex' }),
    page('/b', { canonical: '/a', isIndexable: false, indexabilityReason: 'Canonicalized to /a' }),
    page('/c', { statusCode: 500, isIndexable: false, indexabilityReason: 'HTTP 500', title: null }),
    page('/d', { wordCount: 50, schemaTypes: [], title: 'New title' }),
    page('/e'),
    page('/new')
  ];

  it('classifies every kind of change', () => {
    const d = diffCrawls(before, after, { newerCrawlComplete: true });
    const types = (u: string) => d.changes.filter(c => c.url === u).map(c => c.type).sort();
    expect(types('/a')).toEqual(['NOINDEX_ADDED']);
    expect(types('/b')).toEqual(['BECAME_NON_INDEXABLE', 'CANONICAL_CHANGED']);
    expect(types('/c')).toEqual(['PAGE_BROKEN']); // content fields are not compared on errors
    expect(types('/d')).toEqual(['CONTENT_SHRUNK', 'SCHEMA_REMOVED', 'TITLE_CHANGED']);
    expect(types('/e')).toEqual(['BECAME_INDEXABLE', 'PAGE_RECOVERED']);
    expect(types('/new')).toEqual(['PAGE_ADDED']);
    expect(types('/gone')).toEqual(['PAGE_REMOVED']);
  });

  it('does not report removals when the newer crawl was cut short', () => {
    const d = diffCrawls(before, after, { newerCrawlComplete: false });
    expect(d.counts.PAGE_REMOVED).toBeUndefined();
    expect(d.removalsReliable).toBe(false);
  });

  it('reports a newly robots-blocked page once, not also as a status change', () => {
    const d = diffCrawls([page('/x')], [page('/x', { statusCode: 0, blockedByRobots: true, isIndexable: false, indexabilityReason: 'Blocked by robots.txt' })], { newerCrawlComplete: true });
    expect(d.changes.map(c => c.type)).toEqual(['ROBOTS_BLOCKED_NEW']);
  });

  it('reports nothing for identical crawls', () => {
    expect(diffCrawls(before, before, { newerCrawlComplete: true }).changes).toEqual([]);
  });
});

describe('alertsFromDiff', () => {
  it('raises alerts for regressions only, with severities', () => {
    const d = diffCrawls([page('/a'), page('/b'), page('/c')], [page('/a', { isIndexable: false, indexabilityReason: 'noindex' }), page('/b', { statusCode: 404, isIndexable: false, indexabilityReason: 'HTTP 404' }), page('/c', { title: 'x' })], { newerCrawlComplete: true });
    const alerts = alertsFromDiff(d, { pagesInNewerCrawl: 3, robotsBefore: { found: true, hash: 'aa' }, robotsAfter: { found: true, hash: 'bb' } });
    expect(alerts.map(a => [a.type, a.severity])).toEqual([
      ['NOINDEX_ADDED', 'CRITICAL'],
      ['PAGE_BROKEN', 'HIGH'],
      ['ROBOTS_CHANGED', 'MEDIUM']
    ]);
  });

  it('flags mass title changes only above 20% of at least 10 pages', () => {
    const many = Array.from({ length: 10 }, (_, i) => page(`/p${i}`));
    const changed = many.map((p, i) => (i < 3 ? { ...p, title: 'changed' } : p));
    const d = diffCrawls(many, changed, { newerCrawlComplete: true });
    expect(alertsFromDiff(d, { pagesInNewerCrawl: 10 }).map(a => a.type)).toEqual(['MASS_TITLE_CHANGE']);
    const one = many.map((p, i) => (i < 1 ? { ...p, title: 'changed' } : p));
    expect(alertsFromDiff(diffCrawls(many, one, { newerCrawlComplete: true }), { pagesInNewerCrawl: 10 })).toEqual([]);
  });

  it('alerts when robots.txt becomes unreachable', () => {
    const d = diffCrawls([], [], { newerCrawlComplete: true });
    expect(alertsFromDiff(d, { pagesInNewerCrawl: 0, robotsBefore: { found: true, hash: 'a' }, robotsAfter: { found: false, hash: null } })[0].type).toBe('ROBOTS_UNREACHABLE');
  });
});
