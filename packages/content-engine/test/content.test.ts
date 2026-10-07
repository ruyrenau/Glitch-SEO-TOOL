import { describe, it, expect } from 'vitest';
import { parseCsv, profileCsv, CsvError, toVariableName, renderTemplate, findMissingVariables, specificContent, computeJaccardSimilarity, simhash, hamming, evaluateQualityGate } from '@glitch/content-engine';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, newlines in quotes, CRLF and a BOM', () => {
    const csv = '﻿city,description\r\n"Puebla","Dice ""hola""\ny adiós"\r\nCDMX,simple\r\n';
    const r = parseCsv(csv);
    expect(r.header).toEqual(['city', 'description']);
    expect(r.rows).toEqual([['Puebla', 'Dice "hola"\ny adiós'], ['CDMX', 'simple']]);
  });
  it('detects ; and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2').delimiter).toBe(';');
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('tab');
    expect(parseCsv('"x,y";b\n1;2').rows).toEqual([['1', '2']]);
  });
  it('rejects malformed input with a line number', () => {
    expect(() => parseCsv('a,b\n1,2,3')).toThrow(/Line 2: Expected 2 columns/);
    expect(() => parseCsv('a,a\n1,2')).toThrow(/Duplicate column/);
    expect(() => parseCsv('a,\n1,2')).toThrow(/needs a name/);
    expect(() => parseCsv('a,b\n"1,2')).toThrow(CsvError);
    expect(() => parseCsv('a\n' + '1\n'.repeat(11), { maxRows: 10 })).toThrow(/More than 10 rows/);
  });
});

describe('profileCsv', () => {
  it('infers types, finds empty cells, duplicate rows and a key column', () => {
    const p = profileCsv('Ciudad,Precio (MXN),Sitio,Activo\nPuebla,15000,https://a.mx,sí\nCDMX,20000,https://b.mx,no\nPuebla,15000,https://a.mx,sí\nToluca,,https://c.mx,sí');
    expect(p.columns.map(c => [c.variable, c.type])).toEqual([
      ['ciudad', 'text'],
      ['precio_mxn', 'number'],
      ['sitio', 'url'],
      ['activo', 'boolean']
    ]);
    expect(p.issues.duplicateRows).toEqual([3]);
    expect(p.issues.emptyCells).toBe(1);
    expect(p.issues.keyColumn).toBeNull();
    expect(p.records[0]).toEqual({ ciudad: 'Puebla', precio_mxn: '15000', sitio: 'https://a.mx', activo: 'sí' });
    expect(toVariableName('Descripción corta')).toBe('descripcion_corta');
  });
});

describe('templates', () => {
  it('escapes HTML from data in bodies', () => {
    expect(renderTemplate('<p>{{x}}</p>', { x: '<script>alert(1)</script>' }, { escape: true })).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(renderTemplate('{{x}}', { x: 'a & b' })).toBe('a & b');
  });
  it('lists variables without data', () => {
    expect(findMissingVariables({ a: '1', b: '' }, '{{a}} {{b}}', '{{ c }}')).toEqual(['b', 'c']);
  });
});

describe('similarity', () => {
  it('normalizes accents and ignores HTML', () => {
    expect(computeJaccardSimilarity('<p>Auditoría técnica en Puebla hoy</p>', 'auditoria tecnica en puebla hoy')).toBe(1);
  });
  it('measures only what the data adds beyond the template', () => {
    const tpl = (city: string, desc: string) => `<h1>Servicio en ${city}</h1><p>Texto fijo de la plantilla que se repite en todas las páginas generadas.</p><p>${desc}</p>`;
    const base = tpl('', '');
    const a = specificContent(tpl('Puebla', 'Centro histórico con muchas pymes de turismo y gastronomía local.'), base);
    const b = specificContent(tpl('Monterrey', 'Polo industrial con empresas de manufactura y logística exportadora.'), base);
    expect(a.uniqueWords).toBeGreaterThanOrEqual(10);
    expect(computeJaccardSimilarity(tpl('Puebla', 'x y z'), tpl('Monterrey', 'x y z'))).toBeGreaterThan(0.4); // full text: inflated by the template
    let inter = 0;
    for (const s of a.shingles) if (b.shingles.has(s)) inter++;
    expect(inter).toBe(0); // specific parts share nothing
  });
  it('simhash distance is small for near-identical text and large otherwise', () => {
    const t = 'el crawler revisa robots txt sitemaps canonicals y respuestas del servidor para cada url del sitio';
    expect(hamming(simhash(t), simhash(t + ' hoy'))).toBeLessThan(12);
    expect(hamming(simhash(t), simhash('receta de mole poblano con chiles anchos mulatos pasilla y chocolate de mesa tradicional'))).toBeGreaterThan(15);
  });
});

describe('evaluateQualityGate', () => {
  const ok = {
    title: 'Auditoría SEO técnica en Puebla para pymes',
    metaDescription: 'Revisión de logs, rastreo, indexación y datos estructurados para empresas de Puebla con entregables claros.',
    content: `<h1>Auditoría</h1><p>${'palabra '.repeat(120)}</p>`,
    slug: 'auditoria-seo-puebla',
    similarityScore: 0.1,
    uniqueWords: 40
  };
  it('passes a complete page', () => {
    expect(evaluateQualityGate(ok)).toEqual({ passed: true, status: 'READY_FOR_APPROVAL', issues: [] });
  });
  it('blocks missing data, unrendered syntax, near-duplicates and pages with no row-specific content', () => {
    expect(evaluateQualityGate({ ...ok, missingVariables: ['price'] }).status).toBe('BLOCKED');
    expect(evaluateQualityGate({ ...ok, content: ok.content + '{{price}}' }).status).toBe('BLOCKED');
    expect(evaluateQualityGate({ ...ok, similarityScore: 0.9 }).status).toBe('BLOCKED');
    expect(evaluateQualityGate({ ...ok, uniqueWords: 3 }).status).toBe('BLOCKED');
    expect(evaluateQualityGate({ ...ok, slug: 'Con Espacios' }).status).toBe('BLOCKED');
  });
  it('sends risky claims and borderline pages to human review', () => {
    const r = evaluateQualityGate({ ...ok, metaDescription: ok.metaDescription + ' Resultados garantizados.' });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.issues[0]).toMatch(/garantizados/);
    expect(evaluateQualityGate({ ...ok, uniqueWords: 15 }).status).toBe('NEEDS_REVIEW');
    expect(evaluateQualityGate({ ...ok, content: ok.content.replace('<h1>Auditoría</h1>', '') }).status).toBe('NEEDS_REVIEW');
  });
});
