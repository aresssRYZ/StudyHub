import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseError } from '../shared/errors.js';

export type StudyHubDatabase = Database.Database;

export function openDatabase(databasePath: string): StudyHubDatabase {
  let database: StudyHubDatabase | undefined;
  try {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    database = new Database(absolutePath);
    database.pragma('foreign_keys = ON');
    return database;
  } catch (error) {
    database?.close();
    throw new DatabaseError(`Could not open SQLite database: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
