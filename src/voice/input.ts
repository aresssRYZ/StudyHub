import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
import OpusScript from 'opusscript';
import type { AudioReceiveStream } from '@discordjs/voice';
import { pcmDurationMs, wavFromDiscordPcm } from './audio.js';
import { logger } from '../shared/logger.js';

export class VoiceInputService {
  private subscription?: AudioReceiveStream;
  private timer?: NodeJS.Timeout;
  private readonly decoder = new OpusScript(48000, 2);
  private disposed = false;
  constructor(private readonly receiver: VoiceReceiver, private readonly ownerId: string,
    private readonly silenceMs: number, private readonly maxSeconds: number,
    private readonly canListen: () => boolean, private readonly onUtterance: (wav: Buffer, durationMs: number) => void) {
    receiver.speaking.on('start', this.onStart);
  }

  private readonly onStart = (userId: string): void => {
    if (this.disposed || userId !== this.ownerId || !this.canListen() || this.subscription) return;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let ended = false;
    const stream = this.receiver.subscribe(this.ownerId, { end: { behavior: EndBehaviorType.AfterSilence, duration: this.silenceMs } });
    this.subscription = stream;
    const finish = (): void => {
      if (ended) return;
      ended = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.subscription = undefined;
      stream.destroy();
      const durationMs = pcmDurationMs(chunks);
      if (!this.disposed && this.canListen() && durationMs >= 350 && bytes >= 48000) {
        this.onUtterance(wavFromDiscordPcm(chunks), durationMs);
      }
    };
    stream.on('data', (packet: Buffer) => {
      if (!this.canListen() || this.disposed) { finish(); return; }
      try {
        const pcm = this.decoder.decode(packet);
        chunks.push(pcm);
        bytes += pcm.length;
        if (bytes >= this.maxSeconds * 192000) finish();
      } catch { logger.warn('Voice Opus decode failed'); finish(); }
    });
    stream.once('end', finish);
    stream.once('error', () => { logger.warn('Voice receive stream failed'); finish(); });
    this.timer = setTimeout(finish, this.maxSeconds * 1000);
    this.timer.unref();
  };

  dispose(): void {
    this.disposed = true;
    this.receiver.speaking.off('start', this.onStart);
    if (this.timer) clearTimeout(this.timer);
    this.subscription?.destroy();
    this.subscription = undefined;
    this.decoder.delete();
  }
}
