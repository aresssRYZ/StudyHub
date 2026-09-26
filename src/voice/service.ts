import { Readable } from 'node:stream';
import {
  AudioPlayerStatus, VoiceConnectionStatus, createAudioPlayer, createAudioResource,
  entersState, joinVoiceChannel, type AudioPlayer, type VoiceConnection
} from '@discordjs/voice';
import type { Client, VoiceBasedChannel, VoiceState } from 'discord.js';
import type { Env } from '../config/env.js';
import type { MusicService } from '../music/service.js';
import { logger } from '../shared/logger.js';
import { VoiceConversationService, type VoiceMode } from './conversation.js';
import { VoiceInputService } from './input.js';
import { SttService } from './stt.js';
import { TtsService } from './tts.js';

export type VoiceStateName = 'LISTENING' | 'PROCESSING' | 'SPEAKING';
type Session = {
  guildId: string; voiceChannelId: string; textChannelId: string; ownerId: string;
  mode: VoiceMode; state: VoiceStateName; createdAt: number; lastActivityAt: number;
  connection?: VoiceConnection; player?: AudioPlayer; input?: VoiceInputService;
  conversation: VoiceConversationService; abort: AbortController; idle?: NodeJS.Timeout;
};
export type VoiceSnapshot = Pick<Session, 'voiceChannelId' | 'ownerId' | 'mode' | 'state' | 'createdAt'>;

export class VoiceService {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly client: Client, private readonly music: MusicService, private readonly env: Env,
    private readonly stt: SttService, private readonly tts: TtsService,
    private readonly createConversation: () => VoiceConversationService) {}

  active(guildId: string): boolean { return this.sessions.has(guildId); }
  snapshot(guildId: string): VoiceSnapshot | null {
    const s = this.sessions.get(guildId);
    return s ? { voiceChannelId: s.voiceChannelId, ownerId: s.ownerId, mode: s.mode, state: s.state, createdAt: s.createdAt } : null;
  }

  async join(channel: VoiceBasedChannel, textChannelId: string, ownerId: string): Promise<void> {
    const guildId = channel.guild.id;
    if (this.sessions.has(guildId)) throw new Error('Voice AI sudah aktif di server ini.');
    if (this.music.occupied(guildId)) throw new Error('Music masih aktif. Stop musik dulu sebelum masuk Voice AI ya.');
    const session: Session = {
      guildId, voiceChannelId: channel.id, textChannelId, ownerId, mode: 'assistant',
      state: 'LISTENING', createdAt: Date.now(), lastActivityAt: Date.now(),
      conversation: this.createConversation(), abort: new AbortController()
    };
    this.sessions.set(guildId, session);
    try {
      const connection = joinVoiceChannel({ channelId: channel.id, guildId,
        adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false, group: 'studyhub-ai' });
      session.connection = connection;
      connection.on(VoiceConnectionStatus.Disconnected, () => { void this.close(guildId, session); });
      connection.on('error', () => { logger.warn({ guildId }, 'Voice AI connection error'); void this.close(guildId, session); });
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      if (this.sessions.get(guildId) !== session) throw new Error('Voice AI session closed during join.');
      const player = createAudioPlayer();
      session.player = player;
      connection.subscribe(player);
      player.on('error', () => { logger.warn({ guildId }, 'Voice AI playback error'); });
      session.input = new VoiceInputService(connection.receiver, ownerId, this.env.VOICE_END_SILENCE_MS,
        this.env.VOICE_MAX_UTTERANCE_SECONDS, () => this.sessions.get(guildId) === session && session.state === 'LISTENING',
        (wav, durationMs) => { void this.process(session, wav, durationMs); });
      this.resetIdle(session);
      logger.info({ guildId, ownerId }, 'Voice AI joined');
    } catch (error) {
      await this.close(guildId, session);
      throw error;
    }
  }

  mode(guildId: string, ownerId: string, mode: VoiceMode): void {
    const s = this.requireOwner(guildId, ownerId);
    s.mode = mode;
  }

  async leave(guildId: string, ownerId: string): Promise<void> {
    const s = this.requireOwner(guildId, ownerId);
    await this.close(guildId, s);
  }

  private requireOwner(guildId: string, ownerId: string): Session {
    const s = this.sessions.get(guildId);
    if (!s) throw new Error('Voice AI belum aktif di server ini.');
    if (s.ownerId !== ownerId) throw new Error('Hanya pemilik sesi Voice AI yang bisa mengubah atau mengakhirinya.');
    return s;
  }

  onVoiceState(oldState: VoiceState, newState: VoiceState): void {
    const s = this.sessions.get(oldState.guild.id);
    if (!s) return;
    if (oldState.id === s.ownerId && oldState.channelId === s.voiceChannelId && newState.channelId !== s.voiceChannelId) {
      void this.close(s.guildId, s);
    } else if (oldState.id === this.client.user?.id && newState.channelId !== s.voiceChannelId) {
      void this.close(s.guildId, s);
    }
  }

  private resetIdle(s: Session): void {
    if (s.idle) clearTimeout(s.idle);
    s.idle = setTimeout(() => {
      if (this.sessions.get(s.guildId) === s && Date.now() - s.lastActivityAt >= this.env.VOICE_SESSION_IDLE_MINUTES * 60_000) {
        void this.close(s.guildId, s).then(() => this.notify(s, 'Voice AI keluar karena tidak ada percakapan.'));
      } else if (this.sessions.get(s.guildId) === s) this.resetIdle(s);
    }, this.env.VOICE_SESSION_IDLE_MINUTES * 60_000);
    s.idle.unref();
  }

  private async process(s: Session, wav: Buffer, durationMs: number): Promise<void> {
    if (this.sessions.get(s.guildId) !== s || s.state !== 'LISTENING') return;
    s.state = 'PROCESSING';
    s.lastActivityAt = Date.now();
    this.resetIdle(s);
    const started = performance.now();
    let sttMs = 0, llmMs = 0, ttsMs = 0, responseStartMs = 0;
    try {
      let transcript: string;
      try {
        transcript = await this.timed(s, 20_000, (signal) => this.stt.transcribe(wav, signal));
      } catch (error) {
        logger.warn({ guildId: s.guildId, type: error instanceof Error ? error.name : 'unknown' }, 'Voice STT failed');
        await this.sayOrNotify(s, 'Maaf, tadi aku kurang nangkep. Coba ulangi sekali lagi ya.');
        return;
      } finally {
        wav = Buffer.alloc(0);
      }
      sttMs = Math.round(performance.now() - started);
      if (!transcript || /^[\s.,!?…\-]+$/.test(transcript)) return;
      if (this.sessions.get(s.guildId) !== s) return;
      let answer: string;
      const llmStart = performance.now();
      try { answer = await this.timed(s, 30_000, (signal) => s.conversation.respond(transcript, s.mode, signal)); }
      catch (error) {
        logger.warn({ guildId: s.guildId, type: error instanceof Error ? error.name : 'unknown' }, 'Voice LLM failed');
        await this.sayOrNotify(s, 'Maaf, aku lagi susah mikir sebentar. Coba ulangi lagi ya.');
        return;
      }
      llmMs = Math.round(performance.now() - llmStart);
      if (this.sessions.get(s.guildId) !== s) return;
      try {
        await this.say(s, answer, (ms) => { ttsMs = ms; }, () => { responseStartMs = Math.round(performance.now() - started); });
      } catch (error) {
        logger.warn({ guildId: s.guildId, type: error instanceof Error ? error.name : 'unknown' }, 'Voice TTS or playback failed');
        await this.notify(s, answer);
      }
    } finally {
      logger.info({ guildId: s.guildId, mode: s.mode, audioMs: Math.round(durationMs), sttMs, llmMs, ttsMs, responseStartMs,
        totalMs: Math.round(performance.now() - started) }, 'Voice utterance completed');
      if (this.sessions.get(s.guildId) === s) { s.state = 'LISTENING'; s.lastActivityAt = Date.now(); this.resetIdle(s); }
    }
  }

  private async timed<T>(s: Session, ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeout = AbortSignal.timeout(ms);
    const signal = AbortSignal.any([s.abort.signal, timeout]);
    let abortHandler: (() => void) | undefined;
    try {
      return await Promise.race([task(signal), new Promise<T>((_, reject) => {
        abortHandler = () => reject(signal.reason);
        if (signal.aborted) abortHandler();
        else signal.addEventListener('abort', abortHandler, { once: true });
      })]);
    } finally { if (abortHandler) signal.removeEventListener('abort', abortHandler); }
  }

  private async sayOrNotify(s: Session, message: string): Promise<void> {
    try { await this.say(s, message); } catch { await this.notify(s, message); }
  }

  private async say(s: Session, message: string, onSynthesis?: (ms: number) => void, onPlaying?: () => void): Promise<void> {
    const started = performance.now();
    const audio = await this.timed(s, 20_000, (signal) => this.tts.synthesize(message, signal));
    onSynthesis?.(Math.round(performance.now() - started));
    if (this.sessions.get(s.guildId) !== s || !s.player) return;
    s.state = 'SPEAKING';
    const resource = createAudioResource(Readable.from(audio));
    const player = s.player;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); player.stop(true); reject(new Error('Voice playback timed out.')); }, 60_000);
      const onIdle = (): void => { cleanup(); resolve(); };
      const onError = (error: Error): void => { cleanup(); reject(error); };
      const onAbort = (): void => { cleanup(); reject(s.abort.signal.reason); };
      const onStart = (): void => { player.off(AudioPlayerStatus.Playing, onStart); onPlaying?.(); };
      const cleanup = (): void => {
        clearTimeout(timer); player.off(AudioPlayerStatus.Idle, onIdle); player.off('error', onError);
        player.off(AudioPlayerStatus.Playing, onStart);
        s.abort.signal.removeEventListener('abort', onAbort);
      };
      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once(AudioPlayerStatus.Playing, onStart);
      player.once('error', onError);
      s.abort.signal.addEventListener('abort', onAbort, { once: true });
      player.play(resource);
    });
  }

  private async notify(s: Session, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(s.textChannelId);
      if (channel?.isSendable()) await channel.send({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
    } catch { logger.warn({ guildId: s.guildId }, 'Voice AI text fallback failed'); }
  }

  private async close(guildId: string, s: Session): Promise<void> {
    if (this.sessions.get(guildId) !== s) return;
    this.sessions.delete(guildId);
    s.abort.abort(new Error('Voice AI session closed.'));
    if (s.idle) clearTimeout(s.idle);
    s.input?.dispose();
    s.player?.stop(true);
    if (s.connection && s.connection.state.status !== VoiceConnectionStatus.Destroyed) s.connection.destroy();
    s.conversation.clear();
    logger.info({ guildId }, 'Voice AI left');
  }

  async dispose(): Promise<void> { await Promise.all([...this.sessions].map(([guildId, s]) => this.close(guildId, s))); }
}
