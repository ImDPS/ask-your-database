import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { getReadonlyPool } from './db.js';
import { loadSchemaDescription } from './schemaDescription.js';
import { RateLimiter, DailyCap } from './guards.js';
import { GeminiProvider } from './llm/gemini.js';
import { FakeProvider } from './llm/fake.js';

const cfg = loadConfig();
const pool = getReadonlyPool();
const schemaText = await loadSchemaDescription(pool);
const key = process.env.GEMINI_API_KEY ?? '';
if (cfg.llmProvider === 'gemini' && key.length === 0) {
  // Never print the key itself, only the fact that its length is 0.
  console.error('GEMINI_API_KEY is not set (length 0). Set it or use LLM_PROVIDER=fake.');
  process.exit(1);
}
const provider = cfg.llmProvider === 'gemini'
  ? new GeminiProvider({ apiKey: key, model: cfg.geminiModel })
  : new FakeProvider(['SELECT genre_name FROM genres LIMIT 5']);
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, '../../web/dist');

createApp({ pool, provider, schemaText, rateLimiter: new RateLimiter(cfg.rateLimitPerMinute), dailyCap: new DailyCap(cfg.dailyCap), staticDir })
  .listen(cfg.port, () => console.log(`listening on ${cfg.port}`));
