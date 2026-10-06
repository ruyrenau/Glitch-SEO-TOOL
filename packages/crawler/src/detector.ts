import { IssueSeverity } from '@glitch/core';

export interface CrawlPageAuditData {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  robotsMeta?: string;
  h1?: string[];
  h2Count?: number;
  wordCount: number;
  inSitemap?: boolean;
  inLogs?: boolean;
  internalOutlinksCount: number;
  hasSchema: boolean;
  redirectChain?: string[];
}

export interface DetectedIssue {
  code: string;
  title: string;
  category: string;
  severity: IssueSeverity;
  description: string;
  recommendation: string;
  impact: number;
  effort: number;
  risk: number;
  affectedUrls: string[];
}

export function detectTechnicalIssues(pages: CrawlPageAuditData[]): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const addIssue = (
    code: string,
    title: string,
    category: string,
    severity: IssueSeverity,
    description: string,
    recommendation: string,
    impact: number,
    effort: number,
    urls: string[]
  ) => {
    if (urls.length > 0) {
      issues.push({
        code,
        title,
        category,
        severity,
        description,
        recommendation,
        impact,
        effort,
        risk: 2,
        affectedUrls: urls
      });
    }
  };

  // 1. 4xx Client Errors
  const notFound = pages.filter(p => p.statusCode >= 400 && p.statusCode < 500).map(p => p.url);
  addIssue('ERR_4XX_CLIENT', '4xx Client Error Response', 'INDEXABILITY', 'CRITICAL',
    'Server returned 4xx status code when requested by bot or crawler.',
    'Update links pointing to these URLs or configure proper 301 redirects to relevant live pages.',
    9, 3, notFound);

  // 2. 5xx Server Errors
  const serverErrors = pages.filter(p => p.statusCode >= 500).map(p => p.url);
  addIssue('ERR_5XX_SERVER', '5xx Server Error Response', 'CRAWLABILITY', 'CRITICAL',
    'Internal server error or gateway timeout during crawl.',
    'Investigate backend crash logs, database connection pooling, or upstream server stability.',
    10, 5, serverErrors);

  // 3. Missing Title Tag
  const missingTitle = pages.filter(p => p.statusCode === 200 && (!p.title || p.title.trim().length === 0)).map(p => p.url);
  addIssue('META_TITLE_MISSING', 'Missing <title> Tag', 'METADATA', 'HIGH',
    'Pages lack a title element, hindering search engine understanding and CTR.',
    'Provide descriptive, keyword-aligned title tags between 50-60 characters.',
    8, 2, missingTitle);

  // 4. Short Title Tag (<30 chars)
  const shortTitle = pages.filter(p => p.statusCode === 200 && p.title && p.title.length < 30).map(p => p.url);
  addIssue('META_TITLE_TOO_SHORT', 'Title Tag Too Short', 'METADATA', 'MEDIUM',
    'Title tag does not utilize sufficient character space for relevancy.',
    'Expand title with brand name or secondary descriptive terms.',
    5, 2, shortTitle);

  // 5. Missing Meta Description
  const missingDesc = pages.filter(p => p.statusCode === 200 && (!p.metaDescription || p.metaDescription.trim().length === 0)).map(p => p.url);
  addIssue('META_DESC_MISSING', 'Missing Meta Description', 'METADATA', 'MEDIUM',
    'Search snippets may generate random body snippets instead of crafted copy.',
    'Add compelling meta descriptions between 120-155 characters.',
    6, 2, missingDesc);

  // 6. Missing H1 Tag
  const missingH1 = pages.filter(p => p.statusCode === 200 && (!p.h1 || p.h1.length === 0)).map(p => p.url);
  addIssue('HEADING_H1_MISSING', 'Missing Primary <h1> Heading', 'CONTENT', 'HIGH',
    'Page lacks a top-level heading establishing page topic hierarchy.',
    'Ensure every page has exactly one descriptive <h1> tag matching the user intent.',
    7, 2, missingH1);

  // 7. Multiple H1 Tags
  const multiH1 = pages.filter(p => p.statusCode === 200 && p.h1 && p.h1.length > 1).map(p => p.url);
  addIssue('HEADING_H1_MULTIPLE', 'Multiple <h1> Headings Found', 'CONTENT', 'LOW',
    'More than one primary H1 tag found, which can dilute semantic hierarchy.',
    'Consolidate main topic into a single H1 and use H2/H3 for subsections.',
    3, 2, multiH1);

  // 8. Missing Canonical Tag
  const missingCanonical = pages.filter(p => p.statusCode === 200 && !p.canonical).map(p => p.url);
  addIssue('CANONICAL_MISSING', 'Missing Canonical Link Element', 'CANONICAL', 'HIGH',
    'Pages without canonical URL declaration risk duplicate content signals.',
    'Add self-referential or master rel="canonical" tag in the <head>.',
    7, 2, missingCanonical);

  // 9. Accidental Noindex in Production
  const accidentalNoindex = pages.filter(p => p.statusCode === 200 && p.robotsMeta && /noindex/i.test(p.robotsMeta)).map(p => p.url);
  addIssue('INDEX_ACCIDENTAL_NOINDEX', 'Page Blocked by noindex Tag', 'INDEXABILITY', 'CRITICAL',
    'Robots meta tag explicitly instructs search engines not to index this page.',
    'Verify if noindex was left from staging or intentional; remove if page is valuable.',
    10, 1, accidentalNoindex);

  // 10. Thin Content (<150 words)
  const thinContent = pages.filter(p => p.statusCode === 200 && p.wordCount < 150).map(p => p.url);
  addIssue('CONTENT_THIN', 'Thin Content Detected (<150 words)', 'CONTENT', 'HIGH',
    'Pages have sparse content providing little unique value to users or search engines.',
    'Enrich page with comprehensive information, FAQs, data, or consider noindexing/consolidating.',
    8, 4, thinContent);

  // 11. Slow Server Response (>1000ms TTFB)
  const slowPages = pages.filter(p => p.responseTimeMs > 1000).map(p => p.url);
  addIssue('PERF_SLOW_RESPONSE', 'Slow Server Response (>1.0s)', 'PERFORMANCE', 'HIGH',
    'High server latency hurts crawl budget and Core Web Vitals (TTFB/LCP).',
    'Enable page caching, CDN edge caching, and optimize database queries.',
    7, 4, slowPages);

  // 12. Orphan Pages (In sitemap or logs but 0 internal inlinks)
  const orphanPages = pages.filter(p => p.inSitemap && p.internalOutlinksCount === 0).map(p => p.url);
  addIssue('ARCH_ORPHAN_PAGE', 'Orphan Page Suspected', 'CRAWLABILITY', 'MEDIUM',
    'URL found in sitemap has no incoming crawl references from site architecture.',
    'Add contextual links from parent category or related articles.',
    6, 3, orphanPages);

  // 13. Missing Structured Data (Schema JSON-LD)
  const missingSchema = pages.filter(p => p.statusCode === 200 && !p.hasSchema).map(p => p.url);
  addIssue('SCHEMA_MISSING', 'No Structured Data (JSON-LD) Found', 'STRUCTURED_DATA', 'MEDIUM',
    'Page lacks Schema.org semantic annotations, reducing eligibility for rich snippets.',
    'Embed appropriate JSON-LD (WebPage, Article, Organization or Product).',
    5, 3, missingSchema);

  // 14. Redirect Chains (2+ hops)
  const redirectChains = pages.filter(p => p.redirectChain && p.redirectChain.length > 2).map(p => p.url);
  addIssue('REDIRECT_CHAIN', 'Redirect Chain Detected (>2 hops)', 'CRAWLABILITY', 'HIGH',
    'Multiple intermediate 301/302 redirects waste crawl budget and slow page loads.',
    'Update references to point directly to final destination 200 URL.',
    7, 2, redirectChains);

  // 15. URL in Sitemap Returning Error
  const sitemapErrors = pages.filter(p => p.inSitemap && p.statusCode >= 400).map(p => p.url);
  addIssue('SITEMAP_ERROR_URL', 'Sitemap Contains Broken / Non-200 URLs', 'INDEXABILITY', 'HIGH',
    'XML Sitemap includes URLs returning 404 or 500 status codes.',
    'Clean XML sitemap to contain strictly clean 200 OK indexable canonical pages.',
    8, 2, sitemapErrors);

  return issues;
}
