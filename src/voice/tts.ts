import { EdgeTTS } from '@andresaya/edge-tts';

export interface TtsProvider { synthesize(text: string, signal: AbortSignal): Promise<Buffer>; }

export class EdgeTtsProvider implements TtsProvider {
  constructor(private readonly voice: string) {}
  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    if (signal.aborted) throw signal.reason;
    const client = new EdgeTTS();
    await client.synthesize(text, this.voice);
    if (signal.aborted) throw signal.reason;
    const audio = client.toBuffer();
    if (!audio.length) throw new Error('TTS returned empty audio.');
    return audio;
  }
}

export class TtsService {
  constructor(private readonly provider: TtsProvider) {}
  synthesize(text: string, signal: AbortSignal): Promise<Buffer> { return this.provider.synthesize(text, signal); }
}
