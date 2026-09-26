import type { StudyHubDatabase } from '../database.js';

export const playlistsMigration = {
  id: '005_playlists',
  up(database: StudyHubDatabase): void {
    database.exec(`
      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        is_focus INTEGER NOT NULL DEFAULT 0 CHECK (is_focus IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (guild_id, user_id, normalized_name)
      );
      CREATE INDEX playlists_owner ON playlists (guild_id, user_id);
      CREATE UNIQUE INDEX playlists_one_focus ON playlists (guild_id, user_id) WHERE is_focus = 1;

      CREATE TABLE playlist_tracks (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        uri TEXT NOT NULL,
        author TEXT,
        duration_ms INTEGER NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (playlist_id, position)
      );
      CREATE INDEX playlist_tracks_order ON playlist_tracks (playlist_id, position);
    `);
  }
};
