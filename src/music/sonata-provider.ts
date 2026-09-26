import { Client } from 'discord.js';
import { Connectors, Shoukaku, type Player } from 'shoukaku';
import type { Env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import type { MusicProvider, MusicTrack } from './types.js';
import { fetchYoutubePlaylist } from './youtube-playlist.js';

function normalizeCandidate(data: unknown, requesterId: string): MusicTrack | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  const info = candidate.info;
  if (typeof candidate.encoded !== 'string' || !info || typeof info !== 'object') return null;
  const metadata = info as Record<string, unknown>;
  return {
    encoded: candidate.encoded,
    title: typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim().slice(0, 180) : 'Judul tidak tersedia',
    uri: typeof metadata.uri === 'string' ? metadata.uri : '',
    durationMs: typeof metadata.length === 'number' ? metadata.length : 0,
    requesterId,
    source: typeof metadata.sourceName === 'string' ? metadata.sourceName : 'youtube',
    author: typeof metadata.author === 'string' ? metadata.author.slice(0, 100) : undefined,
    artworkUrl: typeof metadata.artworkUrl === 'string' ? metadata.artworkUrl : undefined
  };
}

function normalize(data: unknown, requesterId: string): MusicTrack | null {
  if (!data || typeof data !== 'object') return null;
  const result = data as Record<string, unknown>;
  const kind = String(result.loadType ?? '').toLowerCase();
  if (kind.includes('playlist') || kind.includes('error') || kind.includes('empty')) return null;
  const items = Array.isArray(result.tracks) ? result.tracks : Array.isArray(result.data) ? result.data : [result.data];
  return normalizeCandidate(items[0], requesterId);
}

export function normalizePlaylist(data: unknown, requesterId: string): MusicTrack[] {
  if (!data || typeof data !== 'object') return [];
  const body = data as Record<string, unknown>;
  const kind = String(body.loadType ?? '').toLowerCase();
  if (kind.includes('error') || kind.includes('empty') || kind.includes('fail') || kind.includes('no_matches')) return [];
  const items = Array.isArray(body.tracks) ? body.tracks : Array.isArray(body.data) ? body.data : [];
  const tracks: MusicTrack[] = [];
  for (const candidate of items) {
    const track = normalizeCandidate(candidate, requesterId);
    const info = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>).info : null;
    const identifier = info && typeof info === 'object' ? (info as Record<string, unknown>).identifier : null;
    if (track && track.source.toLowerCase() === 'youtube' && typeof identifier === 'string' && /^[\w-]{11}$/.test(identifier)) {
      tracks.push({ ...track, uri: `https://www.youtube.com/watch?v=${identifier}` });
    }
  }
  return tracks;
}

export class SonataProvider implements MusicProvider {
  readonly shoukaku: Shoukaku;
  private readonly baseUrl: string;
  private readonly players = new Map<string, Player>();
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelayMs = 5000;
  private disposed = false;
  onEnd?: MusicProvider['onEnd'];
  onFailure?: MusicProvider['onFailure'];
  onOffline?: MusicProvider['onOffline'];

  constructor(client: Client, private readonly env: Env) {
    const protocol = env.SONATA_SECURE ? 'https' : 'http';
    this.baseUrl = `${protocol}://${env.SONATA_HOST}:${env.SONATA_PORT}`;
    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{
      name: 'sonata', url: `${env.SONATA_HOST}:${env.SONATA_PORT}`,
      auth: env.SONATA_PASSWORD, secure: env.SONATA_SECURE
    }], { reconnectTries: 3, reconnectInterval: 5, restTimeout: 5, resume: false });
    this.shoukaku.on('ready', () => {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.reconnectDelayMs = 5000;
      logger.info('Sonata connected');
    });
    this.shoukaku.on('reconnecting', (_name, tries) => logger.warn({ tries }, 'Sonata reconnecting'));
    this.shoukaku.on('error', (_name, error) => { logger.warn({ message: error.message }, 'Sonata error'); this.scheduleReconnect(); });
    this.shoukaku.on('close', () => { logger.warn('Sonata connection closed'); this.onOffline?.(); this.scheduleReconnect(); });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(60000, delay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.disposed || this.available()) return;
      const node = this.shoukaku.nodes.get('sonata');
      if (!node) {
        logger.warn('Sonata disconnected; adding node again');
        this.shoukaku.addNode({ name: 'sonata', url: `${this.env.SONATA_HOST}:${this.env.SONATA_PORT}`, auth: this.env.SONATA_PASSWORD, secure: this.env.SONATA_SECURE });
      } else if (node.state === 3) {
        void node.connect().catch(() => undefined);
      }
      this.scheduleReconnect();
    }, delay);
    this.reconnectTimer.unref();
  }

  available(): boolean { return this.shoukaku.getIdealNode()?.state === 1; }
  position(guildId: string): number { return this.players.get(guildId)?.position ?? 0; }

  async resolvePlaylist(url: string, requesterId: string, limit = 200): Promise<MusicTrack[]> {
    try {
      const tracks = await fetchYoutubePlaylist(url, requesterId, limit);
      if (tracks.length) return tracks;
    } catch (error) {
      logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'YouTube playlist page unavailable; trying Sonata');
    }
    const endpoint = new URL('/v4/loadtracks', this.baseUrl);
    endpoint.searchParams.set('identifier', url);
    const response = await fetch(endpoint, {
      headers: { Authorization: this.env.SONATA_PASSWORD }, signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw new Error(`Sonata playlist request failed (${response.status}).`);
    return normalizePlaylist(await response.json(), requesterId).slice(0, limit);
  }

  async resolve(query: string, requesterId: string): Promise<MusicTrack | null> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error('Masukkan judul lagu atau URL YouTube.');
    let identifier = `ytsearch:${trimmed}`;
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
        throw new Error('Gunakan URL YouTube HTTPS atau kata kunci lagu.');
      }
      identifier = trimmed;
    } else if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
      throw new Error('Gunakan URL YouTube HTTPS atau kata kunci lagu.');
    }
    const url = new URL('/v4/loadtracks', this.baseUrl);
    url.searchParams.set('identifier', identifier);
    const response = await fetch(url, { headers: { Authorization: this.env.SONATA_PASSWORD }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Sonata search failed (${response.status}).`);
    return normalize(await response.json(), requesterId);
  }

  async join(guildId: string, voiceChannelId: string): Promise<void> {
    if (this.players.has(guildId)) return;
    const player = await this.shoukaku.joinVoiceChannel({ guildId, channelId: voiceChannelId, shardId: 0 });
    const connection = this.shoukaku.connections.get(guildId);
    if (!connection?.sessionId || !connection.serverUpdate) {
      await this.shoukaku.leaveVoiceChannel(guildId);
      throw new Error('Koneksi voice belum siap. Coba lagi.');
    }
    this.players.set(guildId, player);
    try {
      this.send(guildId, { op: 'voiceUpdate', sessionId: connection.sessionId, event: connection.serverUpdate, channelId: voiceChannelId });
    } catch (error) {
      this.players.delete(guildId);
      await this.shoukaku.leaveVoiceChannel(guildId);
      throw error;
    }
    player.on('end', (event) => this.onEnd?.(guildId, typeof event.track === 'string' ? event.track : event.track.encoded, event.reason));
    player.on('stuck', (event) => this.onFailure?.(guildId, typeof event.track === 'string' ? event.track : event.track.encoded));
    player.on('exception', () => this.onFailure?.(guildId));
    player.on('closed', () => this.onFailure?.(guildId));
  }

  private player(guildId: string): Player {
    const player = this.players.get(guildId);
    if (!player) throw new Error('Pemutar musik belum tersambung.');
    return player;
  }
  private send(guildId: string, payload: Record<string, unknown>): void {
    const node = this.shoukaku.getIdealNode();
    if (!node?.ws || node.state !== 1) throw new Error('Server musik Sonata sedang offline. Coba lagi nanti.');
    node.ws.send(JSON.stringify({ guildId, ...payload }));
  }
  async play(guildId: string, track: MusicTrack, volume: number): Promise<void> {
    this.player(guildId);
    this.send(guildId, { op: 'volume', volume });
    this.send(guildId, { op: 'play', track: track.encoded });
  }
  async pause(guildId: string, paused: boolean): Promise<void> { this.player(guildId); this.send(guildId, { op: 'pause', pause: paused }); }
  async stopTrack(guildId: string): Promise<void> { this.player(guildId); this.send(guildId, { op: 'stop' }); }
  async volume(guildId: string, level: number): Promise<void> { this.player(guildId); this.send(guildId, { op: 'volume', volume: level }); }
  async leave(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    this.players.delete(guildId);
    player?.removeAllListeners();
    if (this.available()) this.send(guildId, { op: 'destroy' });
    await this.shoukaku.leaveVoiceChannel(guildId);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const guildId of [...this.players.keys()]) await this.leave(guildId);
    const node = this.shoukaku.nodes.get('sonata');
    if (node) {
      // Shoukaku reconnects on every WebSocket close, including an intentional shutdown.
      node.ws?.removeAllListeners('close');
      this.shoukaku.removeNode('sonata', 'StudyHub shutdown');
    }
  }
}
