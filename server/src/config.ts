export interface Config {
  port: number; dailyCap: number; rateLimitPerMinute: number;
  llmProvider: 'gemini' | 'fake'; geminiModel: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
// The model name goes into a URL path, so allow only characters that are safe there.
const MODEL_NAME = /^[A-Za-z0-9._-]+$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  if (!MODEL_NAME.test(model) || model === '.' || model === '..') {
    // Name the variable and the rule, not the value, to keep log lines tidy.
    throw new Error('GEMINI_MODEL is not valid: use only letters, digits, dot, underscore or hyphen (for example gemini-2.5-flash-lite).');
  }
  return {
    port: num(env.PORT, 8080),
    dailyCap: num(env.DAILY_LLM_CAP, 200),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 5),
    llmProvider: env.LLM_PROVIDER === 'fake' ? 'fake' : 'gemini',
    geminiModel: model,
  };
}
