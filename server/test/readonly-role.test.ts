import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';

const ro = getReadonlyPool(); const owner = getOwnerPool();
afterAll(async () => { await ro.end(); await owner.end(); });

describe('app role is read-only at the database', () => {
  it.each([
    ['insert', "INSERT INTO app.genres (genre_id, genre_name) VALUES (9999, 'x')"],
    ['update', "UPDATE app.customers SET city = 'x'"],
    ['delete', 'DELETE FROM app.customers'],
    ['drop view', 'DROP VIEW app.customers'],
    ['create table', 'CREATE TABLE app.t (a int)'],
    ['create in public', 'CREATE TABLE public.t (a int)'],
  ])('%s fails', async (_n, sql) => {
    await expect(ro.query(sql)).rejects.toThrow();
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
