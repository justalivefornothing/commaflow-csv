# commaflow

Streaming RFC-4180 CSV toolkit for the command line. Input is read chunk by chunk, so memory stays flat no matter how large the file is.

Zero runtime dependencies. Ships as both a CLI (`src/cli.ts`) and a TypeScript library (`src/index.ts`).

## Install

Requires Node.js >= 20.

```bash
npm install
npm run build
```

This produces `dist/cli.js`, linked as the `commaflow` (and `commaflow-csv`) bin.

## Commands

| Command   | Purpose                                                              |
|-----------|----------------------------------------------------------------------|
| `head`    | Print the first rows as CSV (default 10)                              |
| `select`  | Keep columns by name, 1-based index, or range: `select id,name,4-6`  |
| `filter`  | Keep rows matching every `--where` condition                          |
| `stats`   | Per-column type, confidence, nulls, min, max, mean                    |
| `to-json` | Convert to a JSON array of objects (streamed)                         |
| `to-ndjson` | Convert to newline-delimited JSON                                   |
| `table`   | Render an aligned preview table (default 20 rows)                     |

## Options

| Option                   | Purpose                                                                        |
|--------------------------|--------------------------------------------------------------------------------|
| `-d, --delimiter <char>` | Field delimiter: `,` `;` `\|` `tab` (auto-detected by default)                 |
| `-n, --limit <n>`        | Stop after n data rows; 0 = all                                                 |
| `-w, --where <expr>`     | Filter condition, repeatable: `col=v`, `col!=v`, `col>n`, `col<=n`, `col~text` |
| `--no-header`            | First row is data; columns become `c1..cN`                                      |
| `--strict`               | Fail on ragged rows or unterminated quotes (exit 2)                             |
| `--typed`                | `to-json`/`to-ndjson`: emit numbers, booleans, and nulls                        |
| `--max-width <n>`        | `table`: truncate cells wider than n (default 32)                               |
| `--json`                 | `stats`: emit JSON instead of a table                                           |
| `--color` / `--no-color` | Force terminal colors on/off (`NO_COLOR` is honoured)                           |

## Examples

```bash
commaflow stats sales.csv
commaflow table -n 5 --max-width 20 sales.csv
cat big.csv | commaflow filter -w "country=DE" -w "amount>100" | commaflow table
commaflow select name,email users.csv | commaflow to-ndjson --typed
```

Reads from a file, or from stdin when the file is omitted or given as `-`.

## Parsing notes

- RFC-4180: quoted fields containing delimiters and newlines are handled correctly
- Delimiter auto-detection; ragged rows are tolerated unless `--strict` is set
- Exit codes: 0 ok · 1 usage or I/O error · 2 malformed CSV in `--strict` mode

## Development

```bash
npm test          # build + vitest suite (test/)
npm run typecheck
```

## License

MIT
