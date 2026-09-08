# Commaflow — plan

A streaming RFC-4180 CSV toolkit CLI: parse quoted fields across newlines, infer
column types, select and filter columns, and convert to JSON, NDJSON, or aligned
tables.

## Goal

Pipe a 200 MB CSV with embedded quotes and multi-line fields through the tool and
get a column-type summary and an aligned preview instantly, with flat memory,
because the parser is a true chunk-streaming state machine that never sees the
whole file.

## Features

- State-machine parser: quoted fields, doubled-quote escapes, embedded commas,
  CRLF/LF (and lone CR) newlines inside quotes, leading BOM
- Streams stdin or a file chunk by chunk; partial state carries across chunks
- Subcommands: `head`, `select` (by name or index), `filter --where col=value`,
  `stats` (type inference, null counts, min/max), `to-json`, `to-ndjson`, `table`
- Delimiter auto-detection (comma, tab, semicolon, pipe) from the first chunk,
  `--delimiter` override
- `--strict` reports row number and column on ragged rows or unterminated quotes
  and exits with code 2
- Type inference: int, float, bool, ISO date, string, with a per-column
  confidence (share of non-null values that conform)
- Aligned table output with truncation and unicode-width-aware padding
- `bin` entry, `--help`, `--version`, ANSI colors that respect `NO_COLOR`

## Architecture

```
stdin / fs.createReadStream  ──chunks──▶  CsvParser (DFA)  ──rows──▶  transforms  ──▶  sink
        (async iteration)               FieldStart            select / filter       csv
        TextDecoder(stream)             Unquoted                                    json array
                                        Quoted                                      ndjson
                                        QuoteInQuoted                               table buffer
                                        RecordEnd                                   stats aggregates
```

- `src/parser.ts` — `CsvParser` with `feed(chunk)` / `end()`, `parseAll`,
  `parseStrict`, `chunked`; `CsvError` carries row + column
- `src/delimiter.ts` — scores candidate delimiters by field-count consistency
- `src/infer.ts` — regex-free value classifier and `TypeVote` aggregator
- `src/stats.ts` — per-column running aggregates (nulls, min/max, mean)
- `src/transforms.ts` — column resolution, `select`, `--where` conditions
- `src/format.ts` — CSV quoting, JSON/NDJSON writers, aligned table renderer
- `src/width.ts` — East-Asian-width-aware string width, pad, truncate
- `src/color.ts` — ANSI helpers honoring `NO_COLOR` / `FORCE_COLOR`
- `src/args.ts` — hand-written option parser and help renderer
- `src/cli.ts` — subcommand dispatch, streaming pump with backpressure

## Milestones

1. Plan, license, scaffold (TypeScript, vitest, tsc build)
2. Core parser + delimiter detection + type inference with unit tests
3. Streaming pump, CLI skeleton, `head` / `select` / `filter`
4. `stats`, `to-json`, `to-ndjson`, `table` with unicode widths and colors
5. CLI tests through the built binary on fixtures, README, publish
