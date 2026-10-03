import type pg from 'pg';
import type { LlmProvider } from './llm/provider.js';
import { LlmError } from './llm/provider.js';
import { buildPrompt, extractSql, MAX_QUESTION_CHARS } from './prompt.js';
import { runQuery, QueryRejected, QueryFailed, QueryUnavailable, type QueryResult } from './executor.js';

export type AskOutcome =
  | { ok: true; sql: string; result: QueryResult; retried: boolean }
  | { ok: false; kind: 'bad_question' | 'rejected' | 'failed' | 'llm' | 'unavailable'; message: string; sql?: string };

const NO_SQL = 'The language model returned no SQL.';
const MAX_RETRY_ERROR_CHARS = 300;
const MAX_RETRY_SQL_CHARS = 1000;

// The database error and the failed SQL go back into the prompt. Make each a
// single capped line so neither can add lines such as "Question: ..." of its own.
function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function ask(
  deps: { pool: pg.Pool; provider: LlmProvider; schemaText: string },
  question: string,
): Promise<AskOutcome> {
  const q = question.trim();
  if (!q) return { ok: false, kind: 'bad_question', message: 'Please type a question.' };
  if (q.length > MAX_QUESTION_CHARS)
    return { ok: false, kind: 'bad_question', message: `Please keep the question under ${MAX_QUESTION_CHARS} characters.` };

  let sql = '';
  try {
    sql = extractSql(await deps.provider.generateSql(buildPrompt(deps.schemaText, q)));
    if (!sql) throw new LlmError(NO_SQL);
    try {
      return { ok: true, sql, result: await runQuery(deps.pool, sql), retried: false };
    } catch (e) {
      if (!(e instanceof QueryFailed)) throw e;
      const retry = { sql: oneLine(sql, MAX_RETRY_SQL_CHARS), error: oneLine(e.message, MAX_RETRY_ERROR_CHARS) };
      const sql2 = extractSql(await deps.provider.generateSql(buildPrompt(deps.schemaText, q, retry)));
      if (!sql2) throw new LlmError(NO_SQL);
      sql = sql2;
      return { ok: true, sql, result: await runQuery(deps.pool, sql), retried: true };
    }
  } catch (e) {
    if (e instanceof QueryRejected)
      return { ok: false, kind: 'rejected', message: 'That question needed a query this app does not allow. Only read-only questions about the store data are answered.', sql };
    if (e instanceof QueryFailed)
      return { ok: false, kind: 'failed', message: 'I could not turn that into a working query. Try rephrasing it.', sql };
    if (e instanceof LlmError) return { ok: false, kind: 'llm', message: e.message };
    // The database could not be reached: no retry, no second model call, and no advice to rephrase.
    if (e instanceof QueryUnavailable) return { ok: false, kind: 'unavailable', message: e.message };
    // Anything else is a bug or an infrastructure fault: log name and message
    // only (no stack, no SQL) and give the caller a generic answer.
    console.error('[ask] unexpected failure:', e instanceof Error ? `${e.name}: ${e.message}` : 'non-Error thrown');
    return { ok: false, kind: 'failed', message: 'Something went wrong on the server. Please try again.' };
  }
}
