import type { MusicProvider, MusicTrack } from './types.js';
import { logger } from '../shared/logger.js';

interface Session {
  voiceChannelId: string;
  textChannelId: string;
  current: MusicTrack | null;
  queue: MusicTrack[];
  volume: number;
  paused: boolean;
  idleTimer?: NodeJS.Timeout;
}

export type MusicNotice = (channelId: string, message: string) => Promise<void>;

export class MusicService {
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly provider: MusicProvider, private readonly defaultVolume: number,
    private readonly idleSeconds: number, private readonly notice: MusicNotice) {
    provider.onEnd = (guildId, encoded, reason) => {
      if (reason === 'finished' || reason === 'loadFailed') void this.serial(guildId, () => this.advance(guildId, encoded, reason === 'loadFailed'));
    };
    provider.onFailure = (guildId, encoded) => { void this.serial(guildId, () => this.advance(guildId, encoded, true)); };
    provider.onOffline = () => { for (const guildId of this.sessions.keys()) void this.serial(guildId, () => this.clear(guildId)); };
  }

  available(): boolean { return this.provider.available(); }
  snapshot(guildId: string): { voiceChannelId: string; current: MusicTrack | null; queue: MusicTrack[]; volume: number; paused: boolean } | null {
    const session = this.sessions.get(guildId);
    return session ? { voiceChannelId: session.voiceChannelId, current: session.current, queue: [...session.queue], volume: session.volume, paused: session.paused } : null;
  }
  private serial<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(guildId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.catch((error: unknown) => { logger.warn({ error: error instanceof Error ? error.message : String(error), guildId }, 'Music operation failed'); });
    this.pending.set(guildId, settled);
    void settled.finally(() => { if (this.pending.get(guildId) === settled) this.pending.delete(guildId); });
    return result;
  }
  private cancelIdle(session: Session): void { if (session.idleTimer) clearTimeout(session.idleTimer); session.idleTimer = undefined; }
  private scheduleIdle(guildId: string, session: Session): void {
    this.cancelIdle(session);
    session.idleTimer = setTimeout(() => { void this.serial(guildId, async () => {
      if (this.sessions.get(guildId) === session && !session.current && session.queue.length === 0) {
        await this.clear(guildId);
        await this.safeNotice(session.textChannelId, 'Pemutar keluar dari voice karena tidak ada lagu baru.');
      }
    }); }, this.idleSeconds * 1000);
    session.idleTimer.unref();
  }
  private async safeNotice(channelId: string, message: string): Promise<void> {
    try { await this.notice(channelId, message); } catch (error) { logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'Music notice failed'); }
  }
  async play(guildId: string, voiceChannelId: string, textChannelId: string, query: string, requesterId: string): Promise<{ kind: 'playing' | 'queued'; track: MusicTrack; position: number }> {
    return this.serial(guildId, async () => {
      if (!this.available()) throw new Error('Server musik Sonata sedang offline. Coba lagi nanti.');
      const existing = this.sessions.get(guildId);
      if (existing && existing.voiceChannelId !== voiceChannelId) throw new Error('Masuk ke voice channel tempat bot berada untuk menambah lagu.');
      const track = await this.provider.resolve(query, requesterId);
      if (!track) throw new Error('Lagu tidak ditemukan. Coba judul atau URL YouTube lain.');
      let session = existing;
      if (!session) {
        await this.provider.join(guildId, voiceChannelId);
        logger.info({ guildId, voiceChannelId }, 'Voice joined');
        session = { voiceChannelId, textChannelId, current: null, queue: [], volume: this.defaultVolume, paused: false };
        this.sessions.set(guildId, session);
      }
      session.textChannelId = textChannelId;
      this.cancelIdle(session);
      if (session.current) {
        session.queue.push(track);
        logger.info({ guildId, queueLength: session.queue.length }, 'Track queued');
        return { kind: 'queued', track, position: session.queue.length };
      }
      session.current = track;
      try { await this.provider.play(guildId, track, session.volume); }
      catch (error) { session.current = null; this.scheduleIdle(guildId, session); throw error; }
      logger.info({ guildId }, 'Track started');
      return { kind: 'playing', track, position: 0 };
    });
  }
  private async advance(guildId: string, encoded?: string, failed = false): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session?.current || (encoded && session.current.encoded !== encoded)) return;
    session.current = null;
    session.paused = false;
    logger.info({ guildId, failed }, failed ? 'Track failed' : 'Track finished');
    if (failed) await this.safeNotice(session.textChannelId, 'Lagu ini gagal diputar, aku coba lanjut ke antrean berikutnya.');
    const next = await this.startNext(guildId, session);
    if (next) await this.safeNotice(session.textChannelId, `Sekarang memutar: ${next.title}`);
  }
  private async startNext(guildId: string, session: Session): Promise<MusicTrack | null> {
    while (session.queue.length) {
      const next = session.queue.shift()!;
      try {
        await this.provider.play(guildId, next, session.volume);
        session.current = next;
        logger.info({ guildId }, 'Track started');
        return next;
      } catch (error) {
        logger.warn({ guildId, message: error instanceof Error ? error.message : String(error) }, 'Could not play queued track');
        await this.safeNotice(session.textChannelId, 'Lagu ini gagal diputar, aku coba lanjut ke antrean berikutnya.');
      }
    }
    this.scheduleIdle(guildId, session);
    return null;
  }
  async skip(guildId: string): Promise<MusicTrack | null> {
    return this.serial(guildId, async () => {
      const session = this.sessions.get(guildId);
      if (!session?.current) throw new Error('Tidak ada lagu yang sedang diputar.');
      session.current = null;
      await this.provider.stopTrack(guildId);
      logger.info({ guildId }, 'Track skipped');
      return this.startNext(guildId, session);
    });
  }
  async pause(guildId: string, paused: boolean): Promise<void> {
    await this.serial(guildId, async () => {
      const session = this.sessions.get(guildId);
      if (!session?.current) throw new Error('Tidak ada lagu yang sedang diputar.');
      if (session.paused === paused) throw new Error(paused ? 'Musik sudah dijeda.' : 'Musik sudah berjalan.');
      await this.provider.pause(guildId, paused);
      session.paused = paused;
    });
  }
  async volume(guildId: string, level: number): Promise<void> {
    await this.serial(guildId, async () => {
      const session = this.sessions.get(guildId);
      if (!session) throw new Error('Bot belum memutar musik di server ini.');
      await this.provider.volume(guildId, level);
      session.volume = level;
    });
  }
  private async clear(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.sessions.delete(guildId);
    this.cancelIdle(session);
    session.current = null;
    session.queue.length = 0;
    logger.info({ guildId }, 'Music queue cleared');
    try { await this.provider.leave(guildId); } catch (error) { logger.warn({ guildId, message: error instanceof Error ? error.message : String(error) }, 'Music leave failed'); }
    logger.info({ guildId }, 'Voice disconnected');
  }
  async stop(guildId: string): Promise<void> { await this.serial(guildId, () => this.clear(guildId)); }
  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
    await this.provider.dispose?.();
  }
}
