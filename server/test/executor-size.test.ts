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
});
