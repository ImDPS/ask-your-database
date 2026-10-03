export interface Config {
  port: number; dailyCap: number; rateLimitPerMinute: number;
  llmProvider: 'gemini' | 'fake'; geminiModel: string;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    port: num(env.PORT, 8080),
    dailyCap: num(env.DAILY_LLM_CAP, 200),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 5),
    llmProvider: env.LLM_PROVIDER === 'fake' ? 'fake' : 'gemini',
    geminiModel: env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
  };
}
