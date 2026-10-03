import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../src/llm/gemini.js';
import { LlmError } from '../src/llm/provider.js';
import { FakeProvider } from '../src/llm/fake.js';

const okBody = { candidates: [{ content: { parts: [{ text: 'SELECT 1' }] } }] };
const mk = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('GeminiProvider', () => {
  it('sends key in a header, not the url, and returns the text', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(okBody)); }) as unknown as typeof fetch;
    const g = new GeminiProvider({ apiKey: 'test-key', model: 'm1', fetchImpl: f });
    expect(await g.generateSql({ system: 's', user: 'u' })).toBe('SELECT 1');
    expect(seen!.url).toContain('/models/m1:generateContent');
    expect(seen!.url).not.toContain('test-key');
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });
  it('sends system and user text in separate fields, with a timeout signal', async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => { init = i; return new Response(JSON.stringify(okBody)); }) as unknown as typeof fetch;
    await new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: f }).generateSql({ system: 'SYS', user: 'USR' });
    const body = JSON.parse(String(init!.body));
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents[0].parts[0].text).toBe('USR');
    expect(body.generationConfig.temperature).toBe(0);
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });
  it('throws LlmError on a non-200 without echoing the key', async () => {
    const g = new GeminiProvider({ apiKey: 'test-key', model: 'm', fetchImpl: mk(429, { error: { message: 'quota' } }) });
    const err = await g.generateSql({ system: 's', user: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(String(err.message)).not.toContain('test-key');
  });
  it('throws LlmError when the reply has no text', async () => {
    const g = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: mk(200, { candidates: [] }) });
    await expect(g.generateSql({ system: 's', user: 'u' })).rejects.toBeInstanceOf(LlmError);
  });
  it('throws LlmError when the reply is not JSON', async () => {
    const f = (async () => new Response('<html>oops</html>', { status: 200 })) as unknown as typeof fetch;
    const g = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: f });
    await expect(g.generateSql({ system: 's', user: 'u' })).rejects.toBeInstanceOf(LlmError);
  });
  it('maps a network failure to LlmError and never leaks the key or the cause', async () => {
    const f = (async () => { throw new Error('connect ECONNREFUSED key=test-key'); }) as unknown as typeof fetch;
    const g = new GeminiProvider({ apiKey: 'test-key', model: 'm', fetchImpl: f });
    const err = await g.generateSql({ system: 's', user: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(String(err.message)).not.toContain('test-key');
    expect(String(err.message)).not.toContain('ECONNREFUSED');
  });
});

describe('GeminiProvider replies', () => {
  const ask = (body: unknown, raw = false) => {
    const f = (async () => new Response(raw ? String(body) : JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    return new GeminiProvider({ apiKey: 'test-key', model: 'm', fetchImpl: f }).generateSql({ system: 's', user: 'u' });
  };
  const parts = (p: unknown[], finishReason?: string) => ({ candidates: [{ content: { parts: p }, ...(finishReason ? { finishReason } : {}) }] });

  it('asks for room for a long answer', async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => { init = i; return new Response(JSON.stringify(okBody)); }) as unknown as typeof fetch;
    await new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: f }).generateSql({ system: 's', user: 'u' });
    expect(JSON.parse(String(init!.body)).generationConfig.maxOutputTokens).toBe(2048);
  });
  it('joins the text of every part', async () => {
    expect(await ask(parts([{ text: 'SELECT genre_name ' }, { text: 'FROM genres' }]))).toBe('SELECT genre_name FROM genres');
  });
  it('skips thought parts', async () => {
    const out = await ask(parts([{ text: 'Let me think about joins.', thought: true }, { text: 'SELECT 1' }]));
    expect(out).toBe('SELECT 1');
  });
  it('skips parts that have no string text', async () => {
    expect(await ask(parts([{ functionCall: { name: 'x' } }, { text: 42 }, { text: 'SELECT 2' }]))).toBe('SELECT 2');
  });
  it('trims the joined text', async () => {
    expect(await ask(parts([{ text: '\n  SELECT 3  \n' }]))).toBe('SELECT 3');
  });
  it('throws LlmError when only thought parts came back', async () => {
    await expect(ask(parts([{ text: 'thinking', thought: true }]))).rejects.toBeInstanceOf(LlmError);
  });
  it('throws LlmError for whitespace-only text', async () => {
    await expect(ask(parts([{ text: '   \n ' }]))).rejects.toBeInstanceOf(LlmError);
  });
  it('turns MAX_TOKENS into a clear LlmError, even when some text came back', async () => {
    const err = await ask(parts([{ text: 'SELECT 1 FROM' }], 'MAX_TOKENS')).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toBe('The language model ran out of room for the answer. Try a shorter question.');
  });
  it('throws LlmError (not a TypeError) for a literal null body', async () => {
    const err = await ask('null', true).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).not.toBeInstanceOf(TypeError);
  });
  it('throws LlmError for odd shapes without throwing a TypeError', async () => {
    for (const body of [{}, { candidates: null }, { candidates: [null] }, { candidates: [{ content: null }] }, { candidates: [{ content: { parts: 'x' } }] }, 7, 'text']) {
      const err = await ask(body).catch((e) => e);
      expect(err).toBeInstanceOf(LlmError);
    }
  });
  it('never puts the key in any error message', async () => {
    for (const body of [null, {}, parts([{ text: ' ' }]), parts([{ text: 'x' }], 'MAX_TOKENS')]) {
      const err = await ask(body).catch((e) => e);
      expect(String(err.message)).not.toContain('test-key');
    }
  });
});

describe('FakeProvider', () => {
  it('returns replies in order, then repeats the last, and records calls', async () => {
    const f = new FakeProvider(['a', 'b']);
    expect(await f.generateSql({ system: 's1', user: 'u1' })).toBe('a');
    expect(await f.generateSql({ system: 's2', user: 'u2' })).toBe('b');
    expect(await f.generateSql({ system: 's3', user: 'u3' })).toBe('b');
    expect(f.calls.map((c) => c.user)).toEqual(['u1', 'u2', 'u3']);
  });
});
