import type { LlmPrompt, LlmProvider } from './provider.js';

/** Test double: returns the replies in order, then repeats the last one. */
export class FakeProvider implements LlmProvider {
  calls: LlmPrompt[] = [];
  private i = 0;
  constructor(private replies: string[]) {}
  async generateSql(p: LlmPrompt): Promise<string> {
    this.calls.push(p);
    const r = this.replies[Math.min(this.i, this.replies.length - 1)];
    this.i++;
    return r;
  }
}
