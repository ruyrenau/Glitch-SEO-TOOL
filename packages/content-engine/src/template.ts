export function renderTemplate(template: string, data: Record<string, any>): string {
  // Safe template replacer using {{variable}} or {{ variable }} without eval
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}
