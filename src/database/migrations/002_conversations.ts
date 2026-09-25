import type { StudyHubDatabase } from '../database.js';

export const conversationsMigration = {
  id: '002_conversations',
  up(database: StudyHubDatabase): void {
    database.exec(`
        CREATE TABLE conversation_sessions (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      CREATE UNIQUE INDEX conversation_active_identity
        ON conversation_sessions (guild_id, channel_id, user_id)
        WHERE status = 'ACTIVE';

      CREATE TABLE conversation_messages (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX conversation_messages_recent
        ON conversation_messages (conversation_id, id DESC);
    `);
  }
};
