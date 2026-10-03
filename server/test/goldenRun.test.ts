import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { getReadonlyPool } from '../src/db.js';
import { FakeProvider } from '../src/llm/fake.js';
import { LlmError, type LlmProvider } from '../src/llm/provider.js';
import { loadSchemaDescription } from '../src/schemaDescription.js';
import { GOLDEN } from '../src/golden.js';
import { runGolden } from '../src/goldenRun.js';

// The live script's logic, run against a fake provider only. No key, no network.
const pool = getReadonlyPool();
afterAll(() => pool.end());

async function run(provider: LlmProvider, model = 'test-model') {
  const lines: string[] = [];
  const schemaText = await loadSchemaDescription(pool);
  const out = await runGolden({ pool, provider, schemaText, model, pauseMs: 0, log: (l) => lines.push(l) });
  return { out, text: lines.join('\n'), lines };
}

describe('runGolden', () => {
  it('scores 10 of 10 when the model returns the gold SQL, fenced or not', async () => {
    const replies = GOLDEN.map((g) => '```sql\n' + g.goldSql + '\n```');
    const { out, text } = await run(new FakeProvider(replies), 'fake-model');
    expect(out).toEqual({ pass: 10, total: 10 });
    expect(text).toContain('10 of 10 match the gold answers (model fake-model).');
    expect(text.startsWith('Model: fake-model')).toBe(true);
    expect(text).not.toMatch(/DIFF|FAIL/);
  });

  it('ignores column names but not extra columns', async () => {
    const replies = GOLDEN.map((g) => g.goldSql);
    replies[3] = 'SELECT count(*)::int AS how_many FROM customers'; // renamed only: still a match
    replies[7] = 'SELECT round(avg(total), 2) AS a, 1 AS extra FROM invoices'; // extra column: DIFF
    const { out, text } = await run(new FakeProvider(replies));
    expect(out.pass).toBe(9);
    expect(text).toMatch(/PASS 4 /);
    expect(text).toMatch(/DIFF 8 /);
  });

  it('counts an unrounded average as a match (fractions are compared to 2 decimals)', async () => {
    const replies = GOLDEN.map((g) => g.goldSql);
    replies[7] = 'SELECT avg(total) FROM invoices'; // 5.6519..., gold is 5.65
    const { out, text } = await run(new FakeProvider(replies));
    expect(out.pass).toBe(10);
    expect(text).toMatch(/PASS 8 /);
  });

  it('prints, for a DIFF, the SQL on one line and the row count of each side', async () => {
    const replies = GOLDEN.map((g) => g.goldSql);
    replies[0] = 'SELECT billing_country,\n       sum(total)\nFROM invoices\nGROUP BY billing_country\nLIMIT 3';
    const { out, lines } = await run(new FakeProvider(replies));
    expect(out.pass).toBe(9);
    const i = lines.findIndex((l) => l.startsWith('DIFF 1 '));
    expect(i).toBeGreaterThanOrEqual(0);
    const detail = lines.slice(i, i + 4).join('\n');
    expect(detail).toContain('sql: SELECT billing_country, sum(total) FROM invoices GROUP BY billing_country LIMIT 3');
    expect(detail).toMatch(/rows: model 3, gold 5/);
    expect(lines[i].includes('\n')).toBe(false);
  });

  it('prints the kind and message on a model error, and keeps going', async () => {
    const provider: LlmProvider = {
      async generateSql() {
        throw new LlmError('The language model is busy right now.');
      },
    };
    const { out, text } = await run(provider);
    expect(out).toEqual({ pass: 0, total: 10 });
    expect(text).toContain('FAIL 1 ');
    expect(text).toContain('llm: The language model is busy right now.');
    expect(text).toContain('FAIL 10 ');
    expect(text).toContain('0 of 10 match the gold answers (model test-model).');
  });

  it('reports a rejected query as a failure with its kind', async () => {
    const { out, text } = await run(new FakeProvider(['DELETE FROM customers']));
    expect(out.pass).toBe(0);
    expect(text).toMatch(/FAIL 1 .*rejected: /);
  });

  it('pauses between calls (not before the first) by the configured milliseconds', async () => {
    const schemaText = await loadSchemaDescription(pool);
    const one = GOLDEN.slice(0, 1);
    const two = GOLDEN.slice(0, 2);
    const timed = async (golden: typeof GOLDEN) => {
      const started = Date.now();
      await runGolden({
        pool, schemaText, model: 'm', pauseMs: 400, log: () => {}, golden,
        provider: new FakeProvider(golden.map((g) => g.goldSql)),
      });
      return Date.now() - started;
    };
    expect(await timed(one)).toBeLessThan(350); // no pause before the first call
    expect(await timed(two)).toBeGreaterThanOrEqual(390); // one pause between two calls
  });

  it('prints a FAIL line when a gold query fails, skips the model for it and carries on to the summary', async () => {
    const lines: string[] = [];
    const schemaText = await loadSchemaDescription(pool);
    const bad: typeof GOLDEN = [
      { ...GOLDEN[0], id: 1, goldSql: 'SELECT nope FROM customers' },
      { ...GOLDEN[1], id: 2, goldSql: 'DELETE FROM customers' },
      GOLDEN[3],
    ];
    const provider = new FakeProvider([GOLDEN[3].goldSql]);
    const out = await runGolden({ pool, schemaText, provider, model: 'm', pauseMs: 0, log: (l) => lines.push(l), golden: bad });
    const text = lines.join('\n');
    expect(out).toEqual({ pass: 1, total: 3 });
    expect(text).toMatch(/FAIL 1 .*gold query failed: /);
    expect(text).toMatch(/FAIL 2 .*gold query failed: /);
    expect(text).toMatch(/PASS 4 /);
    expect(provider.calls).toHaveLength(1);
    expect(text).toContain('1 of 3 match the gold answers (model m).');
  });

  it('never prints anything that looks like a key', async () => {
    const { text } = await run(new FakeProvider(GOLDEN.map((g) => g.goldSql)));
    expect(text).not.toMatch(/AIza|api[_-]?key/i);
  });
});
