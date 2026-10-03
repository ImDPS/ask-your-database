import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { getReadonlyPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { FakeProvider } from '../src/llm/fake.js';
import { LlmError, type LlmProvider } from '../src/llm/provider.js';
import { RateLimiter, DailyCap } from '../src/guards.js';

const pool = getReadonlyPool();
afterAll(() => pool.end());
const make = (replies: string[], perMin = 100, cap = 100, staticDir?: string) => {
  const provider = new FakeProvider(replies);
  const app = createApp({ pool, provider, schemaText: 's', rateLimiter: new RateLimiter(perMin), dailyCap: new DailyCap(cap), staticDir });
  return { app, provider };
};
const withProvider = (provider: LlmProvider) =>
  createApp({ pool, provider, schemaText: 's', rateLimiter: new RateLimiter(100), dailyCap: new DailyCap(100) });
const GENERIC = 'Something went wrong on the server. Please try again.';

describe('api', () => {
  it('answers a question with sql and rows', async () => {
    const { app } = make(['SELECT genre_name FROM genres LIMIT 2']);
    const res = await request(app).post('/api/ask').send({ question: 'two genres' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sql: expect.stringContaining('genres'), rowCount: 2, cached: false });
  });
  it('rejects an unsafe model reply with 422 and the sql shown', async () => {
    const { app } = make(['DELETE FROM customers']);
    const res = await request(app).post('/api/ask').send({ question: 'wipe it' });
    expect(res.status).toBe(422);
    expect(res.body.error.kind).toBe('rejected');
    expect(res.body.sql).toContain('DELETE');
  });
  it('returns 400 for a missing or empty question and does not call the model', async () => {
    const { app, provider } = make(['SELECT 1']);
    expect((await request(app).post('/api/ask').send({})).status).toBe(400);
    expect((await request(app).post('/api/ask').send({ question: ' ' })).status).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });
  it('returns 400 for a question over the length limit and takes no cap', async () => {
    const { app, provider } = make(['SELECT genre_name FROM genres LIMIT 1'], 100, 1);
    const res = await request(app).post('/api/ask').send({ question: 'x'.repeat(301) });
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_question');
    expect(provider.calls).toHaveLength(0);
    expect((await request(app).post('/api/ask').send({ question: 'ok' })).status).toBe(200); // the cap of 1 is still unused
  });
  it('rate limits per client with 429 and Retry-After, without a model call', async () => {
    const { app, provider } = make(['SELECT genre_name FROM genres LIMIT 1'], 1);
    expect((await request(app).post('/api/ask').send({ question: 'a' })).status).toBe(200);
    const res = await request(app).post('/api/ask').send({ question: 'b' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body.error.kind).toBe('rate_limited');
    expect(provider.calls).toHaveLength(1);
  });
  it('counts different X-Forwarded-For clients separately and limits a repeated one', async () => {
    const { app, provider } = make(['SELECT genre_name FROM genres LIMIT 1'], 1);
    const post = (ip: string) => request(app).post('/api/ask').set('X-Forwarded-For', ip).send({ question: 'a' });
    expect((await post('203.0.113.5')).status).toBe(200);
    expect((await post('203.0.113.6')).status).toBe(200);
    expect((await post('203.0.113.5')).status).toBe(429);
    expect((await post('203.0.113.6')).status).toBe(429);
    expect(provider.calls).toHaveLength(2);
  });
  it('stops at the daily cap with 503 and no model call', async () => {
    const { app, provider } = make(['SELECT genre_name FROM genres LIMIT 1'], 100, 1);
    expect((await request(app).post('/api/ask').send({ question: 'a' })).status).toBe(200);
    const res = await request(app).post('/api/ask').send({ question: 'b' });
    expect(res.status).toBe(503);
    expect(res.body.error.kind).toBe('daily_cap');
    expect(provider.calls).toHaveLength(1);
  });
  it('maps a model failure to 503', async () => {
    const down: LlmProvider = { generateSql: async () => { throw new LlmError('The language model is unavailable.'); } };
    const res = await request(withProvider(down)).post('/api/ask').send({ question: 'a' });
    expect(res.status).toBe(503);
    expect(res.body.error.kind).toBe('llm');
  });
  it('keeps 422 and shows the sql when the query still fails after the retry', async () => {
    const { app, provider } = make(['SELECT nope FROM genres']);
    const res = await request(app).post('/api/ask').send({ question: 'broken' });
    expect(res.status).toBe(422);
    expect(res.body.error.kind).toBe('failed');
    expect(res.body.sql).toBe('SELECT nope FROM genres');
    expect(provider.calls).toHaveLength(2);
  });
  it('maps a server fault (failed without sql) to 500 with the generic message', async () => {
    const boom: LlmProvider = { generateSql: async () => { throw new TypeError('internal-detail'); } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(withProvider(boom)).post('/api/ask').send({ question: 'a' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { kind: 'failed', message: GENERIC } });
      expect(JSON.stringify(res.body)).not.toContain('internal-detail');
    } finally { spy.mockRestore(); }
  });
  it('serves cached examples without the model or the cap', async () => {
    const { app, provider } = make(['unused'], 100, 0);
    const list = await request(app).get('/api/examples');
    expect(list.body).toHaveLength(6);
    expect(list.body[0]).not.toHaveProperty('sql');
    const res = await request(app).get('/api/examples/1/answer');
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(provider.calls).toHaveLength(0);
    expect((await request(app).get('/api/examples/999/answer')).status).toBe(404);
  });
  it('serves the catalog and health', async () => {
    const { app } = make(['x']);
    expect((await request(app).get('/api/catalog')).body[0].licence).toMatch(/MIT/);
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
  });
});

describe('429 and the daily cap', () => {
  it('does not take the daily cap for a rate-limited request', async () => {
    const { app, provider } = make(['SELECT genre_name FROM genres LIMIT 1'], 1, 2);
    const post = (ip: string) => request(app).post('/api/ask').set('X-Forwarded-For', ip).send({ question: 'a' });
    expect((await post('203.0.113.5')).status).toBe(200);
    expect((await post('203.0.113.5')).status).toBe(429);
    expect((await post('203.0.113.6')).status).toBe(200); // cap of 2: the 429 did not use a slot
    expect(provider.calls).toHaveLength(2);
    expect((await post('203.0.113.7')).status).toBe(503); // now both slots are used
  });
});

describe('errors that escape the handlers', () => {
  const GENERIC_BODY = { error: { kind: 'failed', message: GENERIC } };
  const brokenPool = { connect: () => { throw new Error('boom'); } } as unknown as typeof pool;
  const okProvider = new FakeProvider(['SELECT genre_name FROM genres LIMIT 1']);
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  const noLeak = (text: string) => { expect(text).not.toContain('boom'); expect(text).not.toMatch(/\bat \S+ \(|stack/i); };
  const alive = async (app: ReturnType<typeof createApp>) => {
    expect((await request(app).get('/api/health').timeout(2000)).body).toEqual({ ok: true });
  };

  it('a pool whose connect throws gives a JSON 503 for /api/ask, one model call, and the process stays up', async () => {
    // A database that cannot be reached is not the model's fault, so there is
    // no retry and no advice to rephrase.
    const provider = new FakeProvider(['SELECT genre_name FROM genres LIMIT 1']);
    const app = createApp({ pool: brokenPool, provider, schemaText: 's', rateLimiter: new RateLimiter(100), dailyCap: new DailyCap(100) });
    const spy = quiet();
    try {
      const res = await request(app).post('/api/ask').timeout(2000).send({ question: 'a' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: { kind: 'unavailable', message: 'The database is not reachable right now. Please try again in a minute.' } });
      expect(provider.calls).toHaveLength(1);
      noLeak(res.text);
      await alive(app);
    } finally { spy.mockRestore(); }
  });
  it('a provider that rejects with a plain Error gives the generic 500 and the process stays up', async () => {
    const app = withProvider({ generateSql: () => Promise.reject(new Error('boom')) });
    const spy = quiet();
    try {
      const res = await request(app).post('/api/ask').timeout(2000).send({ question: 'a' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_BODY);
      noLeak(res.text);
      await alive(app);
    } finally { spy.mockRestore(); }
  });
  it('a throw in the handler outside ask (rate limiter) reaches the JSON error handler', async () => {
    const limiter = { allow: () => { throw new Error('boom'); } } as unknown as RateLimiter;
    const app = createApp({ pool, provider: okProvider, schemaText: 's', rateLimiter: limiter, dailyCap: new DailyCap(100) });
    const spy = quiet();
    try {
      const res = await request(app).post('/api/ask').timeout(2000).send({ question: 'a' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_BODY);
      noLeak(res.text);
      expect(spy.mock.calls[0].map(String).join(' ')).toContain('Error: boom'); // name and message only
      expect(spy.mock.calls[0].every((a) => typeof a === 'string')).toBe(true);
      await alive(app);
    } finally { spy.mockRestore(); }
  });
  it('a throw in the daily cap reaches the JSON error handler', async () => {
    const cap = { tryTake: () => { throw new Error('boom'); } } as unknown as DailyCap;
    const app = createApp({ pool, provider: okProvider, schemaText: 's', rateLimiter: new RateLimiter(100), dailyCap: cap });
    const spy = quiet();
    try {
      const res = await request(app).post('/api/ask').timeout(2000).send({ question: 'a' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_BODY);
      await alive(app);
    } finally { spy.mockRestore(); }
  });
  it('a pool whose connect throws gives a JSON 503 for the cached example', async () => {
    const app = createApp({ pool: brokenPool, provider: okProvider, schemaText: 's', rateLimiter: new RateLimiter(100), dailyCap: new DailyCap(100) });
    const spy = quiet();
    try {
      const res = await request(app).get('/api/examples/1/answer').timeout(2000);
      expect(res.status).toBe(503);
      expect(res.body.error.kind).toBe('unavailable');
      expect(res.body.error.message).toMatch(/not reachable/);
      noLeak(res.text);
      await alive(app);
    } finally { spy.mockRestore(); }
  });
  it('a throw inside the cached-example handler outside its own try reaches the JSON error handler', async () => {
    const { app } = make(['x']);
    const { EXAMPLES } = await import('../src/examples.js');
    const find = vi.spyOn(EXAMPLES, 'find').mockImplementation(() => { throw new Error('boom'); });
    const spy = quiet();
    try {
      const res = await request(app).get('/api/examples/1/answer').timeout(2000);
      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_BODY);
      noLeak(res.text);
    } finally { find.mockRestore(); spy.mockRestore(); }
    await alive(app);
  });
});

describe('json errors', () => {
  const BAD = { error: { kind: 'bad_request', message: 'That request could not be read.' } };
  it('answers malformed JSON with 400 JSON, not an HTML page or a stack', async () => {
    const { app, provider } = make(['SELECT 1']);
    const res = await request(app).post('/api/ask').set('Content-Type', 'application/json').send('{"question": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(BAD);
    expect(res.text).not.toMatch(/SyntaxError|\bat |<html/i);
    expect(provider.calls).toHaveLength(0);
  });
  it('answers a body over 4kb with 413 JSON', async () => {
    const { app } = make(['SELECT 1']);
    const res = await request(app).post('/api/ask').send({ question: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(BAD);
  });
  it('answers an unknown /api route with a JSON 404, for any method', async () => {
    const { app } = make(['x']);
    const responses = [await request(app).get('/api/nope'), await request(app).post('/api/nope').send({}), await request(app).get('/api/ask')];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: { kind: 'not_found', message: 'Not found.' } });
    }
  });
});

describe('security headers', () => {
  it('sets the headers on /api/health', async () => {
    const { app } = make(['x']);
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('sets them on error responses too', async () => {
    const { app } = make(['x']);
    const res = await request(app).get('/api/nope');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('static files', () => {
  it('serves the page and falls back to it for other paths, but never for /api', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa</title>');
    try {
      const { app } = make(['x'], 100, 100, dir);
      expect((await request(app).get('/')).text).toContain('<title>spa</title>');
      expect((await request(app).get('/some/page')).text).toContain('<title>spa</title>');
      const api = await request(app).get('/api/nope');
      expect(api.status).toBe(404);
      expect(api.body.error.kind).toBe('not_found');
      expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('cached example answers are computed once per process', () => {
  const counting = () => {
    const stub = { connects: 0, fail: 0 };
    const counted = {
      connect: () => {
        stub.connects += 1;
        if (stub.fail > 0) { stub.fail -= 1; return Promise.reject(new Error('connect ECONNREFUSED')); }
        return pool.connect();
      },
    } as unknown as typeof pool;
    const app = createApp({ pool: counted, provider: new FakeProvider(['x']), schemaText: 's', rateLimiter: new RateLimiter(100), dailyCap: new DailyCap(100) });
    return { app, stub };
  };

  it('answers the second request without touching the database, with the answer of the first run', async () => {
    const { app, stub } = counting();
    const first = await request(app).get('/api/examples/1/answer');
    expect(first.status).toBe(200);
    expect(stub.connects).toBe(1);
    const second = await request(app).get('/api/examples/1/answer');
    expect(second.status).toBe(200);
    expect(stub.connects).toBe(1); // no query for the second request
    expect(second.body).toEqual(first.body); // including the original elapsedMs
    expect(second.body.cached).toBe(true);
  });
  it('keeps a separate answer for each example', async () => {
    const { app, stub } = counting();
    const a = await request(app).get('/api/examples/1/answer');
    const b = await request(app).get('/api/examples/2/answer');
    expect(stub.connects).toBe(2);
    expect(a.body.sql).not.toBe(b.body.sql);
    await request(app).get('/api/examples/2/answer');
    expect(stub.connects).toBe(2);
  });
  it('shares one run between requests that arrive together', async () => {
    const { app, stub } = counting();
    const [a, b] = await Promise.all([request(app).get('/api/examples/3/answer'), request(app).get('/api/examples/3/answer')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(stub.connects).toBe(1);
  });
  it('does not remember a failure: the next request tries again, then the success is kept', async () => {
    const { app, stub } = counting();
    stub.fail = 1;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await request(app).get('/api/examples/1/answer')).status).toBe(503);
      expect(stub.connects).toBe(1);
      expect((await request(app).get('/api/examples/1/answer')).status).toBe(200);
      expect(stub.connects).toBe(2);
      expect((await request(app).get('/api/examples/1/answer')).status).toBe(200);
      expect(stub.connects).toBe(2);
    } finally { spy.mockRestore(); }
  });
});
