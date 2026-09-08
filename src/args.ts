/**
 * Hand-rolled option parser: --long, --long=value, -s, -svalue, repeatable
 * options, `--` to end option parsing, and `-` as a positional (stdin).
 */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface OptionSpec {
  long: string;
  short?: string;
  /** Placeholder shown in help; its presence means the option takes a value. */
  value?: string;
  repeatable?: boolean;
  help: string;
}

export type OptionValue = string | string[] | true;

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, OptionValue>;
}

export function parseArgs(argv: readonly string[], specs: readonly OptionSpec[]): ParsedArgs {
  const byLong = new Map(specs.map((s) => [s.long, s]));
  const byShort = new Map(specs.filter((s) => s.short).map((s) => [s.short!, s]));
  const options: Record<string, OptionValue> = {};
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (onlyPositionals || arg === '-' || !arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      onlyPositionals = true;
      continue;
    }

    let spec: OptionSpec | undefined;
    let inline: string | undefined;
    let shown: string;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
      if (eq >= 0) inline = arg.slice(eq + 1);
      spec = byLong.get(name);
      shown = `--${name}`;
    } else {
      const ch = arg[1]!;
      spec = byShort.get(ch);
      if (arg.length > 2) inline = arg.slice(2);
      shown = `-${ch}`;
    }
    if (!spec) throw new UsageError(`Unknown option ${shown}. Try --help.`);

    if (spec.value) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new UsageError(`Option ${shown} requires a value <${spec.value}>.`);
      if (spec.repeatable) {
        const list = (options[spec.long] ??= []) as string[];
        list.push(value);
      } else {
        options[spec.long] = value;
      }
    } else {
      if (inline !== undefined) throw new UsageError(`Option ${shown} does not take a value.`);
      options[spec.long] = true;
    }
  }
  return { positionals, options };
}

/** Render `  -s, --long <value>  help` rows with aligned descriptions. */
export function formatOptions(specs: readonly OptionSpec[], paint: (s: string) => string = (s) => s): string {
  const left = specs.map((s) => {
    const short = s.short ? `-${s.short}, ` : '    ';
    return `${short}--${s.long}${s.value ? ` <${s.value}>` : ''}`;
  });
  const width = Math.max(...left.map((l) => l.length));
  return specs.map((s, i) => `  ${paint(left[i]!.padEnd(width))}  ${s.help}`).join('\n');
}
