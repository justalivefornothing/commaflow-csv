/**
 * Regex-free value classification and per-column type voting.
 */

export type ValueType = 'null' | 'int' | 'float' | 'bool' | 'date' | 'string';

export const VALUE_TYPES: readonly ValueType[] = ['null', 'int', 'float', 'bool', 'date', 'string'];

const NULL_TOKENS = new Set(['', 'null', 'NULL', 'Null', 'NA', 'N/A', 'nan', 'NaN']);

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function digits(s: string, start: number, len: number): boolean {
  if (start + len > s.length) return false;
  for (let i = start; i < start + len; i++) if (!isDigit(s.charCodeAt(i))) return false;
  return true;
}

function classifyNumber(s: string): 'int' | 'float' | null {
  const n = s.length;
  let i = 0;
  if (s[0] === '-' || s[0] === '+') i++;
  const intStart = i;
  while (i < n && isDigit(s.charCodeAt(i))) i++;
  const intDigits = i - intStart;
  let isFloat = false;
  let fracDigits = 0;
  if (i < n && s[i] === '.') {
    isFloat = true;
    i++;
    const fracStart = i;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    fracDigits = i - fracStart;
  }
  if (intDigits + fracDigits === 0) return null;
  if (i < n && (s[i] === 'e' || s[i] === 'E')) {
    isFloat = true;
    i++;
    if (i < n && (s[i] === '-' || s[i] === '+')) i++;
    const expStart = i;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    if (i === expStart) return null;
  }
  if (i !== n) return null;
  // "007" or "02134" are identifiers (zip codes, ids), not integers.
  if (!isFloat && intDigits > 1 && s.charCodeAt(intStart) === 0x30) return null;
  return isFloat ? 'float' : 'int';
}

/** ISO 8601: YYYY-MM-DD, optionally followed by T/space, HH:MM[:SS[.fff]], and Z or ±HH:MM. */
function isIsoDate(s: string): boolean {
  if (s.length < 10) return false;
  if (!digits(s, 0, 4) || s[4] !== '-' || !digits(s, 5, 2) || s[7] !== '-' || !digits(s, 8, 2)) {
    return false;
  }
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (s.length === 10) return true;

  let i = 10;
  if (s[i] !== 'T' && s[i] !== ' ') return false;
  i++;
  if (!digits(s, i, 2) || s[i + 2] !== ':' || !digits(s, i + 3, 2)) return false;
  i += 5;
  if (s[i] === ':') {
    if (!digits(s, i + 1, 2)) return false;
    i += 3;
    if (s[i] === '.') {
      i++;
      const fracStart = i;
      while (i < s.length && isDigit(s.charCodeAt(i))) i++;
      if (i === fracStart) return false;
    }
  }
  if (i === s.length) return true;
  if (s[i] === 'Z') return i + 1 === s.length;
  if (s[i] === '+' || s[i] === '-') {
    return digits(s, i + 1, 2) && s[i + 3] === ':' && digits(s, i + 4, 2) && i + 6 === s.length;
  }
  return false;
}

/** Classify a single raw cell value. */
export function classify(raw: string): ValueType {
  const s = raw.trim();
  if (NULL_TOKENS.has(s)) return 'null';
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'false') return 'bool';
  const num = classifyNumber(s);
  if (num) return num;
  if (isIsoDate(s)) return 'date';
  return 'string';
}

/** Convert a cell to its natural JSON value based on its classification. */
export function coerce(raw: string): string | number | boolean | null {
  switch (classify(raw)) {
    case 'null':
      return null;
    case 'int':
    case 'float':
      return Number(raw.trim());
    case 'bool':
      return raw.trim().toLowerCase() === 'true';
    default:
      return raw;
  }
}

export interface TypeResult {
  type: ValueType;
  /** Share of non-null values that conform to `type` (1 when unanimous). */
  confidence: number;
}

/**
 * Running vote counter for one column. The winning type is the family with the
 * most votes; ints and floats share a family and promote to float when mixed.
 */
export class TypeVote {
  readonly counts: Record<ValueType, number> = { null: 0, int: 0, float: 0, bool: 0, date: 0, string: 0 };
  total = 0;

  add(value: string): ValueType {
    const t = classify(value);
    this.counts[t]++;
    this.total++;
    return t;
  }

  result(): TypeResult {
    const c = this.counts;
    const nonNull = this.total - c.null;
    if (nonNull === 0) return { type: 'null', confidence: 1 };
    const families: Array<[ValueType, number]> = [
      [c.float > 0 ? 'float' : 'int', c.int + c.float],
      ['bool', c.bool],
      ['date', c.date],
      ['string', c.string],
    ];
    let best = families[0]!;
    for (const f of families) if (f[1] > best[1]) best = f;
    // Every value is a valid string, so a string column is always fully conformant.
    const confidence = best[0] === 'string' ? 1 : best[1] / nonNull;
    return { type: best[0], confidence };
  }
}

/** Infer one type per column from a sample of rows (no header row expected). */
export function inferTypes(rows: string[][]): ValueType[] {
  return inferColumns(rows).map((r) => r.type);
}

export function inferColumns(rows: string[][]): TypeResult[] {
  const votes: TypeVote[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      (votes[i] ??= new TypeVote()).add(row[i]!);
    }
  }
  return votes.map((v) => v.result());
}
