import type { StudyHubDatabase } from './database.js';
import { initialMigration } from './migrations/001_initial.js';
import { conversationsMigration } from './migrations/002_conversations.js';
import { replyLinksMigration } from './migrations/003_reply_links.js';
import { DatabaseError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

const migrations = [initialMigration, conversationsMigration, replyLinksMigration];

export function migrate(database: StudyHubDatabase): void {
  try {
    const hasLedger = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get() !== undefined;

    if (!hasLedger) {
      database.transaction(() => {
        initialMigration.up(database);
        database.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(initialMigration.id);
      })();
      logger.info({ migration: initialMigration.id }, 'Migration executed');
    }

    const applied = new Set(
      (database.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((row) => row.id)
    );

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      database.transaction(() => {
        migration.up(database);
        database.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
      })();
      logger.info({ migration: migration.id }, 'Migration executed');
    }
  } catch (error) {
    throw new DatabaseError(`Database migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
