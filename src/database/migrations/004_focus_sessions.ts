import type { StudyHubDatabase } from '../database.js';

export const focusSessionsMigration = {
  id: '004_focus_sessions',
  up(database: StudyHubDatabase): void {
    database.exec(`
      CREATE TABLE focus_sessions (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        started_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        completed_at INTEGER,
        stopped_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'STOPPED')),
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX focus_one_active_user
        ON focus_sessions (guild_id, user_id) WHERE status = 'ACTIVE';

      CREATE INDEX focus_completed_user
        ON focus_sessions (guild_id, user_id, completed_at)
        WHERE status = 'COMPLETED';
    `);
  }
};
