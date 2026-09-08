/** Candidate delimiters in order of preference (ties go to the earlier one). */
export const CANDIDATES = [',', '\t', ';', '|'] as const;

/**
 * Field count of each complete line in `sample` for a given delimiter, ignoring
 * delimiters and newlines inside double quotes. A trailing partial line is only
 * counted when it is the sole line in the sample.
 */
function fieldCounts(sample: string, delim: string, maxLines: number): number[] {
  const counts: number[] = [];
  let inQuote = false;
  let count = 1;
  let sawContent = false;
  for (let i = 0; i < sample.length && counts.length < maxLines; i++) {
    const ch = sample[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote) {
      if (ch === delim) count++;
      else if (ch === '\n') {
        if (sawContent) counts.push(count);
        count = 1;
        sawContent = false;
        continue;
      } else if (ch === '\r') continue;
    }
    sawContent = true;
  }
  if (counts.length === 0 && sawContent) counts.push(count);
  return counts;
}

function mode(values: number[]): number {
  const freq = new Map<number, number>();
  let best = values[0] ?? 0;
  let bestFreq = 0;
  for (const v of values) {
    const f = (freq.get(v) ?? 0) + 1;
    freq.set(v, f);
    if (f > bestFreq || (f === bestFreq && v > best)) {
      best = v;
      bestFreq = f;
    }
  }
  return best;
}

/**
 * Pick the delimiter whose per-line field counts are most consistent across the
 * first `maxLines` lines; ties prefer more fields per line, then CANDIDATES order.
 * Falls back to a comma when nothing splits the sample.
 */
export function detectDelimiter(sample: string, maxLines = 20): string {
  let best = ',';
  let bestScore = -1;
  for (const delim of CANDIDATES) {
    const counts = fieldCounts(sample, delim, maxLines);
    if (counts.length === 0) continue;
    const m = mode(counts);
    if (m < 2) continue; // delimiter never appears on a typical line
    let agree = 0;
    for (const c of counts) if (c === m) agree++;
    const score = (agree / counts.length) * 1000 + m;
    if (score > bestScore) {
      best = delim;
      bestScore = score;
    }
  }
  return best;
}
