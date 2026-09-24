import type { StudyHubDatabase } from '../database.js';

export const initialMigration = {
  id: '001_initial',
  up(database: StudyHubDatabase): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};
