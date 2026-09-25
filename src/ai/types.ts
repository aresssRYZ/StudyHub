export type AiMessage = { role: 'user' | 'assistant'; content: string };

export type AiRequest = {
  systemPrompt: string;
  history: AiMessage[];
  userMessage: string;
};

export interface AiProvider {
  readonly name: 'groq' | 'gemini';
  generate(request: AiRequest): Promise<string>;
}
