import { describe, it, expect } from 'vitest'
import { formatCell } from './format'

describe('formatCell numbers', () => {
  it('formats real JS numbers with Indian digit grouping and right-aligns them', () => {
    expect(formatCell(1234567.5)).toMatchObject({ text: '12,34,567.5', numeric: true, empty: false })
    expect(formatCell(0)).toMatchObject({ text: '0', numeric: true })
    expect(formatCell(-4200)).toMatchObject({ text: '-4,200', numeric: true })
  })
  it('keeps numeric-looking strings exactly as given but still right-aligns them', () => {
    expect(formatCell('523.06')).toMatchObject({ text: '523.06', numeric: true })
    expect(formatCell('412')).toMatchObject({ text: '412', numeric: true })
    expect(formatCell('1234567.89')).toMatchObject({ text: '1234567.89', numeric: true })
    expect(formatCell('-3.50')).toMatchObject({ text: '-3.50', numeric: true })
  })
  it('treats other strings as text', () => {
    expect(formatCell('USA')).toMatchObject({ text: 'USA', numeric: false })
    expect(formatCell('12 apples')).toMatchObject({ text: '12 apples', numeric: false })
    expect(formatCell('')).toMatchObject({ text: '', numeric: false, empty: false })
    expect(formatCell('2009-01-01')).toMatchObject({ text: '2009-01-01', numeric: false })
  })
})

describe('formatCell timestamps', () => {
  it('shows an ISO timestamp at exactly midnight UTC as the date only', () => {
    expect(formatCell('2009-01-01T00:00:00.000Z')).toMatchObject({ text: '2009-01-01', numeric: false })
  })
  it('shows other ISO timestamps as YYYY-MM-DD HH:MM in UTC', () => {
    expect(formatCell('2009-03-04T10:15:30.000Z').text).toBe('2009-03-04 10:15')
    expect(formatCell('2009-03-04T00:00:01.000Z').text).toBe('2009-03-04 00:00')
    expect(formatCell('2024-12-31T23:59:59.999Z').text).toBe('2024-12-31 23:59')
  })
  it('does not shift the time zone', () => {
    expect(formatCell('2009-01-01T23:30:00.000Z').text).toBe('2009-01-01 23:30')
  })
})

describe('formatCell other values', () => {
  it('shows null and undefined as a muted dash', () => {
    expect(formatCell(null)).toEqual({ text: '-', numeric: false, empty: true })
    expect(formatCell(undefined)).toEqual({ text: '-', numeric: false, empty: true })
  })
  it('shows booleans as text and objects as JSON text', () => {
    expect(formatCell(true)).toMatchObject({ text: 'true', numeric: false })
    expect(formatCell({ a: 1 })).toMatchObject({ text: '{"a":1}', numeric: false })
  })
})
