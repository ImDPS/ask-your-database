// Safe query executor. Validates, then runs the query on one connection inside
// a READ ONLY transaction with a statement timeout and a row cap. The read-only
// database role is the hard guarantee; this layer adds limits and clean errors.
import type pg from 'pg';
import { validateSql } from './validator.js';

export const MAX_ROWS = 200;
const TIMEOUT_MS = 5000;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean; // true when more than MAX_ROWS rows existed
  elapsedMs: number;
}
export class QueryRejected extends Error {} // validator said no
export class QueryFailed extends Error {} // database said no (message is safe to show)

export async function runQuery(pool: pg.Pool, input: string): Promise<QueryResult> {
  const v = validateSql(input);
  if (!v.ok) throw new QueryRejected(v.reason);

  const client = await pool.connect();
  const started = Date.now();
  let rolledBack = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    // Same shape the validator parses: the newline before the closing bracket
    // stops a trailing "-- comment" from swallowing ") AS q LIMIT ...".
    const res = await client.query({
      text: `SELECT * FROM (${v.sql}\n) AS q LIMIT ${MAX_ROWS + 1}`,
      rowMode: 'array',
    });
    const columns = res.fields.map((f) => f.name);
    const all = res.rows as unknown[][];
    const rows = all
      .slice(0, MAX_ROWS)
      .map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: all.length > MAX_ROWS,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    // Message only: no stack, no connection details.
    throw new QueryFailed(e instanceof Error ? e.message : 'Query failed');
  } finally {
    try {
      await client.query('ROLLBACK');
      rolledBack = true;
    } catch {
      rolledBack = false;
    }
    // A connection whose rollback failed is destroyed, not returned to the pool.
    client.release(rolledBack ? undefined : true);
  }
}
