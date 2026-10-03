import { formatCell } from '../format'

interface Props {
  columns: string[]
  rows: Record<string, unknown>[]
}

export default function ResultTable({ columns, rows }: Props) {
  const cells = rows.map((row) => columns.map((c) => formatCell(row[c])))
  // A header is right-aligned when every filled cell under it is a number.
  const numericColumn = columns.map((_, i) => {
    const filled = cells.map((r) => r[i]).filter((c) => !c.empty)
    return filled.length > 0 && filled.every((c) => c.numeric)
  })

  return (
    <div className="table-scroll" role="region" aria-label="Query result, scrolls sideways" tabIndex={0}>
      <table>
        <caption className="visually-hidden">Query result</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={numericColumn[i] ? 'num' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={[cell.numeric ? 'num' : '', cell.empty ? 'muted' : ''].filter(Boolean).join(' ') || undefined}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
