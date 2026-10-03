// Safe query executor. Validates, then runs the query on one connection inside
// a READ ONLY transaction with a statement timeout and a row cap. The read-only
// database role is the hard guarantee; this layer adds limits and clean errors.
import pg from 'pg';
import { validateSql } from './validator.js';

export const MAX_ROWS = 200;
const TIMEOUT_MS = 5000;
const GENERIC_FAILURE = 'The query could not be run.';
const DUPLICATE_COLUMNS =
  'The result has duplicate column names (for example two columns called id). Give each column its own alias with AS.';

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

  let client: pg.PoolClient | undefined;
  const started = Date.now();
  let rolledBack = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    // Same shape the validator parses: the newline before the closing bracket
    // stops a trailing "-- comment" from swallowing ") AS q LIMIT ...".
    // The extended protocol takes one statement per query, so a second
    // statement smuggled past the validator is refused by the server. BEGIN,
    // SET LOCAL and ROLLBACK are fixed text of ours and use the simple protocol.
    // @types/pg does not list queryMode, hence the cast.
    const config = {
      text: `SELECT * FROM (${v.sql}
) AS q LIMIT ${MAX_ROWS + 1}`,
      rowMode: 'array',
      queryMode: 'extended',
    } as pg.QueryArrayConfig;
    const res = await client.query(config);
    const columns = res.fields.map((f) => f.name);
    // Rows are keyed by column name, so duplicates would silently lose values.
    if (new Set(columns).size !== columns.length) throw new QueryFailed(DUPLICATE_COLUMNS);
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
    if (e instanceof QueryFailed) throw e;
    // Only a Postgres error carries a message that is safe to show. Anything
    // else (socket errors with host and port, a bug of ours) is logged here,
    // without the SQL, and the caller gets a generic message.
    // A Postgres error from pool.connect() (e.g. a failed login) names the
    // database user, so only errors raised once a client exists are passed on.
    if (client && e instanceof pg.DatabaseError) throw new QueryFailed(e.message);
    console.error('[executor] unexpected failure:', e instanceof Error ? `${e.name}: ${e.message}` : 'non-Error thrown');
    throw new QueryFailed(GENERIC_FAILURE);
  } finally {
    if (client) {
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
}
