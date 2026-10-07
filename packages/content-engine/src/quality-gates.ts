import { toWords } from './similarity';

export interface QualityGateResult {
  passed: boolean;
  status: 'READY_FOR_APPROVAL' | 'NEEDS_REVIEW' | 'BLOCKED';
  issues: string[];
}

export interface QualityGateInput {
  title: string;
  metaDescription: string;
  content: string;
  slug: string;
  /** Highest similarity with another page (0-1). For template pages, use the template-specific similarity. */
  similarityScore: number;
  /** Words the data contributes beyond the template boilerplate (undefined for hand-written pages). */
  uniqueWords?: number;
  /** Template variables with no value in the data row. */
  missingVariables?: string[];
}

/** Claims that need a human to confirm they are true and supportable. */
const RISKY_CLAIMS = /\b(garantizad[oa]s?|guarantee[ds]?|el mejor|la mejor|los mejores|the best|n[uú]mero 1|#1|100 ?%|sin riesgo|risk[- ]free|cura|cures)\b/i;

export function evaluateQualityGate(p: QualityGateInput): QualityGateResult {
  const blockers: string[] = [];
  const reviews: string[] = [];
  const words = toWords(p.content).length;

  if (!p.title?.trim()) blockers.push('Title is missing.');
  else if (p.title.length > 65) reviews.push(`Title is ${p.title.length} characters (over 65).`);
  else if (p.title.length < 20) reviews.push(`Title is ${p.title.length} characters (under 20).`);

  if (!p.metaDescription?.trim()) reviews.push('Meta description is missing.');
  else if (p.metaDescription.length > 160) reviews.push(`Meta description is ${p.metaDescription.length} characters (over 160).`);
  else if (p.metaDescription.length < 70) reviews.push(`Meta description is ${p.metaDescription.length} characters (under 70).`);

  if (!p.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) blockers.push('Slug is missing or has invalid characters.');
  if (!/<h1[\s>]/i.test(p.content)) reviews.push('No <h1> in the body.');
  if (/\{\{|\}\}/.test(`${p.title} ${p.content} ${p.metaDescription}`)) blockers.push('Unrendered template syntax ({{ or }}) in the output.');
  if (p.missingVariables?.length) blockers.push(...p.missingVariables.map(v => `Missing data for {{${v}}}`));

  if (words < 50) blockers.push(`Content is too thin (${words} words).`);
  else if (words < 100) reviews.push(`Content is short (${words} words).`);

  if (p.uniqueWords !== undefined) {
    if (p.uniqueWords < 8) blockers.push(`Almost nothing specific to this row: ${p.uniqueWords} words differ from the template.`);
    else if (p.uniqueWords < 25) reviews.push(`Little content specific to this row (${p.uniqueWords} words beyond the template).`);
  }

  if (p.similarityScore > 0.85) blockers.push(`Near-duplicate of another page (${Math.round(p.similarityScore * 100)}% similar).`);
  else if (p.similarityScore > 0.6) reviews.push(`Very similar to another page (${Math.round(p.similarityScore * 100)}%).`);

  const claim = RISKY_CLAIMS.exec(`${p.title} ${p.metaDescription} ${p.content.replace(/<[^>]+>/g, ' ')}`);
  if (claim) reviews.push(`Possibly risky claim: "${claim[0]}". Confirm it is true and supportable.`);

  const issues = [...blockers, ...reviews];
  return { passed: issues.length === 0, status: blockers.length ? 'BLOCKED' : reviews.length ? 'NEEDS_REVIEW' : 'READY_FOR_APPROVAL', issues };
}
