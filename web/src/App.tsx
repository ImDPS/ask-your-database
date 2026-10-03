import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Answer, ApiError, CatalogEntry, ExampleItem } from './api'
import ExampleChips from './components/ExampleChips'
import Footer from './components/Footer'
import QuestionBox from './components/QuestionBox'
import ResultTable from './components/ResultTable'
import SqlBlock from './components/SqlBlock'

function exampleFromUrl(): number | null {
  const value = new URLSearchParams(window.location.search).get('example')
  return value !== null && /^\d{1,4}$/.test(value) ? Number(value) : null
}

function asApiError(e: unknown): ApiError {
  const err = e as Partial<ApiError> | null
  if (err && typeof err.message === 'string') return err as ApiError
  return { kind: 'http', message: 'Something went wrong. Please try again.' }
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [examples, setExamples] = useState<ExampleItem[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const latest = useRef(0) // only the newest request may update the page

  const run = useCallback(async (call: () => Promise<Answer>) => {
    const id = ++latest.current
    setLoading(true)
    setAnswer(null)
    setError(null)
    try {
      const result = await call()
      if (id === latest.current) setAnswer(result)
    } catch (e) {
      if (id === latest.current) setError(asApiError(e))
    } finally {
      if (id === latest.current) setLoading(false)
    }
  }, [])

  const runExample = useCallback((id: number) => run(() => api.exampleAnswer(id)), [run])

  useEffect(() => {
    api.examples().then(setExamples, () => {})
    api.catalog().then(setCatalog, () => {})
    const fromUrl = exampleFromUrl()
    if (fromUrl !== null) void runExample(fromUrl)
  }, [runExample])

  const trimmed = question.trim()
  const showEmpty = !loading && !answer && !error

  return (
    <main>
      <header>
        <h1>Ask your database</h1>
        <p className="lede">Ask about a music store's sales in plain English. You get the answer and the SQL behind it.</p>
      </header>

      <QuestionBox
        value={question}
        loading={loading}
        onChange={setQuestion}
        onSubmit={() => void run(() => api.ask(trimmed))}
      />
      <ExampleChips examples={examples} disabled={loading} onRun={(id) => void runExample(id)} />

      <section className="answer" aria-label="Answer" aria-busy={loading}>
        {loading && <p className="muted">Working on it...</p>}
        {showEmpty && <p className="muted">Try one of the examples, or type your own question.</p>}
        {error && (
          <div role="alert" className="error">
            <p>{error.message}</p>
            {error.sql && <SqlBlock sql={error.sql} />}
          </div>
        )}
        {answer && (
          <>
            <SqlBlock sql={answer.sql} />
            <p className="meta muted">
              {answer.rowCount.toLocaleString('en-IN')} {answer.rowCount === 1 ? 'row' : 'rows'} · {answer.elapsedMs} ms
            </p>
            {answer.truncated && <p className="note">Showing the first {answer.rows.length} rows only.</p>}
            {answer.retried && <p className="note">The first query did not run, so this answer needed one retry.</p>}
            {answer.rows.length > 0 ? (
              <ResultTable columns={answer.columns} rows={answer.rows} />
            ) : (
              <p className="muted">No rows matched.</p>
            )}
          </>
        )}
      </section>

      <Footer catalog={catalog} />
    </main>
  )
}
