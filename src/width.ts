/**
 * Terminal display width. Wide (East Asian W/F) and emoji code points take two
 * columns, combining marks and zero-width characters take none.
 */

const ZERO_WIDTH: ReadonlyArray<[number, number]> = [
  [0x0300, 0x036f], // combining diacritics
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x200b, 0x200f], // zero-width space, joiners, marks
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

const WIDE: ReadonlyArray<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK compat
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // misc symbols & pictographs, emoticons
  [0x1f680, 0x1f6ff], // transport
  [0x1f900, 0x1f9ff], // supplemental symbols
  [0x20000, 0x3fffd],
];

function inRanges(cp: number, ranges: ReadonlyArray<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

export function charWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // control
  if (cp < 0x300) return 1;
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Cut `s` down to at most `max` columns, ending in an ellipsis when truncated. */
export function truncate(s: string, max: number): string {
  if (max <= 0 || stringWidth(s) <= max) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

export function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const fill = ' '.repeat(Math.max(0, width - stringWidth(s)));
  return align === 'right' ? fill + s : s + fill;
}
