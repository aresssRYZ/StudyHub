import type { AiProvider, AiRequest } from '../types.js';
import { postJson, ProviderError } from './http.js';

export class GroqProvider implements AiProvider {
  readonly name = 'groq';

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generate({ systemPrompt, history, userMessage }: AiRequest): Promise<string> {
    const data = await postJson(this.name, 'https://api.groq.com/openai/v1/chat/completions', {
      Authorization: `Bearer ${this.apiKey}`
    }, {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
      ],
      max_completion_tokens: 4096
    }) as { choices?: Array<{ message?: { content?: unknown } }> } | null;

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ProviderError(this.name, 'server');
    return content.trim();
  }
}
