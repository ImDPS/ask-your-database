import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool, getOwnerPool } from '../src/db.js';
import { runQuery, MAX_ROWS } from '../src/executor.js';
import { validateSql } from '../src/validator.js';
import { GOLDEN } from '../src/golden.js';
import { canonicalRows } from '../src/goldenCompare.js';

const ro = getReadonlyPool();
const owner = getOwnerPool();
afterAll(async () => {
  await ro.end();
  await owner.end();
});

describe('golden questions: shape', () => {
  it('has exactly ten, numbered 1 to 10', () => {
    expect(GOLDEN).toHaveLength(10);
    expect(GOLDEN.map((g) => g.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('has ten distinct questions, each with non-empty gold and raw SQL', () => {
    expect(new Set(GOLDEN.map((g) => g.question.trim().toLowerCase())).size).toBe(10);
    expect(new Set(GOLDEN.map((g) => g.goldSql.replace(/\s+/g, ' ').trim())).size).toBe(10);
    for (const g of GOLDEN) {
      expect(g.question.trim().length).toBeGreaterThan(0);
      expect(g.goldSql.trim().length).toBeGreaterThan(0);
      expect(g.rawSql.trim().length).toBeGreaterThan(0);
      expect(g.goldSql).not.toEqual(g.rawSql);
    }
  });

  it('keeps the two sides separate: gold reads only views, raw reads only public tables', () => {
    for (const g of GOLDEN) {
      expect(g.rawSql, `raw ${g.id}`).not.toMatch(/\bapp\./i);
      expect(g.rawSql, `raw ${g.id}`).toMatch(/\bpublic\./i);
      expect(g.goldSql, `gold ${g.id}`).not.toMatch(/\bpublic\./i);
    }
  });
});

describe('golden questions: the views agree with the raw tables', () => {
  it.each(GOLDEN.map((g) => [g.id, g] as const))('question %i: gold on views equals raw SQL on tables', async (_i, g) => {
    const viaViews = await runQuery(ro, g.goldSql);
    const raw = await owner.query({ text: g.rawSql, rowMode: 'object' });
    expect(viaViews.rowCount).toBeGreaterThan(0);
    expect(canonicalRows(viaViews.rows, g.orderMatters)).toEqual(canonicalRows(raw.rows, g.orderMatters));
  });
});

describe('golden questions: gold SQL is valid for the live app path', () => {
  it.each(GOLDEN.map((g) => [g.id, g] as const))('question %i: gold passes the validator and runs as the read-only role', async (_i, g) => {
    const v = validateSql(g.goldSql);
    expect(v.ok, v.ok ? '' : v.reason).toBe(true);
    const res = await runQuery(ro, g.goldSql);
    expect(res.rowCount).toBeGreaterThan(0);
    expect(res.truncated).toBe(false);
    expect(res.rowCount).toBeLessThanOrEqual(MAX_ROWS);
  });
});
