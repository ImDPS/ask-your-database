import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';

const ro = getReadonlyPool(); const owner = getOwnerPool();
afterAll(async () => { await ro.end(); await owner.end(); });

const ATTACKS: [string, string][] = [
  ['insert', "INSERT INTO app.genres (genre_id, genre_name) VALUES (9999, 'x')"],
  ['update', "UPDATE app.customers SET city = 'x'"],
  ['delete', 'DELETE FROM app.customers'],
  ['drop view', 'DROP VIEW app.customers'],
  ['create table', 'CREATE TABLE app.t (a int)'],
  ['create in public', 'CREATE TABLE public.t (a int)'],
];

describe('app role is read-only at the database', () => {
  // The role's default is a read-only transaction, which alone rejects DDL with
  // "cannot execute ... in a read-only transaction" before any privilege check.
  // So each attack is run twice: as the app would (default transaction), and
  // inside an explicit READ WRITE transaction, where only the grants can stop it.
  it.each(ATTACKS)('%s fails by default', async (_n, sql) => {
    await expect(ro.query(sql)).rejects.toThrow(/permission denied|must be owner|read-only transaction/i);
  });

  it.each(ATTACKS)('%s is denied by privileges even in a READ WRITE transaction', async (_n, sql) => {
    const c = await ro.connect();
    try {
      await c.query('BEGIN READ WRITE');
      await expect(c.query(sql)).rejects.toThrow(/permission denied|must be owner/i);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('read raw table is denied (the real table name is unquoted)', async () => {
    await expect(ro.query('SELECT 1 FROM public.customer LIMIT 1')).rejects.toThrow(/permission denied/);
  });

  it('even a smuggled write leaves the data unchanged', async () => {
    const before = await owner.query('SELECT count(*)::int AS n FROM app.customers');
    await ro.query('DELETE FROM app.customers').catch(() => undefined);
    const after = await owner.query('SELECT count(*)::int AS n FROM app.customers');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('temporary objects', () => {
  it('the app role cannot create a temp table, even in a READ WRITE transaction', async () => {
    const c = await ro.connect();
    try {
      await c.query('BEGIN READ WRITE');
      await expect(c.query('CREATE TEMP TABLE t_probe (a int)')).rejects.toThrow(/permission denied/i);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});

describe('what the role alone does not stop', () => {
  // Some functions are executable by PUBLIC, so the role's grants do not stop
  // them. Inside an explicit READ WRITE transaction they succeed, which is what
  // these tests document. Every one is rolled back. In the app the read-only
  // transaction stops lo_create; pg_notify and advisory locks are allowed even
  // there, so only the validator (it refuses every pg_* and lo_* function name)
  // keeps them out. Both are harmless to the data.
  const inTransaction = async (mode: 'READ WRITE' | 'READ ONLY', sql: string) => {
    const c = await ro.connect();
    try {
      await c.query(`BEGIN ${mode}`);
      return await c.query(sql);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  };

  it('pg_notify succeeds in a READ WRITE transaction', async () => {
    await expect(inTransaction('READ WRITE', "SELECT pg_notify('probe', 'x')")).resolves.toBeDefined();
  });
  it('advisory locks succeed in a READ WRITE transaction', async () => {
    await expect(inTransaction('READ WRITE', 'SELECT pg_advisory_xact_lock(42)')).resolves.toBeDefined();
  });
  it('lo_create succeeds in a READ WRITE transaction', async () => {
    await expect(inTransaction('READ WRITE', 'SELECT lo_create(0)')).resolves.toBeDefined();
  });
  it('the read-only transaction is what stops lo_create in the app', async () => {
    await expect(inTransaction('READ ONLY', 'SELECT lo_create(0)')).rejects.toThrow(/read-only transaction/i);
  });
  it('pg_notify and advisory locks are not stopped even by a read-only transaction', async () => {
    await expect(inTransaction('READ ONLY', "SELECT pg_notify('probe', 'x')")).resolves.toBeDefined();
    await expect(inTransaction('READ ONLY', 'SELECT pg_advisory_xact_lock(42)')).resolves.toBeDefined();
  });
});
