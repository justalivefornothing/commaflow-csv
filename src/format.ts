import { c } from './color.js';
import { coerce, inferTypes } from './infer.js';
import { pad, stringWidth, truncate } from './width.js';

/** Serialize one record per RFC 4180, quoting only when necessary. */
export function csvRow(row: readonly string[], delimiter = ','): string {
  return row
    .map((field) => {
      const needsQuote =
        field.includes(delimiter) ||
        field.includes('"') ||
        field.includes('\n') ||
        field.includes('\r') ||
        field.startsWith(' ') ||
        field.endsWith(' ');
      return needsQuote ? `"${field.replaceAll('"', '""')}"` : field;
    })
    .join(delimiter);
}

/** Zip a header and a row into an object; `typed` coerces numbers, booleans and nulls. */
export function toObject(header: readonly string[], row: readonly string[], typed: boolean): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const n = Math.max(header.length, row.length);
  for (let i = 0; i < n; i++) {
    const key = header[i] ?? `c${i + 1}`;
    const cell = row[i] ?? '';
    obj[key] = typed ? coerce(cell) : cell;
  }
  return obj;
}

export interface TableOptions {
  /** Truncate cells wider than this many columns; 0 disables. */
  maxWidth: number;
  /** Right-align columns that look numeric. */
  alignNumbers?: boolean;
}

function displayCell(s: string, maxWidth: number): string {
  const flat = s.replaceAll('\r\n', '↵').replaceAll('\n', '↵').replaceAll('\r', '↵').replaceAll('\t', '  ');
  return truncate(flat, maxWidth);
}

/**
 * Render rows as an aligned table. Widths are measured in terminal columns so
 * CJK and emoji cells line up; numeric columns are right-aligned.
 */
export function renderTable(header: readonly string[], rows: readonly string[][], opts: TableOptions): string {
  let ncol = header.length;
  for (const r of rows) if (r.length > ncol) ncol = r.length;
  if (ncol === 0) return '';

  const cells = (r: readonly string[]): string[] => {
    const out: string[] = new Array(ncol);
    for (let i = 0; i < ncol; i++) out[i] = displayCell(r[i] ?? '', opts.maxWidth);
    return out;
  };
  const head = cells(header);
  const body = rows.map(cells);
  const types = opts.alignNumbers === false ? [] : inferTypes(rows as string[][]);

  const widths = head.map((h) => stringWidth(h));
  for (const r of body) {
    for (let i = 0; i < ncol; i++) {
      const w = stringWidth(r[i]!);
      if (w > widths[i]!) widths[i] = w;
    }
  }

  const line = (r: string[], paint: (s: string) => string): string =>
    r
      .map((cell, i) => {
        const align = types[i] === 'int' || types[i] === 'float' ? 'right' : 'left';
        const last = i === ncol - 1 && align === 'left'; // no trailing padding
        return paint(last ? cell : pad(cell, widths[i]!, align));
      })
      .join('  ');

  const out = [line(head, c.bold), c.dim(widths.map((w) => '─'.repeat(w)).join('  '))];
  for (const r of body) out.push(line(r, (s) => s));
  return out.join('\n') + '\n';
}
