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

describe('FakeProvider', () => {
  it('returns replies in order, then repeats the last, and records calls', async () => {
    const f = new FakeProvider(['a', 'b']);
    expect(await f.generateSql({ system: 's1', user: 'u1' })).toBe('a');
    expect(await f.generateSql({ system: 's2', user: 'u2' })).toBe('b');
    expect(await f.generateSql({ system: 's3', user: 'u3' })).toBe('b');
    expect(f.calls.map((c) => c.user)).toEqual(['u1', 'u2', 'u3']);
  });
});
