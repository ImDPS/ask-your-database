import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from './App'

const answer = { sql: 'SELECT 1 AS n', columns: ['n'], rows: [{ n: 1 }], rowCount: 1, truncated: false, elapsedMs: 5, retried: false, cached: false }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let release: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  release = undefined
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/examples') return json([{ id: 1, question: 'Top countries?' }])
    if (url === '/api/catalog') return json([{ name: 'Chinook', source: 's', licence: 'MIT, Copyright (c) 2008-2024 Luis Rocha', note: 'Sample data' }])
    if (url === '/api/ask' && init?.method === 'POST') {
      const q = JSON.parse(String(init.body)).question
      if (q === 'bad') return json({ error: { kind: 'rejected', message: 'Not allowed' }, sql: 'DELETE x' }, 422)
      if (q === 'slow') return json({ error: { kind: 'rate_limited', message: 'Too many questions. Please wait a minute and try again.' } }, 429)
      if (q === 'capped') return json({ error: { kind: 'daily_cap', message: "Today's free question limit is used up." } }, 503)
      if (q === 'big') return json({ ...answer, rowCount: 200, truncated: true, rows: Array.from({ length: 200 }, (_, i) => ({ n: i })) })
      if (q === 'again') return json({ ...answer, retried: true })
      if (q === 'wait') {
        await new Promise<void>((resolve) => { release = resolve })
        return json(answer)
      }
      if (q === 'cells') {
        return json({ ...answer, columns: ['country', 'revenue'], rows: [{ country: 'USA', revenue: '523.06' }] })
      }
      return json(answer)
    }
    if (String(url).startsWith('/api/examples/1/answer')) return json({ ...answer, cached: true })
    return json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  window.history.pushState({}, '', '/')
  vi.unstubAllGlobals()
})

const ask = async (text: string) => {
  await userEvent.type(screen.getByLabelText(/your question/i), text)
  await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
}

describe('App', () => {
  it('shows the SQL and the table after asking', async () => {
    render(<App />)
    await userEvent.type(screen.getByLabelText(/your question/i), 'how many')
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    expect(await screen.findByText('SELECT 1 AS n')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
  it('shows an error alert and the rejected SQL', async () => {
    render(<App />)
    await userEvent.type(screen.getByLabelText(/your question/i), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.getByText('DELETE x')).toBeInTheDocument()
  })
  it('runs an example chip without the ask endpoint', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /top countries/i }))
    expect(await screen.findByText(/no ai call/i)).toBeInTheDocument()
  })
  it('shows the licence in the footer', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Luis Rocha/)).toBeInTheDocument())
  })
})

describe('App page copy and states', () => {
  it('shows the title, the sub-line, the notice and the empty state', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Ask your database' })).toBeInTheDocument()
    expect(screen.getByText("Ask about a music store's sales in plain English. You get the answer and the SQL behind it.")).toBeInTheDocument()
    expect(screen.getByText("Questions are sent to Google's free Gemini service and may be reviewed by people. Please do not enter personal information.")).toBeInTheDocument()
    expect(screen.getByText('Try one of the examples, or type your own question.')).toBeInTheDocument()
  })
  it('shows the footer dataset details and the independent demo line', async () => {
    render(<App />)
    expect(screen.getByText(/independent demo project/i)).toBeInTheDocument()
    expect(await screen.findByText(/Luis Rocha/)).toHaveTextContent(/licence/i)
    expect(screen.getByText('Chinook')).toBeInTheDocument()
    expect(screen.getByText('Sample data')).toBeInTheDocument()
  })
  it('sends the question as JSON to the ask endpoint', async () => {
    render(<App />)
    await ask('how many')
    await screen.findByText('SELECT 1 AS n')
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/ask')!
    expect(call[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(call[1].body))).toEqual({ question: 'how many' })
  })
})

describe('result notes', () => {
  it('shows the row count and the elapsed time', async () => {
    render(<App />)
    await ask('how many')
    expect(await screen.findByText(/1 row\b/)).toHaveTextContent(/5 ms/)
  })
  it('shows the truncated note', async () => {
    render(<App />)
    await ask('big')
    expect(await screen.findByText(/showing the first 200 rows/i)).toBeInTheDocument()
  })
  it('does not show the truncated or retry notes for a plain answer', async () => {
    render(<App />)
    await ask('plain')
    await screen.findByText('SELECT 1 AS n')
    expect(screen.queryByText(/showing the first/i)).toBeNull()
    expect(screen.queryByText(/needed one retry/i)).toBeNull()
  })
  it('shows the retry note', async () => {
    render(<App />)
    await ask('again')
    expect(await screen.findByText(/needed one retry/i)).toBeInTheDocument()
  })
  it('labels every example chip with a no AI call note before anything is run', async () => {
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/examples'
        ? json([{ id: 1, question: 'Top countries?' }, { id: 2, question: 'Best genre?' }])
        : base(url, init))
    render(<App />)
    const chips = within(await screen.findByRole('group', { name: /example questions/i })).getAllByRole('button')
    expect(chips).toHaveLength(2)
    for (const chip of chips) expect(chip).toHaveTextContent(/no ai call/i)
    expect(screen.getAllByText(/no ai call/i)).toHaveLength(2)
  })
  it('does not repeat the no AI call note in the answer area, for an example or a typed question', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /top countries/i }))
    await screen.findByText('SELECT 1 AS n')
    const region = screen.getByRole('region', { name: /answer/i })
    expect(within(region).queryByText(/no ai call/i)).toBeNull()
    await userEvent.type(screen.getByLabelText(/your question/i), 'plain')
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/ask')).toHaveLength(1))
    expect(within(screen.getByRole('region', { name: /answer/i })).queryByText(/no ai call/i)).toBeNull()
  })
  it('calls the example answer endpoint, not the ask endpoint, for a chip', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /top countries/i }))
    await screen.findByText('SELECT 1 AS n')
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/ask')).toBe(false)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/examples/1/answer'))).toBe(true)
  })
  it('keeps numeric strings as given in the table', async () => {
    render(<App />)
    await ask('cells')
    expect(await screen.findByText('523.06')).toHaveClass('num')
  })
})

describe('errors', () => {
  it('shows the server message for a 429', async () => {
    render(<App />)
    await ask('slow')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions. Please wait a minute and try again.')
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('shows the server message for a 503', async () => {
    render(<App />)
    await ask('capped')
    expect(await screen.findByRole('alert')).toHaveTextContent("Today's free question limit is used up.")
  })
  it('shows a network failure message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/ask') throw new TypeError('Failed to fetch')
      return json([])
    })
    render(<App />)
    await ask('anything')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
  })
  it('clears the error when the next answer arrives', async () => {
    render(<App />)
    await ask('slow')
    await screen.findByRole('alert')
    await userEvent.clear(screen.getByLabelText(/your question/i))
    await ask('again')
    await screen.findByText('SELECT 1 AS n')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('question box', () => {
  it('disables Ask when the question is empty or only spaces', async () => {
    render(<App />)
    const button = screen.getByRole('button', { name: /^ask$/i })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/your question/i), '   ')
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/your question/i), 'x')
    expect(button).toBeEnabled()
  })
  it('disables Ask and marks the results region busy while loading', async () => {
    render(<App />)
    await ask('wait')
    const button = screen.getByRole('button', { name: /^ask$/i })
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByRole('region', { name: /answer/i })).toHaveAttribute('aria-busy', 'true')
    release!()
    await screen.findByText('SELECT 1 AS n')
    expect(screen.getByRole('region', { name: /answer/i })).toHaveAttribute('aria-busy', 'false')
    expect(button).toBeEnabled()
  })
  it('shows a character counter with the 300 limit and enforces it', async () => {
    render(<App />)
    const box = screen.getByLabelText(/your question/i)
    expect(screen.getByText('0 / 300')).toBeInTheDocument()
    await userEvent.type(box, 'abc')
    expect(screen.getByText('3 / 300')).toBeInTheDocument()
    expect(box).toHaveAttribute('maxlength', '300')
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('x'.repeat(350))
    expect(screen.getByText('300 / 300')).toBeInTheDocument()
  })
})

describe('copy button', () => {
  it('copies the SQL and announces Copied in a live region', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText(/your question/i), 'how many')
    await user.click(screen.getByRole('button', { name: /^ask$/i }))
    await screen.findByText('SELECT 1 AS n')
    await user.click(screen.getByRole('button', { name: /copy sql/i }))
    const status = await screen.findByText('Copied')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(await navigator.clipboard.readText()).toBe('SELECT 1 AS n')
  })
})

describe('?example= auto-run', () => {
  it('runs the named example on load without the ask endpoint', async () => {
    window.history.pushState({}, '', '/?example=1')
    render(<App />)
    expect(await screen.findByText('SELECT 1 AS n')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/examples/1/answer'))).toBe(true)
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/ask')).toBe(false)
  })
  it('ignores a value that is not a whole number', async () => {
    window.history.pushState({}, '', '/?example=abc')
    render(<App />)
    await screen.findByText('Top countries?')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/answer'))).toBe(false)
    expect(screen.getByText('Try one of the examples, or type your own question.')).toBeInTheDocument()
  })
})
