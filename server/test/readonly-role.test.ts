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

  it('read raw table is denied (real unquoted name, see Task 3 notes)', async () => {
    await expect(ro.query('SELECT 1 FROM public.customer LIMIT 1')).rejects.toThrow(/permission denied/);
  });

  it('even a smuggled write leaves the data unchanged', async () => {
    const before = await owner.query('SELECT count(*)::int AS n FROM app.customers');
    await ro.query('DELETE FROM app.customers').catch(() => undefined);
    const after = await owner.query('SELECT count(*)::int AS n FROM app.customers');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
