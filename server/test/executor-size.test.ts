import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool } from '../src/db.js';
import { runQuery, QueryFailed, MAX_ROWS, MAX_RESULT_BYTES } from '../src/executor.js';

const pool = getReadonlyPool();
afterAll(() => pool.end());

const TOO_LARGE = 'That result is too large to show. Ask for fewer rows or shorter columns.';

describe('result size limit', () => {
  it('refuses a 60 MB value quickly, with the friendly message, without growing the process', async () => {
    const before = process.memoryUsage().rss;
    const started = Date.now();
    const err = await runQuery(pool, "SELECT repeat('x', 60000000) AS big").catch((e) => e);
    const took = Date.now() - started;
    const growth = process.memoryUsage().rss - before;
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toBe(TOO_LARGE);
    expect(took).toBeLessThan(5000);
    expect(growth).toBeLessThan(30 * 1024 * 1024); // serving 60 MB would add at least that
  }, 15000);

  it('passes one 900 KB value and refuses a 1.2 MB value', async () => {
    const ok = await runQuery(pool, "SELECT repeat('x', 900000) AS v");
    expect(ok.rows[0].v).toHaveLength(900000);
    const err = await runQuery(pool, "SELECT repeat('x', 1200000) AS v").catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toBe(TOO_LARGE);
  });

  it('counts the whole page: many modest rows can exceed the limit together', async () => {
    const sql = `SELECT g AS n, repeat('x', ${Math.ceil(MAX_RESULT_BYTES / 100)}) AS v FROM generate_series(1, 150) AS g`;
    const err = await runQuery(pool, sql).catch((e) => e);
    expect(err.message).toBe(TOO_LARGE);
  });

  it('keeps the result shape: only the query\'s own columns, 200 rows, truncation flag', async () => {
    const r = await runQuery(pool, 'SELECT track_id, track_name FROM tracks ORDER BY track_id');
    expect(r.columns).toEqual(['track_id', 'track_name']);
    expect(r.rows).toHaveLength(MAX_ROWS);
    expect(r.truncated).toBe(true);
    expect(Object.keys(r.rows[0])).toEqual(['track_id', 'track_name']);
  });

  it('returns zero rows and the columns for an empty result', async () => {
    const r = await runQuery(pool, 'SELECT track_id, track_name FROM tracks WHERE false');
    expect(r.rows).toEqual([]);
    expect(r.columns).toEqual(['track_id', 'track_name']);
    expect(r.truncated).toBe(false);
  });

  it('still reports duplicate column names with the alias hint', async () => {
    const err = await runQuery(pool, 'SELECT 1 AS a, 2 AS a').catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toMatch(/duplicate column/);
    expect(err.message).toMatch(/AS/);
  });

  it('keeps an ordinary invalid-integer error as the database message, not the size message', async () => {
    const err = await runQuery(pool, "SELECT 'abc'::int AS n").catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toMatch(/invalid input syntax for type integer/);
    expect(err.message).not.toBe(TOO_LARGE);
  });

  // The size is measured on the whole row, so a column that happens to share a
  // name with anything the wrapper uses internally cannot hide a large value.
  it.each(['r', '"R"', 't', 'n', 'q', '_total', 'big'])('refuses a 2 MB value next to a column named %s', async (name) => {
    const sql = `SELECT repeat('x', 2000000) AS big, '' AS ${name === 'big' ? 'other' : name}`;
    const err = await runQuery(pool, sql).catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toBe(TOO_LARGE);
  });

  it('refuses many rows whose total is large when a column is named r', async () => {
    const sql = "SELECT repeat('x', 3000000) AS big, '' AS r FROM generate_series(1, 20)";
    const err = await runQuery(pool, sql).catch((e) => e);
    expect(err.message).toBe(TOO_LARGE);
  });

  it('still reports two columns both named r as duplicates, not as an ambiguous reference', async () => {
    const err = await runQuery(pool, 'SELECT 1 AS r, 2 AS r').catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(err.message).toMatch(/duplicate column/);
    expect(err.message).not.toMatch(/ambiguous/);
  });

  it('still returns an ordinary result with columns named like the wrapper aliases', async () => {
    const r = await runQuery(pool, 'SELECT 1 AS r, 2 AS t, 3 AS n, 4 AS q');
    expect(r.columns).toEqual(['r', 't', 'n', 'q']);
    expect(r.rows).toEqual([{ r: 1, t: 2, n: 3, q: 4 }]);
  });

  it('passes a row just under the limit and refuses one just over it', async () => {
    // One text column is measured as "(" + value + ")", two bytes more than the value.
    const under = await runQuery(pool, `SELECT repeat('x', ${MAX_RESULT_BYTES - 2}) AS v`);
    expect(under.rows[0].v).toHaveLength(MAX_RESULT_BYTES - 2);
    const over = await runQuery(pool, `SELECT repeat('x', ${MAX_RESULT_BYTES - 1}) AS v`).catch((e) => e);
    expect(over.message).toBe(TOO_LARGE);
  });
});
