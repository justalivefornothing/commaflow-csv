import { UsageError } from './args.js';
import { classify } from './infer.js';

/**
 * Resolve a column reference: an exact header name first, then a 1-based index.
 */
export function resolveColumn(ref: string, header: string[]): number {
  const byName = header.indexOf(ref);
  if (byName >= 0) return byName;
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 1 && n <= header.length) return n - 1;
  const known = header.map((h, i) => `${i + 1}:${h}`).join(', ');
  throw new UsageError(`Unknown column "${ref}". Columns are ${known}.`);
}

/**
 * Parse a select spec like `name,3,5-7` into 0-based indices, in order.
 * Ranges use 1-based inclusive indices; names win over numbers on conflict.
 */
export function resolveColumns(spec: string, header: string[]): number[] {
  const out: number[] = [];
  for (const raw of spec.split(',')) {
    const token = raw.trim();
    if (token === '') continue;
    const dash = token.indexOf('-');
    if (dash > 0 && !header.includes(token)) {
      const lo = Number(token.slice(0, dash));
      const hi = Number(token.slice(dash + 1));
      if (Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi >= lo && hi <= header.length) {
        for (let i = lo; i <= hi; i++) out.push(i - 1);
        continue;
      }
    }
    out.push(resolveColumn(token, header));
  }
  if (out.length === 0) throw new UsageError('select needs at least one column, e.g. select name,2');
  return out;
}

export function pick(row: readonly string[], indices: readonly number[]): string[] {
  return indices.map((i) => row[i] ?? '');
}

export type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~';

export interface Condition {
  column: string;
  op: Operator;
  value: string;
}

const OPERATORS: readonly Operator[] = ['!=', '>=', '<=', '=', '>', '<', '~'];

/** Parse `col=value`, `col!=value`, `col>10`, `col<=10`, `col~substring`. */
export function parseCondition(expr: string): Condition {
  for (let i = 0; i < expr.length; i++) {
    for (const op of OPERATORS) {
      if (expr.startsWith(op, i)) {
        const column = expr.slice(0, i).trim();
        if (column === '') break;
        return { column, op, value: expr.slice(i + op.length).trim() };
      }
    }
  }
  throw new UsageError(`Cannot parse condition "${expr}". Use col=value, col!=value, col>n, col<=n or col~text.`);
}

function isNumeric(s: string): boolean {
  const t = classify(s);
  return t === 'int' || t === 'float';
}

/** Compare cell against literal: numerically when both sides are numbers, else as text. */
export function matches(cell: string, cond: Condition): boolean {
  const { op, value } = cond;
  if (op === '~') return cell.toLowerCase().includes(value.toLowerCase());
  if (op === '=') return cell === value || (isNumeric(cell) && isNumeric(value) && Number(cell) === Number(value));
  if (op === '!=') return !matches(cell, { ...cond, op: '=' });
  const numeric = isNumeric(cell) && isNumeric(value);
  const cmp = numeric ? Number(cell) - Number(value) : cell < value ? -1 : cell > value ? 1 : 0;
  switch (op) {
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
  }
}

/** Build a row predicate from conditions (all must hold). */
export function makeFilter(conds: readonly Condition[], header: string[]): (row: string[]) => boolean {
  const bound = conds.map((cond) => ({ cond, index: resolveColumn(cond.column, header) }));
  return (row) => bound.every(({ cond, index }) => matches(row[index] ?? '', cond));
}
