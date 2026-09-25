import type { StudyHubDatabase } from '../database/database.js';
import type { AiMessage } from '../ai/types.js';

export type ConversationIdentity = { guildId: string; channelId: string; userId: string };

export type ConversationSession = ConversationIdentity & {
  id: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: number;
  lastActivityAt: number;
  closedAt: number | null;
};

type SessionRow = {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: number;
  last_activity_at: number;
  closed_at: number | null;
};

export class ConversationRepository {
  constructor(private readonly database: StudyHubDatabase, private readonly maxContextMessages: number) {}

  getActive(identity: ConversationIdentity): ConversationSession | undefined {
    const row = this.database.prepare(`
      SELECT * FROM conversation_sessions
      WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND status = 'ACTIVE'
    `).get(identity.guildId, identity.channelId, identity.userId) as SessionRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      closedAt: row.closed_at
    };
  }

  start(identity: ConversationIdentity, now: number): ConversationSession {
    const result = this.database.prepare(`
      INSERT INTO conversation_sessions
        (guild_id, channel_id, user_id, status, created_at, last_activity_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).run(identity.guildId, identity.channelId, identity.userId, now, now);
    return { id: Number(result.lastInsertRowid), ...identity, status: 'ACTIVE', createdAt: now, lastActivityAt: now, closedAt: null };
  }

  touch(id: number, now: number): void {
    this.database.prepare('UPDATE conversation_sessions SET last_activity_at = ? WHERE id = ? AND status = ?')
      .run(now, id, 'ACTIVE');
  }

  close(id: number, now: number): void {
    this.database.prepare(`
      UPDATE conversation_sessions
      SET status = 'INACTIVE', last_activity_at = ?, closed_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(now, now, id);
  }

  recentMessages(id: number): AiMessage[] {
    const rows = this.database.prepare(`
      SELECT role, content FROM conversation_messages
      WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
    `).all(id, this.maxContextMessages) as AiMessage[];
    return rows.reverse();
  }

  saveExchange(id: number, userContent: string, assistantContent: string, now: number): void {
    this.database.transaction(() => {
      const insert = this.database.prepare(`
        INSERT INTO conversation_messages (conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `);
      insert.run(id, 'user', userContent, now);
      insert.run(id, 'assistant', assistantContent, now);
      this.database.prepare(`
        DELETE FROM conversation_messages
        WHERE conversation_id = ? AND id NOT IN (
          SELECT id FROM conversation_messages
          WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
        )
      `).run(id, id, this.maxContextMessages);
    })();
  }
}
