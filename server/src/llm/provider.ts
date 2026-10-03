export interface LlmPrompt { system: string; user: string }
export interface LlmProvider { generateSql(p: LlmPrompt): Promise<string> }
export class LlmError extends Error {}
