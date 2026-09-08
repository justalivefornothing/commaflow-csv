#!/usr/bin/env node
import { createRequire } from 'node:module';
import { formatOptions, parseArgs, UsageError, type OptionSpec } from './args.js';
import { c, setColor } from './color.js';
import { csvRow, renderTable, toObject } from './format.js';
import { Out, pump, readChunks, type PumpOptions, type Sink } from './io.js';
import { CsvError } from './parser.js';
import { ColumnStats, formatNumber, type ColumnSummary } from './stats.js';
import { makeFilter, parseCondition, pick, resolveColumns } from './transforms.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const COMMANDS: ReadonlyArray<[string, string]> = [
  ['head', 'Print the first rows as CSV (default 10)'],
  ['select', 'Keep columns by name, 1-based index or range: select id,name,4-6'],
  ['filter', 'Keep rows matching every --where condition'],
  ['stats', 'Per-column type, confidence, nulls, min, max, mean'],
  ['to-json', 'Convert to a JSON array of objects (streamed)'],
  ['to-ndjson', 'Convert to newline-delimited JSON'],
  ['table', 'Render an aligned preview table (default 20 rows)'],
];

const OPTIONS: readonly OptionSpec[] = [
  { long: 'delimiter', short: 'd', value: 'char', help: 'Field delimiter: , ; | tab (default: auto-detect)' },
  { long: 'limit', short: 'n', value: 'n', help: 'Stop after n data rows; 0 = all' },
  { long: 'where', short: 'w', value: 'expr', repeatable: true, help: 'filter: col=v col!=v col>n col<=n col~text' },
  { long: 'no-header', help: 'First row is data; columns become c1..cN' },
  { long: 'strict', help: 'Fail on ragged rows or unterminated quotes (exit 2)' },
  { long: 'typed', help: 'to-json/to-ndjson: emit numbers, booleans and nulls' },
  { long: 'max-width', value: 'n', help: 'table: truncate cells wider than n (default 32)' },
  { long: 'json', help: 'stats: emit JSON instead of a table' },
  { long: 'color', help: 'Force colors on (NO_COLOR is honoured otherwise)' },
  { long: 'no-color', help: 'Force colors off' },
  { long: 'help', short: 'h', help: 'Show this help' },
  { long: 'version', short: 'V', help: 'Show version' },
];

function help(): string {
  const cmdWidth = Math.max(...COMMANDS.map(([name]) => name.length));
  const commands = COMMANDS.map(([name, desc]) => `  ${c.cyan(name.padEnd(cmdWidth))}  ${desc}`).join('\n');
  return [
    `${c.bold('Commaflow')} ${c.dim(`v${version}`)} — streaming RFC-4180 CSV toolkit`,
    '',
    `${c.bold('Usage:')} commaflow <command> [options] [file]`,
    '',
    'Reads <file> (or stdin when omitted or "-") chunk by chunk; memory stays flat',
    'no matter how large the input is.',
    '',
    c.bold('Commands:'),
    commands,
    '',
    c.bold('Options:'),
    formatOptions(OPTIONS, c.cyan),
    '',
    c.bold('Examples:'),
    `  commaflow stats sales.csv`,
    `  commaflow table -n 5 --max-width 20 sales.csv`,
    `  cat big.csv | commaflow filter -w "country=DE" -w "amount>100" | commaflow table`,
    `  commaflow select name,email users.csv | commaflow to-ndjson --typed`,
    '',
    `${c.bold('Exit codes:')} 0 ok · 1 usage or I/O error · 2 malformed CSV in --strict mode`,
    '',
  ].join('\n');
}

function parseDelimiter(raw: string): string {
  const named: Record<string, string> = { tab: '\t', '\\t': '\t', comma: ',', semicolon: ';', pipe: '|' };
  const d = named[raw.toLowerCase()] ?? raw;
  if (d.length !== 1) throw new UsageError(`--delimiter must be a single character or "tab", got "${raw}".`);
  return d;
}

function parseCount(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} expects a non-negative integer, got "${raw}".`);
  return n;
}

// ---- sinks -----------------------------------------------------------------

/** Emits CSV; optional column projection and row predicate factories bound to the header. */
function csvSink(
  out: Out,
  delimiter: string,
  bind: (header: string[]) => { indices?: number[]; keep?: (row: string[]) => boolean },
): Sink {
  let indices: number[] | undefined;
  let keep: ((row: string[]) => boolean) | undefined;
  return {
    header(h) {
      ({ indices, keep } = bind(h));
      out.push(csvRow(indices ? pick(h, indices) : h, delimiter) + '\n');
    },
    row(r) {
      if (keep && !keep(r)) return;
      out.push(csvRow(indices ? pick(r, indices) : r, delimiter) + '\n');
    },
    end() {},
  };
}

function jsonSink(out: Out, typed: boolean, ndjson: boolean): Sink {
  let header: string[] = [];
  let count = 0;
  return {
    header(h) {
      header = h;
    },
    row(r) {
      const json = JSON.stringify(toObject(header, r, typed));
      if (ndjson) out.push(json + '\n');
      else out.push((count === 0 ? '[\n  ' : ',\n  ') + json);
      count++;
    },
    end() {
      if (!ndjson) out.push(count === 0 ? '[]\n' : '\n]\n');
    },
  };
}

function tableSink(out: Out, maxWidth: number, limit: number): Sink {
  let header: string[] = [];
  const rows: string[][] = [];
  return {
    header(h) {
      header = h;
    },
    row(r) {
      rows.push(r);
    },
    end(truncated) {
      if (header.length === 0) {
        out.push(c.dim('(no data)') + '\n');
        return;
      }
      out.push(renderTable(header, rows, { maxWidth }));
      if (truncated) out.push(c.dim(`… first ${limit} rows shown; use -n 0 for all`) + '\n');
    },
  };
}

function statsSink(out: Out, asJson: boolean): Sink {
  let columns: ColumnStats[] = [];
  let rows = 0;
  return {
    header(h) {
      columns = h.map((name) => new ColumnStats(name));
    },
    row(r) {
      rows++;
      for (let i = 0; i < columns.length; i++) columns[i]!.add(r[i] ?? '');
    },
    end() {
      const summaries = columns.map((col) => col.summary());
      if (asJson) {
        out.push(JSON.stringify({ rows, columns: summaries }, null, 2) + '\n');
        return;
      }
      if (summaries.length === 0) {
        out.push(c.dim('(no data)') + '\n');
        return;
      }
      out.push(renderStats(summaries, rows));
    },
  };
}

const TYPE_COLOR: Record<ColumnSummary['type'], (s: string) => string> = {
  int: c.green,
  float: c.green,
  bool: c.yellow,
  date: c.magenta,
  string: (s) => s,
  null: c.dim,
};

function renderStats(summaries: ColumnSummary[], rows: number): string {
  const header = ['column', 'type', 'nulls', 'min', 'max', 'mean'];
  const body = summaries.map((s) => {
    const conf = s.confidence < 1 ? ` ${Math.round(s.confidence * 100)}%` : '';
    return [
      s.name,
      TYPE_COLOR[s.type](s.type) + (conf ? c.yellow(conf) : ''),
      s.nulls === 0 ? c.dim('0') : String(s.nulls),
      s.min ?? '',
      s.max ?? '',
      s.mean === null ? '' : formatNumber(s.mean),
    ];
  });
  const table = renderTable(header, body, { maxWidth: 24, alignNumbers: false });
  return `${table}${c.dim(`${rows} row${rows === 1 ? '' : 's'} · ${summaries.length} columns`)}\n`;
}

// ---- main ------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { positionals, options } = parseArgs(argv, OPTIONS);
  if (options['color']) setColor(true);
  if (options['no-color']) setColor(false);
  if (options['version']) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  const command = positionals[0];
  if (options['help'] || command === undefined) {
    process.stdout.write(help());
    return options['help'] ? 0 : 1; // bare invocation without a command is a usage error
  }
  if (!COMMANDS.some(([name]) => name === command)) {
    throw new UsageError(`Unknown command "${command}". Commands: ${COMMANDS.map(([n]) => n).join(', ')}.`);
  }

  // `select` takes a column spec before the optional file.
  const args = positionals.slice(1);
  const columnSpec = command === 'select' ? args.shift() : undefined;
  if (command === 'select' && !columnSpec) throw new UsageError('select needs a column list, e.g. select name,2,4-6');
  const file = args[0];
  if (args.length > 1) throw new UsageError(`Unexpected argument "${args[1]}".`);
  if (!file && process.stdin.isTTY) throw new UsageError('No input: pass a file path or pipe CSV to stdin.');

  const delimiter = options['delimiter'] ? parseDelimiter(options['delimiter'] as string) : undefined;
  const defaultLimit = command === 'head' ? 10 : command === 'table' ? 20 : 0;
  const limit = parseCount(options['limit'] as string | undefined, defaultLimit, '--limit');
  const maxWidth = parseCount(options['max-width'] as string | undefined, 32, '--max-width');
  const typed = Boolean(options['typed']);
  const where = ((options['where'] as string[] | undefined) ?? []).map(parseCondition);
  if (where.length && command !== 'filter') throw new UsageError('--where only applies to the filter command.');
  if (command === 'filter' && where.length === 0) throw new UsageError('filter needs at least one --where condition.');

  const out = new Out(process.stdout);
  const outDelim = delimiter ?? ',';
  let sink: Sink;
  switch (command) {
    case 'head':
      sink = csvSink(out, outDelim, () => ({}));
      break;
    case 'select':
      sink = csvSink(out, outDelim, (h) => ({ indices: resolveColumns(columnSpec!, h) }));
      break;
    case 'filter':
      sink = csvSink(out, outDelim, (h) => ({ keep: makeFilter(where, h) }));
      break;
    case 'stats':
      sink = statsSink(out, Boolean(options['json']));
      break;
    case 'to-json':
      sink = jsonSink(out, typed, false);
      break;
    case 'to-ndjson':
      sink = jsonSink(out, typed, true);
      break;
    default:
      sink = tableSink(out, maxWidth, limit);
  }

  const pumpOptions: PumpOptions = {
    strict: Boolean(options['strict']),
    hasHeader: !options['no-header'],
    limit,
    ...(delimiter ? { delimiter } : {}),
  };
  await pump(readChunks(file), pumpOptions, sink, out);
  return 0;
}

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0); // downstream closed early (e.g. `| head`)
  throw err;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof CsvError) {
      process.stderr.write(`${c.red('error:')} ${err.message}\n`);
      process.exitCode = 2;
    } else if (err instanceof UsageError) {
      process.stderr.write(`${c.red('error:')} ${err.message}\n`);
      process.exitCode = 1;
    } else if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      process.stderr.write(`${c.red('error:')} ${err.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`${c.red('error:')} ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  },
);
