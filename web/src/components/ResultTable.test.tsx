import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ResultTable from './ResultTable'

const columns = ['country', 'revenue', 'orders', 'first_sale', 'last_sale', 'note']
const rows = [
  {
    country: 'USA',
    revenue: '523.06',
    orders: 412,
    first_sale: '2009-01-01T00:00:00.000Z',
    last_sale: '2025-06-30T14:05:09.000Z',
    note: null,
  },
]

describe('ResultTable', () => {
  it('has an accessible name and one header per column', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByRole('table', { name: /query result/i })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(columns.length)
  })

  it('right-aligns numbers and numeric-looking strings, and left-aligns text', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells[0]).not.toHaveClass('num')
    expect(cells[1]).toHaveClass('num')
    expect(cells[2]).toHaveClass('num')
    expect(cells[3]).not.toHaveClass('num')
  })

  it('left-aligns a column of zero-padded postal codes, header included', () => {
    render(<ResultTable columns={['postal_code', 'total']} rows={[{ postal_code: '00530', total: '12.50' }, { postal_code: '00123', total: '3' }]} />)
    const [postal, total] = screen.getAllByRole('columnheader')
    expect(postal).not.toHaveClass('num')
    expect(total).toHaveClass('num')
    expect(screen.getByText('00530')).not.toHaveClass('num')
    expect(screen.getByText('00123')).not.toHaveClass('num')
  })

  it('keeps numeric strings as given and formats real numbers the Indian way', () => {
    render(<ResultTable columns={['a', 'b']} rows={[{ a: '1234567.89', b: 1234567 }]} />)
    expect(screen.getByText('1234567.89')).toBeInTheDocument()
    expect(screen.getByText('12,34,567')).toBeInTheDocument()
  })

  it('shows midnight timestamps as dates and others as date and time', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByText('2009-01-01')).toBeInTheDocument()
    expect(screen.getByText('2025-06-30 14:05')).toBeInTheDocument()
  })

  it('shows null as a muted dash', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    const dash = screen.getByText('-')
    expect(dash).toHaveClass('muted')
  })

  it('renders cell text as text, never as markup', () => {
    render(<ResultTable columns={['x']} rows={[{ x: '<b>bold</b>' }]} />)
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('td b')).toBeNull()
  })
})
