export interface QualityGateResult {
  passed: boolean;
  status: 'READY_FOR_APPROVAL' | 'NEEDS_REVIEW' | 'BLOCKED';
  issues: string[];
}

export function evaluateQualityGate(params: {
  title: string;
  metaDescription: string;
  content: string;
  similarityScore: number;
  slug: string;
}): QualityGateResult {
  const issues: string[] = [];

  if (!params.title || params.title.trim().length === 0) {
    issues.push('Title is missing.');
  } else if (params.title.length > 70) {
    issues.push('Title exceeds 70 characters.');
  }

  if (!params.metaDescription || params.metaDescription.trim().length === 0) {
    issues.push('Meta description is missing.');
  }

  const wordCount = params.content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 100) {
    issues.push('Content is too thin (< 100 words).');
  }

  if (params.similarityScore > 0.85) {
    issues.push(`Extreme similarity with existing pages (${Math.round(params.similarityScore * 100)}%).`);
  } else if (params.similarityScore > 0.65) {
    issues.push(`Moderate similarity threshold exceeded (${Math.round(params.similarityScore * 100)}%).`);
  }

  if (!params.slug || !/^[a-z0-9-]+$/.test(params.slug)) {
    issues.push('Slug contains invalid characters or is missing.');
  }

  let status: QualityGateResult['status'] = 'READY_FOR_APPROVAL';
  if (params.similarityScore > 0.85 || wordCount < 50 || !params.title) {
    status = 'BLOCKED';
  } else if (issues.length > 0) {
    status = 'NEEDS_REVIEW';
  }

  return {
    passed: issues.length === 0,
    status,
    issues
  };
}
