import { LlmError, type LlmPrompt, type LlmProvider } from './provider.js';

type GeminiReply = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export class GeminiProvider implements LlmProvider {
  private fetchImpl: typeof fetch;
  constructor(private o: { apiKey: string; model: string; fetchImpl?: typeof fetch }) {
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  // The key travels only in the x-goog-api-key header. It is never put in the
  // URL, and the messages below never include the key, the response body or
  // the underlying error, so nothing here can leak it into a log or a reply.
  async generateSql(p: LlmPrompt): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.o.model}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: p.system }] },
          contents: [{ role: 'user', parts: [{ text: p.user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new LlmError('The language model could not be reached.');
    }
    if (!res.ok) throw new LlmError(`The language model returned status ${res.status}.`);
    let json: GeminiReply;
    try {
      json = (await res.json()) as GeminiReply;
    } catch {
      throw new LlmError('The language model returned an unreadable answer.');
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new LlmError('The language model returned no answer.');
    return text;
  }
}
