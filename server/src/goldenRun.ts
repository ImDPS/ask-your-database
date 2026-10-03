// The loop behind `npm run golden:live`, kept apart from the script so it can be
// tested with a fake provider. It never sees an API key: the provider holds it.
import type pg from 'pg';
import type { LlmProvider } from './llm/provider.js';
import { ask } from './ask.js';
import { runQuery, type QueryResult } from './executor.js';
import { GOLDEN, type Golden } from './golden.js';
import { compareResults } from './goldenCompare.js';

export interface GoldenRunOptions {
  pool: pg.Pool;
  provider: LlmProvider;
  schemaText: string;
  model: string;
  pauseMs: number;
  log?: (line: string) => void;
  golden?: Golden[];
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function runGolden(o: GoldenRunOptions): Promise<{ pass: number; total: number }> {
  const log = o.log ?? console.log;
  const golden = o.golden ?? GOLDEN;
  log(`Model: ${o.model}`);
  let pass = 0;
  let calls = 0;
  for (const g of golden) {
    let gold: QueryResult;
    try {
      gold = await runQuery(o.pool, g.goldSql);
    } catch (e) {
      // A broken gold query is our fault, not the model's: say so and move on.
      log(`FAIL ${g.id} ${g.question}  -> gold query failed: ${oneLine(e instanceof Error ? e.message : 'unknown error')}`);
      continue;
    }
    // Stay under a low per-minute free limit: pause between model calls only.
    if (calls++ > 0 && o.pauseMs > 0) await new Promise((r) => setTimeout(r, o.pauseMs));
    const out = await ask({ pool: o.pool, provider: o.provider, schemaText: o.schemaText }, g.question);
    if (!out.ok) {
      log(`FAIL ${g.id} ${g.question}  -> ${out.kind}: ${out.message}`);
      continue;
    }
    const cmp = compareResults(out.result.rows, gold.rows, g.orderMatters);
    if (cmp.same) pass++;
    log(`${cmp.same ? 'PASS' : 'DIFF'} ${g.id} ${g.question}`);
    log(`     sql: ${oneLine(out.sql)}`);
    if (!cmp.same) log(`     rows: model ${cmp.gotRows}, gold ${cmp.goldRows}`);
  }
  log(`\n${pass} of ${golden.length} match the gold answers (model ${o.model}).`);
  return { pass, total: golden.length };
}
