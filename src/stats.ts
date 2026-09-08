import { TypeVote, type ValueType } from './infer.js';

export interface ColumnSummary {
  name: string;
  type: ValueType;
  confidence: number;
  count: number;
  nulls: number;
  min: string | null;
  max: string | null;
  mean: number | null;
}

/** Running aggregates for one column; O(1) memory per column regardless of row count. */
export class ColumnStats {
  private readonly vote = new TypeVote();
  private count = 0;
  private nulls = 0;
  private numMin = Infinity;
  private numMax = -Infinity;
  private sum = 0;
  private numCount = 0;
  private strMin: string | null = null;
  private strMax: string | null = null;

  constructor(readonly name: string) {}

  add(raw: string): void {
    this.count++;
    const type = this.vote.add(raw);
    if (type === 'null') {
      this.nulls++;
      return;
    }
    if (type === 'int' || type === 'float') {
      const n = Number(raw.trim());
      if (n < this.numMin) this.numMin = n;
      if (n > this.numMax) this.numMax = n;
      this.sum += n;
      this.numCount++;
    } else {
      if (this.strMin === null || raw < this.strMin) this.strMin = raw;
      if (this.strMax === null || raw > this.strMax) this.strMax = raw;
    }
  }

  summary(): ColumnSummary {
    const { type, confidence } = this.vote.result();
    const numeric = type === 'int' || type === 'float';
    return {
      name: this.name,
      type,
      confidence,
      count: this.count,
      nulls: this.nulls,
      min: numeric ? (this.numCount ? formatNumber(this.numMin) : null) : this.strMin,
      max: numeric ? (this.numCount ? formatNumber(this.numMax) : null) : this.strMax,
      mean: numeric && this.numCount ? this.sum / this.numCount : null,
    };
  }
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  let s = n.toFixed(digits);
  while (s.endsWith('0')) s = s.slice(0, -1);
  return s.endsWith('.') ? s.slice(0, -1) : s;
}
