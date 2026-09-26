import type { StudyHubDatabase } from '../database/database.js';

export type Owner = { guildId: string; userId: string };
export type Playlist = { id: number; name: string; isFocus: boolean; count: number };
export type StoredTrack = { id: number; source: string; identifier: string; title: string; uri: string; author: string | null; durationMs: number; position: number };
type PlaylistRow = { id: number; name: string; is_focus: number; count: number };
type TrackRow = { id: number; source: string; identifier: string; title: string; uri: string; author: string | null; duration_ms: number; position: number };
const playlist = (row: PlaylistRow): Playlist => ({ id: row.id, name: row.name, isFocus: row.is_focus === 1, count: row.count });
const track = (row: TrackRow): StoredTrack => ({ id: row.id, source: row.source, identifier: row.identifier, title: row.title, uri: row.uri, author: row.author, durationMs: row.duration_ms, position: row.position });

export class PlaylistRepository {
  constructor(private readonly db: StudyHubDatabase) {}

  get(owner: Owner, normalizedName: string): Playlist | undefined {
    const row = this.db.prepare(`SELECT p.id, p.name, p.is_focus,
      (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS count
      FROM playlists p WHERE p.guild_id = ? AND p.user_id = ? AND p.normalized_name = ?`)
      .get(owner.guildId, owner.userId, normalizedName) as PlaylistRow | undefined;
    return row && playlist(row);
  }

  focus(owner: Owner): Playlist | undefined {
    const row = this.db.prepare(`SELECT p.id, p.name, p.is_focus,
      (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS count
      FROM playlists p WHERE p.guild_id = ? AND p.user_id = ? AND p.is_focus = 1`)
      .get(owner.guildId, owner.userId) as PlaylistRow | undefined;
    return row && playlist(row);
  }

  list(owner: Owner): Playlist[] {
    return (this.db.prepare(`SELECT p.id, p.name, p.is_focus,
      (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS count
      FROM playlists p WHERE p.guild_id = ? AND p.user_id = ? ORDER BY p.id`)
      .all(owner.guildId, owner.userId) as PlaylistRow[]).map(playlist);
  }

  create(owner: Owner, name: string, normalizedName: string, limit: number): 'created' | 'duplicate' | 'limit' {
    return this.db.transaction(() => {
      if (this.get(owner, normalizedName)) return 'duplicate';
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM playlists WHERE guild_id = ? AND user_id = ?')
        .get(owner.guildId, owner.userId) as { count: number };
      if (count.count >= limit) return 'limit';
      const now = Date.now();
      this.db.prepare(`INSERT INTO playlists (guild_id, user_id, name, normalized_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(owner.guildId, owner.userId, name, normalizedName, now, now);
      return 'created';
    })();
  }

  tracks(id: number): StoredTrack[] {
    return (this.db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id').all(id) as TrackRow[]).map(track);
  }

  add(id: number, data: Omit<StoredTrack, 'id' | 'position'>, limit: number): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(position), 0) AS last FROM playlist_tracks WHERE playlist_id = ?')
        .get(id) as { count: number; last: number };
      if (row.count >= limit) return false;
      this.db.prepare(`INSERT INTO playlist_tracks
        (playlist_id, source, identifier, title, uri, author, duration_ms, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, data.source, data.identifier, data.title, data.uri, data.author, data.durationMs, row.last + 1, Date.now());
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
      return true;
    })();
  }

  addMany(id: number, data: Array<Omit<StoredTrack, 'id' | 'position'>>, limit: number): number {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(position), 0) AS last FROM playlist_tracks WHERE playlist_id = ?')
        .get(id) as { count: number; last: number };
      const selected = data.slice(0, Math.max(0, limit - row.count));
      if (!selected.length) return 0;
      const insert = this.db.prepare(`INSERT INTO playlist_tracks
        (playlist_id, source, identifier, title, uri, author, duration_ms, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const now = Date.now();
      selected.forEach((track, index) => insert.run(id, track.source, track.identifier, track.title,
        track.uri, track.author, track.durationMs, row.last + index + 1, now));
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, id);
      return selected.length;
    })();
  }

  remove(id: number, ordinal: number): StoredTrack | undefined {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id LIMIT 1 OFFSET ?')
        .get(id, ordinal - 1) as TrackRow | undefined;
      if (!row) return undefined;
      this.db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').run(row.id, id);
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
      return track(row);
    })();
  }

  delete(id: number): void { this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id); }

  setFocus(owner: Owner, id: number | null): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE playlists SET is_focus = 0 WHERE guild_id = ? AND user_id = ? AND is_focus = 1')
        .run(owner.guildId, owner.userId);
      if (id !== null) this.db.prepare('UPDATE playlists SET is_focus = 1 WHERE id = ? AND guild_id = ? AND user_id = ?')
        .run(id, owner.guildId, owner.userId);
    })();
  }
}
