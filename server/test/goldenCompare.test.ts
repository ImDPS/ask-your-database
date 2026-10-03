import { describe, it, expect } from 'vitest';
import { normaliseCell, canonicalRows, compareResults } from '../src/goldenCompare.js';

type Rows = Record<string, unknown>[];

describe('normaliseCell', () => {
  it('turns numeric strings into numbers', () => {
    expect(normaliseCell('523.06')).toBe(523.06);
    expect(normaliseCell('412')).toBe(412);
    expect(normaliseCell('-0.50')).toBe(-0.5);
    expect(normaliseCell('0')).toBe(0);
  });
  it('leaves text, empty strings, null and real numbers alone', () => {
    expect(normaliseCell('Rock')).toBe('Rock');
    expect(normaliseCell('')).toBe('');
    expect(normaliseCell(null)).toBeNull();
    expect(normaliseCell(7)).toBe(7);
  });
  it('does not treat number-like words, hex, exponents or padded codes as numbers', () => {
    for (const s of ['Infinity', '0x10', '1e5', ' 12 ', '1,234', '00530', '007']) expect(normaliseCell(s)).toBe(s);
  });
});

describe('compareResults', () => {
  it('treats numeric strings and numbers as the same value', () => {
    const gold: Rows = [{ country: 'USA', revenue: '523.06' }];
    const got: Rows = [{ country: 'USA', revenue: 523.06 }];
    expect(compareResults(got, gold, true).same).toBe(true);
    expect(compareResults(got, gold, false).same).toBe(true);
  });

  it('ignores column names, only values count', () => {
    const gold: Rows = [{ billing_country: 'USA', revenue: '523.06' }];
    const got: Rows = [{ c: 'USA', total: '523.06' }];
    expect(compareResults(got, gold, true).same).toBe(true);
  });

  it('ignores row order when order does not matter', () => {
    const gold: Rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }];
    const got: Rows = [{ a: 'y', b: 2 }, { a: 'x', b: 1 }];
    expect(compareResults(got, gold, false).same).toBe(true);
  });

  it('requires the same order when order matters', () => {
    const gold: Rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }];
    const got: Rows = [{ a: 'y', b: 2 }, { a: 'x', b: 1 }];
    expect(compareResults(got, gold, true).same).toBe(false);
  });

  it('counts an extra column as a difference', () => {
    const gold: Rows = [{ name: 'Rock', revenue: '826.65' }];
    const got: Rows = [{ name: 'Rock', revenue: '826.65', rank: 1 }];
    expect(compareResults(got, gold, true).same).toBe(false);
    expect(compareResults(got, gold, false).same).toBe(false);
  });

  it('counts a missing column, a different value and a different row count as differences', () => {
    const gold: Rows = [{ name: 'Rock', revenue: '826.65' }];
    expect(compareResults([{ name: 'Rock' }], gold, true).same).toBe(false);
    expect(compareResults([{ name: 'Rock', revenue: '826.66' }], gold, true).same).toBe(false);
    expect(compareResults([...gold, ...gold], gold, false).same).toBe(false);
    expect(compareResults([], gold, false).same).toBe(false);
  });

  it('does not confuse a number with text that only looks the same', () => {
    expect(compareResults([{ a: 'USA' }], [{ a: 'usa' }], false).same).toBe(false);
    expect(compareResults([{ a: null }], [{ a: '' }], false).same).toBe(false);
  });

  it('keeps duplicate rows (it compares as a multiset, not a set)', () => {
    const one: Rows = [{ a: 1 }];
    const two: Rows = [{ a: 1 }, { a: 1 }];
    expect(compareResults(two, one, false).same).toBe(false);
    expect(compareResults(two, two, false).same).toBe(true);
  });

  it('reports the row count of each side', () => {
    const r = compareResults([{ a: 1 }, { a: 2 }, { a: 3 }], [{ a: 1 }], true);
    expect(r).toEqual({ same: false, gotRows: 3, goldRows: 1 });
  });

  it('treats two empty results as equal', () => {
    expect(compareResults([], [], true)).toEqual({ same: true, gotRows: 0, goldRows: 0 });
  });
});

describe('canonicalRows', () => {
  it('keeps order when ordered and sorts when not', () => {
    const rows: Rows = [{ a: 'b' }, { a: 'a' }];
    expect(canonicalRows(rows, true)).toEqual(['["b"]', '["a"]']);
    expect(canonicalRows(rows, false)).toEqual(['["a"]', '["b"]']);
  });
  it('does not change the input', () => {
    const rows: Rows = [{ a: 'b' }, { a: 'a' }];
    canonicalRows(rows, false);
    expect(rows).toEqual([{ a: 'b' }, { a: 'a' }]);
  });
});
