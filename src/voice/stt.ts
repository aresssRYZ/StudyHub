export interface SttProvider { transcribe(wav: Buffer, signal: AbortSignal): Promise<string>; }

export class GroqWhisperProvider implements SttProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly language: string) {}

  async transcribe(wav: Buffer, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', this.model);
    form.set('response_format', 'json');
    if (this.language) form.set('language', this.language);
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}` }, body: form, signal
    });
    if (!response.ok) throw new Error(`Groq STT failed (HTTP ${response.status}).`);
    const result = await response.json() as { text?: unknown };
    if (typeof result.text !== 'string') throw new Error('Groq STT returned an invalid response.');
    return result.text.trim();
  }
}

export class SttService {
  constructor(private readonly provider: SttProvider) {}
  transcribe(wav: Buffer, signal: AbortSignal): Promise<string> { return this.provider.transcribe(wav, signal); }
}
