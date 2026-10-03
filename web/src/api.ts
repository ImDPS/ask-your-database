export interface Answer {
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
  elapsedMs: number
  retried: boolean
  cached: boolean
}

export interface ApiError {
  kind: string
  message: string
  sql?: string
}

export interface ExampleItem {
  id: number
  question: string
}

export interface CatalogEntry {
  name: string
  source: string
  licence: string
  note: string
}

const NETWORK_ERROR: ApiError = { kind: 'network', message: 'Could not reach the server.' }
const GENERIC_ERROR: ApiError = { kind: 'http', message: 'Something went wrong. Please try again.' }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw NETWORK_ERROR
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  if (!res.ok) throw toApiError(body)
  if (body === undefined) throw GENERIC_ERROR
  return body as T
}

// The server sends { error: { kind, message }, sql? }. Anything else gets a generic message.
function toApiError(body: unknown): ApiError {
  if (typeof body !== 'object' || body === null) return GENERIC_ERROR
  const { error, sql } = body as { error?: { kind?: unknown; message?: unknown }; sql?: unknown }
  if (typeof error?.message !== 'string') return GENERIC_ERROR
  return {
    kind: typeof error.kind === 'string' ? error.kind : 'http',
    message: error.message,
    ...(typeof sql === 'string' && sql ? { sql } : {}),
  }
}

export const api = {
  examples: () => request<ExampleItem[]>('/api/examples'),
  exampleAnswer: (id: number) => request<Answer>(`/api/examples/${id}/answer`),
  ask: (question: string) =>
    request<Answer>('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
  catalog: () => request<CatalogEntry[]>('/api/catalog'),
}
