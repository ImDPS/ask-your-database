import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool } from '../src/db.js';
import { runQuery } from '../src/executor.js';
import { EXAMPLES } from '../src/examples.js';

const pool = getReadonlyPool();
afterAll(() => pool.end());

describe('stored example queries', () => {
  it('has six examples with unique ids', () => {
    expect(EXAMPLES).toHaveLength(6);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(6);
  });
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('example %i validates, runs and returns rows', async (_id, e) => {
    const r = await runQuery(pool, e.sql);
    expect(r.rowCount).toBeGreaterThan(0);
  });
});
