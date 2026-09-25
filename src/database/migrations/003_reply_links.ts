import type { StudyHubDatabase } from '../database.js';

export const replyLinksMigration = {
  id: '003_reply_links',
  up(database: StudyHubDatabase): void {
    database.exec(`
      CREATE TABLE conversation_reply_links (
        message_id TEXT PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX conversation_reply_links_session
        ON conversation_reply_links (conversation_id);
    `);
  }
};
