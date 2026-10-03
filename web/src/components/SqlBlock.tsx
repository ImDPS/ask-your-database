import { useEffect, useRef, useState } from 'react'

export default function SqlBlock({ sql }: { sql: string }) {
  const [status, setStatus] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    let message = 'Copied'
    try {
      await navigator.clipboard.writeText(sql)
    } catch {
      message = 'Could not copy'
    }
    setStatus(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus(''), 2500)
  }

  return (
    <div className="sql">
      <div className="sql-head">
        <h3>SQL</h3>
        <span className="copy-status muted" aria-live="polite">{status}</span>
        <button type="button" className="secondary" onClick={copy}>Copy SQL</button>
      </div>
      <pre tabIndex={0} aria-label="SQL query"><code>{sql}</code></pre>
    </div>
  )
}
