import { describe, expect, it } from 'vitest';
import { CsvError, CsvParser, chunked, parseAll, parseStrict } from '../src/parser.js';

describe('parseAll', () => {
  it('handles embedded commas and doubled-quote escapes', () => {
    expect(parseAll('a,b\n"x,1","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
    ]);
  });

  it('keeps newlines inside quoted fields and accepts CRLF records', () => {
    expect(parseAll('a,b\r\n"multi\nline",2\r\n')[1][0]).toBe('multi\nline');
  });

  it('strips a leading BOM', () => {
    expect(parseAll('\uFEFFid,name\n1,x\n')).toEqual([
      ['id', 'name'],
      ['1', 'x'],
    ]);
  });

  it('parses a final record without a trailing newline', () => {
    expect(parseAll('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseAll('a,b\n1,"2"')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('produces empty fields for adjacent and trailing delimiters', () => {
    expect(parseAll('a,,c\n,,\n1,2,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['1', '2', ''],
    ]);
  });

  it('skips blank lines and accepts lone CR line endings', () => {
    expect(parseAll('a,b\n\n\r\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseAll('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('is lenient about stray quotes when not strict', () => {
    expect(parseAll('5" tall,x\n"ab"c,y\n')).toEqual([
      ['5" tall', 'x'],
      ['abc', 'y'],
    ]);
  });

  it('supports alternative delimiters', () => {
    expect(parseAll('a\tb\n"1\t2"\t3\n', { delimiter: '\t' })).toEqual([
      ['a', 'b'],
      ['1\t2', '3'],
    ]);
    expect(() => new CsvParser({ delimiter: ',,', onRow: () => {} })).toThrow(RangeError);
  });

  it('returns no rows for empty input', () => {
    expect(parseAll('')).toEqual([]);
    expect(parseAll('\n\n')).toEqual([]);
  });
});

describe('parseStrict', () => {
  it('reports ragged rows with the row number', () => {
    expect(() => parseStrict('a,b\n1\n')).toThrow(/Row 2: expected 2 fields, got 1/);
  });

  it('reports unterminated quotes with row and column', () => {
    let err: unknown;
    try {
      parseStrict('a,b\n1,"open\n');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvError);
    const csvErr = err as CsvError;
    expect(csvErr.message).toBe('Row 2, column 2: unterminated quoted field at end of input');
    expect(csvErr.row).toBe(2);
    expect(csvErr.column).toBe(2);
  });

  it('rejects text after a closing quote and quotes inside unquoted fields', () => {
    expect(() => parseStrict('a,b\n"x"y,2\n')).toThrow(/Row 2, column 1: unexpected character "y"/);
    expect(() => parseStrict('a,b\n5" tall,2\n')).toThrow(/Row 2, column 1: unexpected quote/);
  });

  it('passes well-formed input through unchanged', () => {
    expect(parseStrict('a,b\r\n"1\r\n2",""""\r\n')).toEqual([
      ['a', 'b'],
      ['1\r\n2', '"'],
    ]);
  });
});

describe('chunked', () => {
  it('carries a quoted newline across a chunk boundary', () => {
    expect(chunked('a,"b\nc",d\n', 3)).toEqual([['a', 'b\nc', 'd']]);
  });

  it('gives identical results for every chunk size', () => {
    const text = '\uFEFFid,note,when\r\n1,"he said ""hi"",\r\nthen left",2024-01-02\r\n2,,\r\n"3","x"\r\n';
    const expected = parseAll(text);
    expect(expected).toEqual([
      ['id', 'note', 'when'],
      ['1', 'he said "hi",\r\nthen left', '2024-01-02'],
      ['2', '', ''],
      ['3', 'x'],
    ]);
    for (let size = 1; size <= text.length; size++) {
      expect(chunked(text, size), `chunk size ${size}`).toEqual(expected);
    }
  });

  it('exposes the running row count on the parser', () => {
    const rows: string[][] = [];
    const parser = new CsvParser({ onRow: (r) => rows.push(r) });
    parser.feed('a,b\n1,');
    expect(parser.rowCount).toBe(1);
    parser.feed('2\n3,4');
    parser.end();
    expect(parser.rowCount).toBe(3);
    expect(rows[2]).toEqual(['3', '4']);
  });
});
