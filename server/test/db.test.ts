import { describe, it, expect, vi, afterEach } from 'vitest';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';

// No live database: a pool is created lazily and never connects unless a query is run.
const DUMMY = 'postgres://nobody:not-a-real-password@127.0.0.1:1/none';

describe('pool factories', () => {
  const saved = { ro: process.env.DATABASE_URL_READONLY, owner: process.env.DATABASE_URL_OWNER };
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.ro === undefined) delete process.env.DATABASE_URL_READONLY; else process.env.DATABASE_URL_READONLY = saved.ro;
    if (saved.owner === undefined) delete process.env.DATABASE_URL_OWNER; else process.env.DATABASE_URL_OWNER = saved.owner;
  });

  it.each([
    ['read-only', 'DATABASE_URL_READONLY', getReadonlyPool],
    ['owner', 'DATABASE_URL_OWNER', getOwnerPool],
  ] as const)('%s pool survives an idle client error and logs only name and message', async (_label, key, factory) => {
    process.env[key] = DUMMY;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = factory();
    try {
      expect(pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
      // Without a listener, EventEmitter throws on 'error', which would end the process.
      expect(() => pool.emit('error', new Error('idle drop'))).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0];
      expect(args.every((a) => typeof a === 'string')).toBe(true);
      expect(args.join(' ')).toContain('Error');
      expect(args.join(' ')).toContain('idle drop');
    } finally {
      await pool.end();
    }
  });

  it('still throws a clear error when the variable is not set', () => {
    delete process.env.DATABASE_URL_READONLY;
    expect(() => getReadonlyPool()).toThrow('DATABASE_URL_READONLY is not set');
  });
});
