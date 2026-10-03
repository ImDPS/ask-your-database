import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses the documented defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 8080, dailyCap: 200, rateLimitPerMinute: 5, llmProvider: 'gemini', geminiModel: 'gemini-2.5-flash-lite',
    });
  });
  it('reads numbers and the model from the environment', () => {
    const c = loadConfig({ PORT: '3000', DAILY_LLM_CAP: '50', RATE_LIMIT_PER_MINUTE: '2', GEMINI_MODEL: 'gemini-2.5-flash' });
    expect(c).toMatchObject({ port: 3000, dailyCap: 50, rateLimitPerMinute: 2, geminiModel: 'gemini-2.5-flash' });
  });
  it.each([['abc'], [''], ['Infinity'], ['NaN'], ['12px']])('falls back to the defaults for the non-numeric value %j', (v) => {
    const c = loadConfig({ PORT: v, DAILY_LLM_CAP: v, RATE_LIMIT_PER_MINUTE: v });
    expect(c).toMatchObject({ port: 8080, dailyCap: 200, rateLimitPerMinute: 5 });
  });
  it('uses the fake provider only when LLM_PROVIDER is exactly "fake"', () => {
    expect(loadConfig({ LLM_PROVIDER: 'fake' }).llmProvider).toBe('fake');
    expect(loadConfig({ LLM_PROVIDER: 'gemini' }).llmProvider).toBe('gemini');
    expect(loadConfig({}).llmProvider).toBe('gemini');
    // Anything else falls back to gemini, which needs a key, so a typo cannot silently fake answers.
    expect(loadConfig({ LLM_PROVIDER: 'FAKE' }).llmProvider).toBe('gemini');
    expect(loadConfig({ LLM_PROVIDER: 'openai' }).llmProvider).toBe('gemini');
  });
  it('uses the default model when GEMINI_MODEL is empty', () => {
    expect(loadConfig({ GEMINI_MODEL: '' }).geminiModel).toBe('gemini-2.5-flash-lite');
  });
  it.each([['gemini/../../x'], ['a b'], ['model?key=1'], ['m#1'], ['m%2F'], ['m:generate'], ['a\nb']])(
    'rejects the model name %j, which is not safe in a URL path',
    (name) => {
      expect(() => loadConfig({ GEMINI_MODEL: name })).toThrow(/GEMINI_MODEL/);
    },
  );
  it('names the rule in the error and never echoes the key', () => {
    const env = { GEMINI_MODEL: 'bad name', GEMINI_API_KEY: 'k-secret-value' };
    expect(() => loadConfig(env)).toThrow(/letters, digits, dot, underscore or hyphen/);
    try { loadConfig(env); } catch (e) {
      expect((e as Error).message).not.toContain('k-secret-value');
    }
  });
});
