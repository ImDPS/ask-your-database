export interface Cell {
  text: string
  numeric: boolean
  empty: boolean
}

// The API sends pg numeric and bigint values as strings ("523.06", "412"),
// so a numeric-looking string is aligned like a number but never reformatted.
// Postgres numerics never carry leading zeros, so "00530" (a postal code) is text.
const NUMERIC_STRING = /^-?(0|[1-9]\d*)(\.\d+)?$/
const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?Z$/
const UTC_MIDNIGHT = /T00:00:00(?:\.0+)?Z$/

export function formatCell(value: unknown): Cell {
  if (value === null || value === undefined) return { text: '-', numeric: false, empty: true }
  if (typeof value === 'number') {
    return { text: value.toLocaleString('en-IN'), numeric: true, empty: false }
  }
  if (typeof value === 'string') {
    if (NUMERIC_STRING.test(value)) return { text: value, numeric: true, empty: false }
    const iso = ISO_TIMESTAMP.exec(value)
    if (iso) {
      const text = UTC_MIDNIGHT.test(value) ? iso[1] : `${iso[1]} ${iso[2]}:${iso[3]}`
      return { text, numeric: false, empty: false }
    }
    return { text: value, numeric: false, empty: false }
  }
  if (typeof value === 'object') {
    return { text: JSON.stringify(value), numeric: false, empty: false }
  }
  return { text: String(value), numeric: false, empty: false }
}
