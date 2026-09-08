/**
 * Minimal ANSI styling. Colors are on when stdout is a TTY, forced on by
 * FORCE_COLOR or --color, and always off when NO_COLOR is set (no-color.org).
 */

let enabled = detectColor();

export function detectColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

export function setColor(on: boolean): void {
  enabled = on;
}

export function colorEnabled(): boolean {
  return enabled;
}

const style =
  (open: number, close: number) =>
  (s: string): string =>
    enabled && s !== '' ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const c = {
  bold: style(1, 22),
  dim: style(2, 22),
  red: style(31, 39),
  green: style(32, 39),
  yellow: style(33, 39),
  magenta: style(35, 39),
  cyan: style(36, 39),
};

/** Strip ANSI escape sequences (used when measuring styled text). */
export function stripAnsi(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x1b && s[i + 1] === '[') {
      let j = i + 2;
      while (j < s.length && s[j] !== 'm') j++;
      i = j;
      continue;
    }
    out += s[i];
  }
  return out;
}
