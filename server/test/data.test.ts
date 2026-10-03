import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';

const ro = getReadonlyPool(); const owner = getOwnerPool();
afterAll(async () => { await ro.end(); await owner.end(); });

describe('chinook data and views', () => {
  it('has customers, tracks and invoices in the app schema', async () => {
    for (const v of ['customers', 'tracks', 'invoices', 'invoice_lines']) {
      const r = await ro.query(`SELECT count(*)::int AS n FROM app.${v}`);
      expect(r.rows[0].n).toBeGreaterThan(0);
    }
  });
  it('every app view and column has a comment', async () => {
    const v = await owner.query(`SELECT count(*)::int AS n FROM pg_views WHERE schemaname = 'app'`);
    expect(v.rows[0].n).toBe(11); // guards against the comment check below passing on an empty schema
    const r = await owner.query(`
      SELECT c.relname, a.attname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'app'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'v' AND col_description(c.oid, a.attnum) IS NULL`);
    expect(r.rows).toEqual([]);
    const vc = await owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'app'
      WHERE c.relkind = 'v' AND obj_description(c.oid, 'pg_class') IS NULL`);
    expect(vc.rows).toEqual([]);
  });
  it('personal-looking columns are not exposed in the app views', async () => {
    const removed: Record<string, string[]> = {
      customers: ['address', 'postal_code', 'phone', 'email'],
      employees: ['birth_date', 'phone', 'email', 'postal_code', 'city', 'state'],
      invoices: ['billing_address', 'billing_postal_code'],
    };
    const r = await owner.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'app'`);
    const present = r.rows.map((x) => `${x.table_name}.${x.column_name}`);
    for (const [view, cols] of Object.entries(removed)) {
      for (const col of cols) expect(present).not.toContain(`${view}.${col}`);
    }
  });
  it('the read-only role cannot see the raw tables', async () => {
    await expect(ro.query('SELECT 1 FROM public.customer LIMIT 1')).rejects.toThrow(/permission denied/);
  });
});
