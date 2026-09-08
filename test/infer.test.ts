import { describe, expect, it } from 'vitest';
import { detectDelimiter } from '../src/delimiter.js';
import { classify, coerce, inferColumns, inferTypes } from '../src/infer.js';

describe('detectDelimiter', () => {
  it('detects semicolons', () => {
    expect(detectDelimiter('x;y;z\n1;2;3\n')).toBe(';');
  });

  it('detects tabs and pipes', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2\n3|4\n')).toBe('|');
  });

  it('prefers the delimiter with consistent field counts', () => {
    // Commas appear, but inconsistently (inside prose); semicolons are regular.
    expect(detectDelimiter('id;text\n1;hello, world\n2;plain\n3;a, b, c\n')).toBe(';');
  });

  it('ignores delimiters inside quoted fields', () => {
    expect(detectDelimiter('a,b\n"1;2;3",4\n"5;6;7",8\n')).toBe(',');
  });

  it('falls back to a comma for single-column or empty input', () => {
    expect(detectDelimiter('name\nalice\nbob\n')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });

  it('works on a single unterminated line', () => {
    expect(detectDelimiter('a|b|c')).toBe('|');
  });
});

describe('classify', () => {
  it('recognises each type', () => {
    expect(classify('42')).toBe('int');
    expect(classify('-7')).toBe('int');
    expect(classify('3.14')).toBe('float');
    expect(classify('.5')).toBe('float');
    expect(classify('1e9')).toBe('float');
    expect(classify('TRUE')).toBe('bool');
    expect(classify('2024-02-29')).toBe('date');
    expect(classify('2024-02-29T13:45:00Z')).toBe('date');
    expect(classify('2024-02-29 13:45:00.250+02:00')).toBe('date');
    expect(classify('')).toBe('null');
    expect(classify('NA')).toBe('null');
    expect(classify('hello')).toBe('string');
  });

  it('rejects near misses', () => {
    expect(classify('02134')).toBe('string');
    expect(classify('1.2.3')).toBe('string');
    expect(classify('2024-13-01')).toBe('string');
    expect(classify('2024-01-0')).toBe('string');
    expect(classify('2024-01-02T25')).toBe('string');
    expect(classify('-')).toBe('string');
    expect(classify('1e')).toBe('string');
  });

  it('coerces to JSON values', () => {
    expect(coerce(' 12 ')).toBe(12);
    expect(coerce('false')).toBe(false);
    expect(coerce('')).toBeNull();
    expect(coerce('2024-01-02')).toBe('2024-01-02');
  });
});

describe('inferTypes', () => {
  it('infers one type per column', () => {
    expect(inferTypes([['1', '2.5', 'true', '2024-01-02', 'hi']])).toEqual([
      'int',
      'float',
      'bool',
      'date',
      'string',
    ]);
  });

  it('promotes mixed ints and floats to float and ignores nulls', () => {
    expect(
      inferTypes([
        ['1', '', 'x'],
        ['2.0', '', '3'],
        ['', '', '4'],
      ]),
    ).toEqual(['float', 'null', 'int']);
  });

  it('reports majority type with confidence', () => {
    const [col] = inferColumns([['1'], ['2'], ['3'], ['oops']]);
    expect(col).toEqual({ type: 'int', confidence: 0.75 });
    const [text] = inferColumns([['a'], ['b'], ['3']]);
    expect(text).toEqual({ type: 'string', confidence: 1 });
  });
});
