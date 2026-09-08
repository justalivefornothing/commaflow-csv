import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { CsvParser, type ParseOptions } from './parser.js';
import { detectDelimiter } from './delimiter.js';

/**
 * Yield decoded text chunks from a file or stdin. The decoder is incremental, so
 * a multi-byte UTF-8 sequence split across two reads is reassembled correctly.
 */
export async function* readChunks(path: string | undefined, highWaterMark = 256 * 1024): AsyncGenerator<string> {
  const source = path && path !== '-' ? createReadStream(path, { highWaterMark }) : process.stdin;
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true }); // the parser handles the BOM
  for await (const buf of source) yield decoder.decode(buf as Uint8Array, { stream: true });
  const tail = decoder.decode();
  if (tail) yield tail;
}

/** Buffered writer that honours stream backpressure between input chunks. */
export class Out {
  private parts: string[] = [];

  constructor(private readonly stream: NodeJS.WritableStream) {}

  push(text: string): void {
    this.parts.push(text);
  }

  async flush(): Promise<void> {
    if (this.parts.length === 0) return;
    const text = this.parts.join('');
    this.parts = [];
    if (!this.stream.write(text)) await once(this.stream, 'drain');
  }
}

export interface Sink {
  header(columns: string[]): void;
  row(row: string[], rowNumber: number): void;
  /** `truncated` is true when reading stopped early because of --limit. */
  end(truncated: boolean): void;
}

export interface PumpOptions extends ParseOptions {
  /** First record is a header (default true). Otherwise columns are named c1..cN. */
  hasHeader: boolean;
  /** Stop after this many data rows; 0 means all. */
  limit: number;
}

/**
 * Drive chunks through the parser and into a sink, flushing output after each
 * input chunk. Stops reading (and closes the file) as soon as the limit is hit.
 */
export async function pump(chunks: AsyncIterable<string>, opts: PumpOptions, sink: Sink, out: Out): Promise<void> {
  let header: string[] | null = null;
  let delivered = 0;
  let stop = false;

  const onRow = (row: string[], rowNumber: number): void => {
    if (stop) return;
    if (header === null) {
      header = opts.hasHeader ? row : row.map((_, i) => `c${i + 1}`);
      sink.header(header);
      if (opts.hasHeader) return;
    }
    if (opts.limit > 0 && delivered >= opts.limit) {
      stop = true;
      return;
    }
    delivered++;
    sink.row(row, rowNumber);
  };

  let parser: CsvParser | null = null;
  for await (const chunk of chunks) {
    if (parser === null) {
      const delimiter = opts.delimiter ?? detectDelimiter(chunk);
      parser = new CsvParser({ delimiter, strict: opts.strict, onRow });
    }
    parser.feed(chunk);
    await out.flush();
    if (stop) break;
  }
  if (!stop) parser?.end();
  sink.end(stop);
  await out.flush();
}
