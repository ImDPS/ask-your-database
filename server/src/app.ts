import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import type pg from 'pg';
import type { LlmProvider } from './llm/provider.js';
import { ask, type AskOutcome } from './ask.js';
import { runQuery, QueryFailed, QueryRejected } from './executor.js';
import { MAX_QUESTION_CHARS } from './prompt.js';
import { RateLimiter, DailyCap } from './guards.js';
import { EXAMPLES } from './examples.js';
import { CATALOG } from './catalog.js';

export interface AppDeps {
  pool: pg.Pool; provider: LlmProvider; schemaText: string;
  rateLimiter: RateLimiter; dailyCap: DailyCap; staticDir?: string;
}

// A Vite-built page loads only its own scripts and styles and calls only its own /api.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const GENERIC_ERROR = 'Something went wrong on the server. Please try again.';

// Malformed JSON and oversized bodies come from express.json before any route runs.
// Answer in JSON, never with Express's HTML page or a stack trace.
const jsonErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 413) {
    return res.status(413).json({ error: { kind: 'bad_request', message: 'That request could not be read.' } });
  }
  if (status >= 400 && status < 500) {
    return res.status(400).json({ error: { kind: 'bad_request', message: 'That request could not be read.' } });
  }
  console.error('[app] unexpected failure:', err instanceof Error ? `${err.name}: ${err.message}` : 'non-Error thrown');
  return res.status(500).json({ error: { kind: 'failed', message: GENERIC_ERROR } });
};

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);              // Cloud Run puts the client in X-Forwarded-For
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': CSP,
    });
    next();
  });
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/catalog', (_req, res) => res.json(CATALOG));
  app.get('/api/examples', (_req, res) => res.json(EXAMPLES.map(({ id, question }) => ({ id, question }))));

  app.get('/api/examples/:id/answer', async (req, res) => {
    const ex = EXAMPLES.find((e) => e.id === Number(req.params.id));
    if (!ex) return res.status(404).json({ error: { kind: 'not_found', message: 'Unknown example.' } });
    try {
      const r = await runQuery(deps.pool, ex.sql);
      return res.json({ sql: ex.sql, ...r, retried: false, cached: true });
    } catch (e) {
      const m = e instanceof QueryFailed || e instanceof QueryRejected ? e.message : 'Unexpected error.';
      return res.status(500).json({ error: { kind: 'failed', message: m }, sql: ex.sql });
    }
  });

  app.post('/api/ask', async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question : '';
    const q = question.trim();
    if (!q || q.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: { kind: 'bad_question', message: q ? `Please keep the question under ${MAX_QUESTION_CHARS} characters.` : 'Please type a question.' } });
    }
    if (!deps.rateLimiter.allow(req.ip ?? 'unknown')) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: { kind: 'rate_limited', message: 'Too many questions. Please wait a minute and try again.' } });
    }
    if (!deps.dailyCap.tryTake()) {
      return res.status(503).json({ error: { kind: 'daily_cap', message: 'Today\'s free question limit is used up. The example questions still work. Please try again tomorrow.' } });
    }
    const out: AskOutcome = await ask({ pool: deps.pool, provider: deps.provider, schemaText: deps.schemaText }, q);
    if (out.ok) return res.json({ sql: out.sql, ...out.result, retried: out.retried, cached: false });
    // A failure with no sql is a server fault (ask logged it); with sql it is bad SQL after the retry.
    const status = out.kind === 'bad_question' ? 400
      : out.kind === 'llm' ? 503
      : out.kind === 'failed' && !out.sql ? 500
      : 422;
    const message = status === 500 ? GENERIC_ERROR : out.message;
    return res.status(status).json({ error: { kind: out.kind, message }, ...(out.sql ? { sql: out.sql } : {}) });
  });

  // Any other /api path is a JSON 404, never the single page app and never a static file.
  app.use('/api', (_req, res) => res.status(404).json({ error: { kind: 'not_found', message: 'Not found.' } }));

  if (deps.staticDir) {
    app.use(express.static(deps.staticDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.resolve(deps.staticDir!, 'index.html')));
  }
  app.use(jsonErrors);
  return app;
}
