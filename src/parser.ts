/**
 * A push-style RFC-4180 parser. Feed it string chunks of any size; it runs a
 * five-state DFA and emits complete rows through a callback. All partial state
 * (current field, current row, DFA state) lives on the instance, so a quoted
 * field or a CRLF pair may be split across chunk boundaries freely.
 *
 *   FieldStart ──'"'──▶ Quoted ──'"'──▶ QuoteInQuoted ──'"'──▶ Quoted
 *       │                                    │ delim / newline
 *       │ other                              ▼
 *       ▼                              FieldStart / RecordEnd
 *   Unquoted ──delim──▶ FieldStart
 *       │ '\r'                    RecordEnd ──'\n'──▶ FieldStart (consumed)
 *       ▼                                   ──other──▶ FieldStart (reprocessed)
 *   RecordEnd
 */

const FIELD_START = 0;
const UNQUOTED = 1;
const QUOTED = 2;
const QUOTE_IN_QUOTED = 3;
const RECORD_END = 4;
type State = 0 | 1 | 2 | 3 | 4;

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
const BOM = 0xfeff;

export class CsvError extends Error {
  constructor(
    message: string,
    readonly row: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

export interface ParseOptions {
  /** Single-character field delimiter. Default: comma. */
  delimiter?: string;
  /** Throw a CsvError on ragged rows, stray quotes, or unterminated quotes. */
  strict?: boolean;
}

export interface ParserOptions extends ParseOptions {
  /** Called once per complete record. `rowNumber` is 1-based and counts the header. */
  onRow: (row: string[], rowNumber: number) => void;
}

export class CsvParser {
  private readonly delim: number;
  private readonly strict: boolean;
  private readonly onRow: ParserOptions['onRow'];

  private state: State = FIELD_START;
  private field = '';
  private row: string[] = [];
  private rows = 0;
  private width = -1;
  private first = true;

  constructor(opts: ParserOptions) {
    const d = opts.delimiter ?? ',';
    if (d.length !== 1 || d === '"' || d === '\n' || d === '\r') {
      throw new RangeError(`Invalid delimiter ${JSON.stringify(d)}`);
    }
    this.delim = d.charCodeAt(0);
    this.strict = opts.strict ?? false;
    this.onRow = opts.onRow;
  }

  /** Number of records emitted so far. */
  get rowCount(): number {
    return this.rows;
  }

  feed(chunk: string): void {
    const n = chunk.length;
    const delim = this.delim;
    let i = 0;
    if (this.first) {
      this.first = false;
      if (n > 0 && chunk.charCodeAt(0) === BOM) i = 1;
    }

    while (i < n) {
      const c = chunk.charCodeAt(i);
      switch (this.state) {
        case FIELD_START:
          if (c === QUOTE) {
            this.state = QUOTED;
          } else if (c === delim) {
            this.row.push('');
          } else if (c === LF || c === CR) {
            // Blank line: skip. Otherwise the record ends on an empty field.
            if (this.row.length > 0) {
              this.row.push('');
              this.emit();
            }
            this.state = c === CR ? RECORD_END : FIELD_START;
          } else {
            this.state = UNQUOTED;
            continue; // reprocess c as the first char of an unquoted field
          }
          i++;
          break;

        case UNQUOTED: {
          let j = i;
          while (j < n) {
            const d = chunk.charCodeAt(j);
            if (d === delim || d === LF || d === CR || d === QUOTE) break;
            j++;
          }
          this.field += chunk.slice(i, j);
          i = j;
          if (i === n) break; // chunk ended mid-field; stay Unquoted
          const d = chunk.charCodeAt(i);
          if (d === QUOTE) {
            if (this.strict) this.fail('unexpected quote inside unquoted field');
            this.field += '"';
          } else {
            this.terminate(d);
          }
          i++;
          break;
        }

        case QUOTED: {
          let j = i;
          while (j < n && chunk.charCodeAt(j) !== QUOTE) j++;
          this.field += chunk.slice(i, j);
          i = j;
          if (i === n) break; // quote still open across the chunk boundary
          this.state = QUOTE_IN_QUOTED;
          i++;
          break;
        }

        case QUOTE_IN_QUOTED:
          if (c === QUOTE) {
            this.field += '"'; // doubled quote escape
            this.state = QUOTED;
          } else if (c === delim || c === LF || c === CR) {
            this.terminate(c);
          } else {
            if (this.strict) {
              this.fail(`unexpected character ${JSON.stringify(chunk[i])} after closing quote`);
            }
            this.field += chunk[i];
            this.state = UNQUOTED;
          }
          i++;
          break;

        case RECORD_END:
          this.state = FIELD_START;
          if (c === LF) i++; // the \n of a \r\n pair; a lone \r is reprocessed
          break;
      }
    }
  }

  /** Flush the final record (input without a trailing newline) and validate. */
  end(): void {
    switch (this.state) {
      case QUOTED:
        if (this.strict) this.fail('unterminated quoted field at end of input');
        this.row.push(this.field);
        this.emit();
        break;
      case UNQUOTED:
      case QUOTE_IN_QUOTED:
        this.row.push(this.field);
        this.emit();
        break;
      case FIELD_START:
        if (this.row.length > 0) {
          this.row.push('');
          this.emit();
        }
        break;
      case RECORD_END:
        break;
    }
    this.field = '';
    this.state = FIELD_START;
  }

  private terminate(c: number): void {
    this.row.push(this.field);
    this.field = '';
    if (c === this.delim) {
      this.state = FIELD_START;
      return;
    }
    this.emit();
    this.state = c === CR ? RECORD_END : FIELD_START;
  }

  private emit(): void {
    const row = this.row;
    this.row = [];
    this.rows++;
    if (this.strict) {
      if (this.width < 0) this.width = row.length;
      else if (row.length !== this.width) {
        throw new CsvError(
          `Row ${this.rows}: expected ${this.width} fields, got ${row.length}`,
          this.rows,
          row.length,
        );
      }
    }
    this.onRow(row, this.rows);
  }

  private fail(message: string): never {
    const row = this.rows + 1;
    const column = this.row.length + 1;
    throw new CsvError(`Row ${row}, column ${column}: ${message}`, row, column);
  }
}

/** Parse a complete string into rows. */
export function parseAll(text: string, opts: ParseOptions = {}): string[][] {
  return chunked(text, text.length || 1, opts);
}

/** Parse a complete string, throwing CsvError on any structural problem. */
export function parseStrict(text: string, opts: ParseOptions = {}): string[][] {
  return parseAll(text, { ...opts, strict: true });
}

/** Parse a string by feeding it in fixed-size pieces (exercises boundary carry-over). */
export function chunked(text: string, size: number, opts: ParseOptions = {}): string[][] {
  const rows: string[][] = [];
  const parser = new CsvParser({ ...opts, onRow: (r) => rows.push(r) });
  for (let i = 0; i < text.length; i += size) parser.feed(text.slice(i, i + size));
  parser.end();
  return rows;
}
