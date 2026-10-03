import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';

// The validator is replaced so that a stacked statement reaches the executor.
// This proves the executor's own protocol choice refuses it, whatever the
// validator does.
vi.mock('../src/validator.js', () => ({
  validateSql: (s: string) => ({ ok: true, sql: s }),
}));

import { getReadonlyPool } from '../src/db.js';
import { runQuery, QueryFailed } from '../src/executor.js';

const pool = getReadonlyPool();
afterAll(() => pool.end());

describe('runQuery with the extended protocol', () => {
  it('refuses stacked statements even when the validator lets them through', async () => {
    // Wrapped, this becomes three statements: the first closes the wrapper.
    const stacked = 'SELECT 1) AS q; SELECT 2; SELECT * FROM (SELECT 3';
    const err = await runQuery(pool, stacked).catch((e) => e);
    expect(err).toBeInstanceOf(QueryFailed);
    expect(String(err.message)).toMatch(/cannot insert multiple commands into a prepared statement/);
  });
  it('still runs a single statement', async () => {
    const r = await runQuery(pool, 'SELECT genre_name FROM genres ORDER BY 1 LIMIT 2');
    expect(r.rows).toHaveLength(2);
  });
});
