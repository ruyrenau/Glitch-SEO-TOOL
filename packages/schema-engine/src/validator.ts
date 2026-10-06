export interface SchemaValidationResult {
  isValid: boolean;
  type: string;
  errors: string[];
  warnings: string[];
}

export function validateJsonLd(jsonString: string): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    return {
      isValid: false,
      type: 'Unknown',
      errors: ['Invalid JSON syntax: ' + err.message],
      warnings: []
    };
  }

  if (!parsed['@context']) {
    errors.push('Missing required "@context" property (expected "https://schema.org").');
  } else if (!/schema\.org/i.test(String(parsed['@context']))) {
    warnings.push('"@context" is not pointing to standard schema.org namespace.');
  }

  const type = parsed['@type'] || 'Unknown';
  if (type === 'Unknown') {
    errors.push('Missing "@type" property.');
  }

  // Type specific validations
  if (type === 'Article' || type === 'BlogPosting') {
    if (!parsed.headline) errors.push('Articles must have a "headline" property.');
    if (!parsed.author) warnings.push('Articles strongly recommend an "author" property.');
    if (!parsed.datePublished) warnings.push('Articles recommend a "datePublished" property.');
  }

  if (type === 'Organization' || type === 'LocalBusiness') {
    if (!parsed.name) errors.push('Organization must have a "name" property.');
    if (!parsed.url) warnings.push('Organization recommends a "url" property.');
  }

  if (type === 'FAQPage') {
    if (!parsed.mainEntity || !Array.isArray(parsed.mainEntity)) {
      errors.push('FAQPage requires "mainEntity" array of Questions.');
    }
  }

  return {
    isValid: errors.length === 0,
    type,
    errors,
    warnings
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
