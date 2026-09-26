import type { MusicService } from '../music/service.js';
import type { MusicTrack } from '../music/types.js';
import { logger } from '../shared/logger.js';
import { PlaylistRepository, type Owner, type Playlist, type StoredTrack } from './repository.js';

const normalize = (name: string): string => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
function validName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 40) throw new Error('Nama playlist harus 1–40 karakter.');
  return clean;
}

function youtubeId(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:') return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) :
      ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) ?
        url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v') : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function youtubePlaylistUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error('Masukkan URL playlist YouTube yang valid.'); }
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
    throw new Error('Gunakan URL playlist YouTube HTTPS.');
  }
  const id = url.searchParams.get('list');
  if (!id || !/^[\w-]{10,100}$/.test(id)) throw new Error('URL itu tidak memiliki ID playlist YouTube yang valid.');
  return `https://www.youtube.com/playlist?list=${id}`;
}

export type LoadResult = { kind: 'loaded' | 'empty' | 'busy'; loaded: number; unavailable: number };

export class PlaylistService {
  constructor(private readonly repo: PlaylistRepository, private readonly music: MusicService,
    private readonly maxPlaylists: number, private readonly maxTracks: number) {}

  get(owner: Owner, name: string): Playlist {
    const item = this.repo.get(owner, normalize(validName(name)));
    if (!item) throw new Error(`Playlist **${validName(name)}** nggak ditemukan.`);
    return item;
  }
  list(owner: Owner): Playlist[] { return this.repo.list(owner); }
  show(owner: Owner, name: string): { playlist: Playlist; tracks: StoredTrack[] } {
    const item = this.get(owner, name);
    return { playlist: item, tracks: this.repo.tracks(item.id) };
  }
  create(owner: Owner, name: string): Playlist {
    const clean = validName(name);
    const result = this.repo.create(owner, clean, normalize(clean), this.maxPlaylists);
    if (result === 'duplicate') throw new Error(`Kamu sudah punya playlist bernama **${clean}**.`);
    if (result === 'limit') throw new Error(`Batas ${this.maxPlaylists} playlist per pengguna sudah tercapai.`);
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Playlist created');
    return this.get(owner, clean);
  }
  private stored(track: MusicTrack): Omit<StoredTrack, 'id' | 'position'> {
    const identifier = youtubeId(track.uri);
    if (!identifier) throw new Error('Hanya lagu YouTube dengan video ID valid yang dapat disimpan.');
    return { source: 'youtube', identifier, title: track.title, uri: track.uri,
      author: track.author ?? null, durationMs: track.durationMs };
  }
  async add(owner: Owner, name: string, requesterId: string, query?: string): Promise<MusicTrack> {
    const item = this.get(owner, name);
    if (item.count >= this.maxTracks) throw new Error('Playlist ini sudah mencapai batas lagu.');
    let track: MusicTrack | null;
    if (query?.trim()) {
      if (/^https:\/\//i.test(query.trim())) {
        try {
          const url = new URL(query.trim());
          if (url.searchParams.has('list')) throw new Error('Untuk menambahkan banyak lagu, gunakan `/playlist import`.');
        } catch (error) { if (error instanceof Error && error.message.includes('/playlist import')) throw error; }
      }
      track = await this.music.resolveTrack(query.trim(), requesterId);
    }
    else track = this.music.snapshot(owner.guildId)?.current ?? null;
    if (!track) throw new Error(query ? 'Lagu tidak ditemukan.' : 'Tidak ada lagu yang sedang diputar. Isi query untuk mencari lagu.');
    if (!this.repo.add(item.id, this.stored(track), this.maxTracks)) throw new Error('Playlist ini sudah mencapai batas lagu.');
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Playlist track added');
    return track;
  }

  async importYoutube(owner: Owner, name: string, input: string): Promise<{ added: number; skipped: number; full: boolean }> {
    const item = this.get(owner, name);
    const slots = this.maxTracks - item.count;
    if (slots <= 0) throw new Error('Playlist ini sudah mencapai batas lagu.');
    const url = youtubePlaylistUrl(input);
    let candidates: MusicTrack[];
    try { candidates = await this.music.resolvePlaylist(url, owner.userId, slots); }
    catch (error) {
      logger.warn({ guildId: owner.guildId, message: error instanceof Error ? error.message : String(error) }, 'YouTube playlist import failed');
      throw new Error('Playlist YouTube belum bisa dibaca sekarang. Coba lagi nanti.');
    }
    if (!candidates.length) throw new Error('Playlist YouTube kosong, privat, atau belum bisa dibaca oleh Sonata.');
    const valid: Array<Omit<StoredTrack, 'id' | 'position'>> = [];
    let skipped = 0;
    for (const candidate of candidates) {
      try { valid.push(this.stored(candidate)); }
      catch { skipped++; }
    }
    const added = this.repo.addMany(item.id, valid, this.maxTracks);
    const full = valid.length > added;
    logger.info({ guildId: owner.guildId, userId: owner.userId, added, skipped, full }, 'YouTube playlist imported');
    return { added, skipped, full };
  }
  remove(owner: Owner, name: string, position: number): StoredTrack {
    const item = this.get(owner, name);
    const track = this.repo.remove(item.id, position);
    if (!track) throw new Error('Nomor lagu tidak ada di playlist tersebut.');
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Playlist track removed');
    return track;
  }
  delete(owner: Owner, name: string): Playlist {
    const item = this.get(owner, name);
    this.repo.delete(item.id);
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Playlist deleted');
    return item;
  }
  setFocus(owner: Owner, name: string): Playlist {
    const item = this.get(owner, name);
    this.repo.setFocus(owner, item.id);
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Focus playlist changed');
    return item;
  }
  unsetFocus(owner: Owner): void {
    this.repo.setFocus(owner, null);
    logger.info({ guildId: owner.guildId, userId: owner.userId }, 'Focus playlist unset');
  }
  focus(owner: Owner): Playlist | undefined { return this.repo.focus(owner); }

  async load(owner: Owner, item: Playlist, voiceChannelId: string, textChannelId: string,
    focusSessionId?: number): Promise<LoadResult> {
    const tracks = this.repo.tracks(item.id);
    if (!tracks.length) return { kind: 'empty', loaded: 0, unavailable: 0 };
    const current = this.music.snapshot(owner.guildId);
    if (focusSessionId !== undefined && (current?.current || current?.queue.length)) {
      logger.info({ guildId: owner.guildId }, 'Focus music skipped because player busy');
      return { kind: 'busy', loaded: 0, unavailable: 0 };
    }
    if (current && current.voiceChannelId !== voiceChannelId) throw new Error('Masuk ke voice channel tempat bot berada.');
    logger.info({ guildId: owner.guildId, count: tracks.length }, 'Playlist load started');
    const resolved: MusicTrack[] = [];
    let unavailable = 0;
    for (let offset = 0; offset < tracks.length; offset += 4) {
      if (!this.music.available()) { unavailable += tracks.length - offset; break; }
      const batch = tracks.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async (track) => {
        try { return await this.music.resolveTrack(`https://www.youtube.com/watch?v=${track.identifier}`, owner.userId); }
        catch { return null; }
      }));
      for (const fresh of results) {
        if (fresh) resolved.push(fresh);
        else { unavailable++; logger.warn({ guildId: owner.guildId }, 'Playlist track unavailable'); }
      }
    }
    if (!resolved.length) {
      logger.info({ guildId: owner.guildId, loaded: 0, unavailable }, 'Playlist load completed');
      return { kind: 'loaded', loaded: 0, unavailable };
    }
    const added = await this.music.enqueueResolved(owner.guildId, voiceChannelId, textChannelId, resolved, focusSessionId);
    if (added === 'busy') {
      logger.info({ guildId: owner.guildId }, 'Focus music skipped because player busy');
      return { kind: 'busy', loaded: 0, unavailable };
    }
    unavailable += resolved.length - added;
    logger.info({ guildId: owner.guildId, loaded: added, unavailable }, 'Playlist load completed');
    return { kind: 'loaded', loaded: added, unavailable };
  }
}
