import { validateSchema } from './validate';

export interface SchemaValidationResult {
  isValid: boolean;
  type: string;
  errors: string[];
  warnings: string[];
}

/** Flat summary used by the CLI and the old endpoint; the full report is validateSchema(). */
export function validateJsonLd(jsonString: string): SchemaValidationResult {
  const r = validateSchema(jsonString);
  const prefix = (n: { label: string; path: string }) => (r.nodes.length > 1 ? `${n.label}${n.path ? ` (${n.path})` : ''}: ` : '');
  return {
    isValid: r.ok,
    type: r.nodes.map(n => n.type).join(', ') || 'Unknown',
    errors: [...r.errors, ...r.nodes.flatMap(n => n.errors.map(e => prefix(n) + e))],
    warnings: [...r.warnings, ...r.nodes.flatMap(n => n.warnings.map(w => prefix(n) + w))]
  };
}

export function generateArticleSchema(params: {
  headline: string;
  description: string;
  url: string;
  authorName: string;
  datePublished?: string;
  imageUrl?: string;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${params.url}#article`,
    'headline': params.headline,
    'description': params.description,
    'mainEntityOfPage': params.url,
    'datePublished': params.datePublished || new Date().toISOString(),
    'author': {
      '@type': 'Person',
      'name': params.authorName
    },
    ...(params.imageUrl ? { 'image': params.imageUrl } : {})
  };
}
