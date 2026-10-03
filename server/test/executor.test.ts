import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import pg from 'pg';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';
import { runQuery, QueryRejected, QueryFailed, QueryUnavailable, MAX_ROWS } from '../src/executor.js';

const pool = getReadonlyPool();
const owner = getOwnerPool();
afterAll(async () => { await pool.end(); await owner.end(); });

describe('runQuery', () => {
  it('returns columns and rows', async () => {
    const r = await runQuery(pool, 'SELECT genre_name FROM genres ORDER BY genre_name LIMIT 3');
    expect(r.columns).toEqual(['genre_name']);
    expect(r.rows).toHaveLength(3);
    expect(r.rowCount).toBe(3);
    expect(r.truncated).toBe(false);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
  it('caps rows and flags truncation', async () => {
    const r = await runQuery(pool, 'SELECT track_id FROM tracks');
    expect(r.rows).toHaveLength(MAX_ROWS);
    expect(r.rowCount).toBe(MAX_ROWS);
    expect(r.truncated).toBe(true);
  });
  it('truncates a 201-row result at 200 but not a result of exactly 200', async () => {
    const over = await runQuery(pool, 'SELECT track_id FROM tracks LIMIT 201');
    expect(over.rows).toHaveLength(200);
    expect(over.truncated).toBe(true);
    const exact = await runQuery(pool, 'SELECT track_id FROM tracks LIMIT 200');
    expect(exact.rows).toHaveLength(200);
    expect(exact.truncated).toBe(false);
  });
  it('rejects writes before touching the database', async () => {
    await expect(runQuery(pool, 'DELETE FROM customers')).rejects.toBeInstanceOf(QueryRejected);
  });
  it('turns database errors into QueryFailed without leaking internals', async () => {
    const err = await runQuery(pool, 'SELECT no_such_column FROM tracks').catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(String(err.message)).not.toMatch(/postgres:\/\/|password|stack/i);
  });
  it('stops a slow query at the timeout', async () => {
    const slow = 'SELECT count(*) FROM tracks a, tracks b, tracks c, tracks d';
    const started = Date.now();
    const err = await runQuery(pool, slow).catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15000);
  it('runs a query that ends in a line comment', async () => {
    const r = await runQuery(pool, 'SELECT genre_name FROM genres LIMIT 1 -- trailing');
    expect(r.columns).toEqual(['genre_name']);
    expect(r.rows).toHaveLength(1);
  });
  it('does not leak the transaction or the timeout between calls on one connection', async () => {
    // Owner role has no app search_path, so names are schema-qualified. One connection only, so the second call must reuse the first call's connection.
    const single = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 });
    try {
      await runQuery(single, 'SELECT genre_name FROM app.genres LIMIT 1');
      const second = await runQuery(single, 'SELECT count(*)::int AS n FROM app.tracks');
      expect(second.rows[0]).toEqual({ n: 3503 });
      expect(single.idleCount).toBe(single.totalCount); // connection was released
      const c = await single.connect();
      try {
        // The owner's own default is 0 (no timeout); a leaked SET LOCAL would show 5s.
        expect((await c.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('0');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const st = await owner.query('SELECT state FROM pg_stat_activity WHERE pid = $1', [pid]);
        expect(st.rows[0].state).toBe('idle'); // not "idle in transaction"
        // Still writable by default for the owner role: READ ONLY did not leak.
        expect((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('off');
      } finally { c.release(); }
    } finally { await single.end(); }
  });
  it('rejects duplicate output column names with a message the model can act on', async () => {
    const sql = 'SELECT t.track_id, a.track_id FROM tracks t JOIN tracks a ON a.track_id = t.track_id LIMIT 1';
    const err = await runQuery(pool, sql).catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(String(err.message)).toMatch(/duplicate column/);
    expect(String(err.message)).toMatch(/AS/);
  });
  it('still returns distinct columns that share a prefix or are aliased apart', async () => {
    const r = await runQuery(pool, 'SELECT t.track_id AS a_id, a.track_id AS b_id FROM tracks t JOIN tracks a ON a.track_id = t.track_id LIMIT 1');
    expect(r.columns).toEqual(['a_id', 'b_id']);
  });
});

describe('runQuery error mapping for non-database failures', () => {
  // A failure that is not a Postgres error is not something a different query
  // can fix, so it is reported as unavailable (and never retried by the caller).
  const UNAVAILABLE = 'The database is not reachable right now. Please try again in a minute.';
  it('maps a connection failure to QueryUnavailable without host or port', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const fake = { connect: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')) } as unknown as pg.Pool;
      const err = await runQuery(fake, 'SELECT 1').catch((e) => e);
      expect(err).toBeInstanceOf(QueryUnavailable);
      expect(err).not.toBeInstanceOf(QueryFailed);
      expect(err.message).toBe(UNAVAILABLE);
      expect(err.message).not.toMatch(/10.0.0.1|5432|ECONNREFUSED/);
      expect(spy).toHaveBeenCalled(); // real error is logged server-side
    } finally { spy.mockRestore(); }
  });
  it('maps a connect timeout and a dropped connection to QueryUnavailable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const msg of ['timeout exceeded when trying to connect', 'Connection terminated unexpectedly']) {
        const fake = { connect: () => Promise.reject(new Error(msg)) } as unknown as pg.Pool;
        expect(await runQuery(fake, 'SELECT 1').catch((e) => e)).toBeInstanceOf(QueryUnavailable);
      }
    } finally { spy.mockRestore(); }
  });
  it('maps a Postgres error raised by connect (such as a failed login) to QueryUnavailable without the user name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const e = new pg.DatabaseError('password authentication failed for user "app_readonly"', 0, 'error');
      const fake = { connect: () => Promise.reject(e) } as unknown as pg.Pool;
      const err = await runQuery(fake, 'SELECT 1').catch((x) => x);
      expect(err).toBeInstanceOf(QueryUnavailable);
      expect(err.message).toBe(UNAVAILABLE);
    } finally { spy.mockRestore(); }
  });
  it('maps a non-database error raised while running the query to QueryUnavailable and still releases the connection', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const released: unknown[] = [];
      const client = {
        query: async (q: unknown) => {
          if (typeof q === 'object') throw new Error('Connection terminated unexpectedly');
          return {};
        },
        release: (arg?: unknown) => { released.push(arg); },
      };
      const fake = { connect: async () => client } as unknown as pg.Pool;
      const err = await runQuery(fake, 'SELECT 1').catch((e) => e);
      expect(err).toBeInstanceOf(QueryUnavailable);
      expect(err.message).toBe(UNAVAILABLE);
      expect(released).toHaveLength(1); // connection was still released
    } finally { spy.mockRestore(); }
  });
});
