# Commaflow CSV

Streaming RFC-4180 CSV toolkit CLI: parse quoted fields across newlines, infer column types, select and filter columns, convert to JSON, NDJSON, or aligned tables.

## Features

- Streaming parse (large files without loading everything into memory)
- Quoted fields and multiline values per RFC-4180
- Column type inference
- Select / filter columns
- Output: JSON, NDJSON, or aligned tables

## Run

```bash
npm install
npm run build
# see package.json for CLI entry / bin name
npm test
```

## License

MIT
