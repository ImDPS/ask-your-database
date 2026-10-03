// Shared by the golden test and the owner-run live script, so both judge a
// result the same way. Only values are compared, never column names, because a
// model is free to alias columns as it likes. Column order and the number of
// columns do count: an extra or missing column is a difference.

type Row = Record<string, unknown>;

// Same rule as the page's cell formatter: plain decimal strings only. "Infinity",
// "0x10", "1e5" and zero-padded codes such as "00530" stay text.
const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

// The pg driver returns bigint and numeric as strings, so "523.06" and 523.06
// must count as the same value.
export function normaliseCell(v: unknown): unknown {
  return typeof v === 'string' && DECIMAL.test(v) ? Number(v) : v;
}

const valuesOf = (r: Row): unknown[] => Object.values(r).map(normaliseCell);

// One JSON line per row. Sorted when order does not matter (a multiset, so
// duplicate rows are kept), left as returned when it does.
export function canonicalRows(rows: Row[], ordered: boolean): string[] {
  const lines = rows.map((r) => JSON.stringify(valuesOf(r)));
  return ordered ? lines : [...lines].sort();
}

export interface Comparison { same: boolean; gotRows: number; goldRows: number }

export function compareResults(got: Row[], gold: Row[], ordered: boolean): Comparison {
  const a = canonicalRows(got, ordered);
  const b = canonicalRows(gold, ordered);
  return {
    same: a.length === b.length && a.every((line, i) => line === b[i]),
    gotRows: got.length,
    goldRows: gold.length,
  };
}
