import type { AiProvider, AiRequest } from '../types.js';
import { postJson, ProviderError } from './http.js';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generate({ systemPrompt, history, userMessage }: AiRequest): Promise<string> {
    const data = await postJson(
      this.name,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [...history, { role: 'user', content: userMessage }].map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        generationConfig: { maxOutputTokens: 4096 }
      }
    ) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }> } | null;

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => !part.thought && typeof part.text === 'string' ? part.text : '')
      .join('')
      .trim();
    if (!text) throw new ProviderError(this.name, 'server');
    return text;
  }
}
