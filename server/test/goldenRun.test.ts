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

  it('pauses between calls by the configured number of milliseconds', async () => {
    const lines: string[] = [];
    const started = Date.now();
    const schemaText = await loadSchemaDescription(pool);
    const two = GOLDEN.slice(0, 2);
    await runGolden({
      pool, schemaText, model: 'm', pauseMs: 120, log: (l) => lines.push(l), golden: two,
      provider: new FakeProvider(two.map((g) => g.goldSql)),
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(220);
  });

  it('never prints anything that looks like a key', async () => {
    const { text } = await run(new FakeProvider(GOLDEN.map((g) => g.goldSql)));
    expect(text).not.toMatch(/AIza|api[_-]?key/i);
  });
});
