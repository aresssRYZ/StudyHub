import type { StudyHubDatabase } from '../database/database.js';

export type FocusIdentity = { guildId: string; userId: string };
export type FocusSession = FocusIdentity & {
  id: number;
  channelId: string;
  durationMinutes: number;
  startedAt: number;
  endsAt: number;
  completedAt: number | null;
  stoppedAt: number | null;
  status: 'ACTIVE' | 'COMPLETED' | 'STOPPED';
};

type FocusRow = {
  id: number; guild_id: string; user_id: string; channel_id: string;
  duration_minutes: number; started_at: number; ends_at: number;
  completed_at: number | null; stopped_at: number | null;
  status: FocusSession['status'];
};

function fromRow(row: FocusRow): FocusSession {
  return {
    id: row.id, guildId: row.guild_id, userId: row.user_id, channelId: row.channel_id,
    durationMinutes: row.duration_minutes, startedAt: row.started_at, endsAt: row.ends_at,
    completedAt: row.completed_at, stoppedAt: row.stopped_at, status: row.status
  };
}

export class FocusRepository {
  constructor(private readonly database: StudyHubDatabase) {}

  getActive(identity: FocusIdentity): FocusSession | undefined {
    const row = this.database.prepare(`
      SELECT * FROM focus_sessions WHERE guild_id = ? AND user_id = ? AND status = 'ACTIVE'
    `).get(identity.guildId, identity.userId) as FocusRow | undefined;
    return row && fromRow(row);
  }

  getById(id: number): FocusSession | undefined {
    const row = this.database.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id) as FocusRow | undefined;
    return row && fromRow(row);
  }

  listActive(): FocusSession[] {
    return (this.database.prepare("SELECT * FROM focus_sessions WHERE status = 'ACTIVE'").all() as FocusRow[]).map(fromRow);
  }

  start(identity: FocusIdentity, channelId: string, durationMinutes: number, now: number): FocusSession | undefined {
    const endsAt = now + durationMinutes * 60_000;
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO focus_sessions
        (guild_id, user_id, channel_id, duration_minutes, started_at, ends_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `).run(identity.guildId, identity.userId, channelId, durationMinutes, now, endsAt, now);
    return result.changes ? this.getById(Number(result.lastInsertRowid)) : undefined;
  }

  complete(id: number, now: number): boolean {
    const result = this.database.prepare(`
      UPDATE focus_sessions SET status = 'COMPLETED', completed_at = ends_at
      WHERE id = ? AND status = 'ACTIVE' AND ends_at <= ?
    `).run(id, now);
    return result.changes === 1;
  }

  stop(id: number, now: number): boolean {
    const result = this.database.prepare(`
      UPDATE focus_sessions SET status = 'STOPPED', stopped_at = ?
      WHERE id = ? AND status = 'ACTIVE' AND ends_at > ?
    `).run(now, id, now);
    return result.changes === 1;
  }

  completedStats(identity: FocusIdentity): { sessions: number; minutes: number; completedAt: number[] } {
    const totals = this.database.prepare(`
      SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_minutes), 0) AS minutes
      FROM focus_sessions WHERE guild_id = ? AND user_id = ? AND status = 'COMPLETED'
    `).get(identity.guildId, identity.userId) as { sessions: number; minutes: number };
    const rows = this.database.prepare(`
      SELECT completed_at FROM focus_sessions
      WHERE guild_id = ? AND user_id = ? AND status = 'COMPLETED'
      ORDER BY completed_at DESC
    `).all(identity.guildId, identity.userId) as Array<{ completed_at: number }>;
    return { ...totals, completedAt: rows.map((row) => row.completed_at) };
  }
}
