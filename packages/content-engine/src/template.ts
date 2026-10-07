const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ESCAPES[c]);

export type TemplateData = Record<string, string | number | boolean | null | undefined>;

/**
 * Replaces {{variable}} with data values. No expressions, no code execution.
 * With `escape`, values are HTML-escaped (use it for HTML bodies: data comes from CSV files).
 * Missing values render as an empty string; use `findMissingVariables` to block those pages.
 */
export function renderTemplate(template: string, data: TemplateData, opts: { escape?: boolean } = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => {
    const val = data[key];
    if (val === undefined || val === null) return '';
    return opts.escape ? escapeHtml(String(val)) : String(val);
  });
}

export function templateVariables(...templates: string[]): string[] {
  return [...new Set(templates.flatMap(t => [...t.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map(m => m[1])))];
}

export function findMissingVariables(data: TemplateData, ...templates: string[]): string[] {
  return templateVariables(...templates).filter(v => data[v] === undefined || data[v] === null || data[v] === '');
}
