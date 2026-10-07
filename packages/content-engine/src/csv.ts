/**
 * RFC 4180 CSV parser with delimiter detection (, ; tab), quoted fields,
 * escaped quotes, newlines inside quotes and a UTF-8 BOM.
 */
export interface CsvLimits {
  maxRows?: number;
  maxColumns?: number;
  maxCellLength?: number;
}

export class CsvError extends Error {
  constructor(message: string, public line?: number) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'CsvError';
  }
}

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<',' | ';' | '\t', number>;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as ',']++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',') as ',' | ';' | '\t';
}

export function parseCsv(input: string, limits: CsvLimits = {}): { header: string[]; rows: string[][]; delimiter: string } {
  const maxRows = limits.maxRows ?? 5000;
  const maxColumns = limits.maxColumns ?? 100;
  const maxCell = limits.maxCellLength ?? 20_000;
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let i = 0;

  const endField = () => {
    if (field.length > maxCell) throw new CsvError(`Cell longer than ${maxCell} characters`, line);
    record.push(field);
    field = '';
    if (record.length > maxColumns) throw new CsvError(`More than ${maxColumns} columns`, line);
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    if (records.length > maxRows + 1) throw new CsvError(`More than ${maxRows} rows`);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === d) endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
    } else field += ch;
    i++;
  }
  if (inQuotes) throw new CsvError('Unclosed quoted field', line);
  if (field !== '' || record.length) endRecord();
  if (!records.length) throw new CsvError('The file is empty');

  const header = records[0].map(h => h.trim());
  if (header.some(h => !h)) throw new CsvError('Every column needs a name in the header row', 1);
  const dupes = header.filter((h, idx) => header.indexOf(h) !== idx);
  if (dupes.length) throw new CsvError(`Duplicate column names: ${[...new Set(dupes)].join(', ')}`, 1);
  const rows = records.slice(1);
  rows.forEach((r, idx) => {
    if (r.length !== header.length) throw new CsvError(`Expected ${header.length} columns, found ${r.length}`, idx + 2);
  });
  return { header, rows, delimiter: d === '\t' ? 'tab' : d };
}

export type ColumnType = 'number' | 'boolean' | 'url' | 'email' | 'date' | 'text';

export interface ColumnProfile {
  name: string;
  /** Usable as {{variable}} in templates. */
  variable: string;
  type: ColumnType;
  empty: number;
  unique: number;
  sample: string[];
}

export interface DatasetProfile {
  columns: ColumnProfile[];
  records: Array<Record<string, string>>;
  issues: {
    duplicateRows: number[]; // 1-based data row numbers that repeat an earlier row
    emptyCells: number;
    /** Column whose values are all unique and non-empty (a natural key), if any. */
    keyColumn: string | null;
  };
}

function inferType(values: string[]): ColumnType {
  const v = values.filter(Boolean);
  if (!v.length) return 'text';
  if (v.every(x => /^-?\d+([.,]\d+)?$/.test(x))) return 'number';
  if (v.every(x => /^(true|false|sí|si|no|yes)$/i.test(x))) return 'boolean';
  if (v.every(x => /^https?:\/\/\S+$/i.test(x))) return 'url';
  if (v.every(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return 'email';
  if (v.every(x => /^\d{4}-\d{2}-\d{2}/.test(x) && !isNaN(Date.parse(x)))) return 'date';
  return 'text';
}

/** Turns "Precio (MXN)" into "precio_mxn" so it can be used as {{precio_mxn}}. */
export function toVariableName(header: string): string {
  return (
    header
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'col'
  );
}

export function profileCsv(text: string, limits?: CsvLimits): DatasetProfile & { delimiter: string } {
  const { header, rows, delimiter } = parseCsv(text, limits);
  const vars = header.map(toVariableName);
  const clash = vars.filter((v, i) => vars.indexOf(v) !== i);
  if (clash.length) throw new CsvError(`Columns map to the same variable name: ${[...new Set(clash)].join(', ')}`, 1);
  const records = rows.map(r => Object.fromEntries(r.map((cell, i) => [vars[i], cell.trim()])));
  const seen = new Map<string, number>();
  const duplicateRows: number[] = [];
  records.forEach((r, i) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) duplicateRows.push(i + 1);
    else seen.set(k, i);
  });
  const columns: ColumnProfile[] = header.map((name, i) => {
    const values = records.map(r => r[vars[i]]);
    return { name, variable: vars[i], type: inferType(values), empty: values.filter(v => !v).length, unique: new Set(values).size, sample: [...new Set(values.filter(Boolean))].slice(0, 3) };
  });
  const keyColumn = columns.find(c => c.empty === 0 && c.unique === records.length && records.length > 0)?.variable ?? null;
  return { columns, records, delimiter, issues: { duplicateRows, emptyCells: columns.reduce((a, c) => a + c.empty, 0), keyColumn } };
}
