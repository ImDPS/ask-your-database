// Shared by the golden test and the owner-run live script, so both judge a
// result the same way. Only values are compared, never column names, because a
// model is free to alias columns as it likes. Column order and the number of
// columns do count: an extra or missing column is a difference. Fractions are
// compared after rounding to 2 decimals (see roundFraction).

type Row = Record<string, unknown>;

// Same rule as the page's cell formatter: plain decimal strings only. "Infinity",
// "0x10", "1e5" and zero-padded codes such as "00530" stay text.
const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

// Rounding rule (deliberate leniency for averages and ratios): any number with
// a fractional part is rounded to 2 decimals, half away from zero, on BOTH
// sides before comparing, so an unrounded 5.6519... matches the gold 5.65. The
// score therefore means "matches the gold answer after rounding fractions to 2
// decimals". Integers stay integers. The product is scaled with toPrecision(12)
// first so that float noise (5.655 * 100 = 565.4999999999999) cannot flip a half.
function roundFraction(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  const scaled = Math.round(Number((Math.abs(n) * 100).toPrecision(12)));
  return (Math.sign(n) * scaled) / 100;
}

// The pg driver returns bigint and numeric as strings, so "523.06" and 523.06
// must count as the same value. Text that is not a plain decimal stays verbatim.
export function normaliseCell(v: unknown): unknown {
  if (typeof v === 'string') return DECIMAL.test(v) ? roundFraction(Number(v)) : v;
  if (typeof v === 'number') return roundFraction(v);
  return v;
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
