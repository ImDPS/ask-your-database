// Owner-run check of the real model against the ten golden questions.
// Usage (from the repo root):   npm run golden:live -w server
// Needs GEMINI_API_KEY in the shell. Optional: GEMINI_MODEL, GOLDEN_PAUSE_MS.
// The key is read once, handed to the provider and never printed.
import 'dotenv/config';
import { getReadonlyPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { GeminiProvider } from '../src/llm/gemini.js';
import { loadSchemaDescription } from '../src/schemaDescription.js';
import { runGolden } from '../src/goldenRun.js';

const key = process.env.GEMINI_API_KEY ?? '';
if (!key) {
  console.error('GEMINI_API_KEY is not set (length 0).');
  process.exit(2);
}

const { geminiModel: model } = loadConfig(); // same default and name check as the server
const pauseMs = Number.isFinite(Number(process.env.GOLDEN_PAUSE_MS)) && process.env.GOLDEN_PAUSE_MS
  ? Number(process.env.GOLDEN_PAUSE_MS)
  : 4500;

const pool = getReadonlyPool();
try {
  const provider = new GeminiProvider({ apiKey: key, model });
  const schemaText = await loadSchemaDescription(pool);
  await runGolden({ pool, provider, schemaText, model, pauseMs });
} finally {
  await pool.end();
}
