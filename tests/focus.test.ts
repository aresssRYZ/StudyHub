import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Env } from '../src/config/env.js';
import { migrate } from '../src/database/migrate.js';
import { FocusRepository } from '../src/focus/repository.js';
import { FocusService } from '../src/focus/service.js';
import { calculateStreak } from '../src/focus/streak.js';

const env = {
  DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: '123456789012345678', DISCORD_GUILD_ID: '234567890123456789',
  STUDY_CHANNEL_ID: '345678901234567890', GROQ_API_KEY: 'test', GROQ_MODEL: 'test',
  GEMINI_API_KEY: 'test', GEMINI_MODEL: 'test', DATABASE_PATH: ':memory:',
  NODE_ENV: 'test', AI_SESSION_TIMEOUT_MINUTES: 20, AI_MAX_CONTEXT_MESSAGES: 20,
  FOCUS_MIN_DURATION_MINUTES: 5, FOCUS_MAX_DURATION_MINUTES: 180, APP_TIMEZONE: 'Asia/Jakarta',
  SONATA_HOST: '127.0.0.1', SONATA_PORT: 2333, SONATA_PASSWORD: 'test', SONATA_SECURE: false,
  MUSIC_DEFAULT_VOLUME: 50, MUSIC_IDLE_TIMEOUT_SECONDS: 180, PLAYLIST_MAX_PER_USER: 50, PLAYLIST_MAX_TRACKS: 200,
  VOICE_STT_MODEL: 'whisper-large-v3-turbo', VOICE_STT_LANGUAGE: 'id', VOICE_END_SILENCE_MS: 1000,
  VOICE_MAX_UTTERANCE_SECONDS: 30, VOICE_MAX_CONTEXT_MESSAGES: 12, VOICE_SESSION_IDLE_MINUTES: 10, VOICE_TTS_VOICE: 'id-ID-GadisNeural'
} satisfies Env;

function setup(nowValue = Date.now()) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  migrate(database);
  const repository = new FocusRepository(database);
  let now = nowValue;
  const notifications: number[] = [];
  const makeService = () => new FocusService(repository, env, async (session) => { notifications.push(session.id); }, () => now);
  return { database, repository, makeService, notifications, advance: (milliseconds: number) => { now += milliseconds; } };
}

const userA = { guildId: 'guild-1', userId: 'user-a' };
const userB = { guildId: 'guild-1', userId: 'user-b' };

test('focus start validates duration, blocks duplicates, isolates users, and stop excludes stats', () => {
  const { database, repository, makeService } = setup();
  const service = makeService();
  try {
    for (const duration of [0, -10, 9999, 5.5]) assert.equal(service.start(userA, 'channel', duration).kind, 'invalid_duration');
    const first = service.start(userA, 'channel', 25);
    assert.equal(first.kind, 'started');
    assert.equal(service.start(userA, 'channel', 30).kind, 'already_active');
    assert.equal(service.start(userB, 'channel', 50).kind, 'started');
    assert.equal(service.status(userA)?.durationMinutes, 25);
    assert.equal(service.status(userB)?.durationMinutes, 50);
    assert.equal(repository.listActive().length, 2);
    assert.equal(service.stop(userA)?.status, 'ACTIVE');
    assert.equal(service.stop(userA), undefined);
    assert.equal(service.status(userA), undefined);
    assert.equal(service.status(userB)?.durationMinutes, 50);
    assert.deepEqual(service.stats(userA), { sessions: 0, minutes: 0, currentStreak: 0, bestStreak: 0 });
    assert.equal(service.start(userA, 'channel', 30).kind, 'started');
  } finally { service.dispose(); database.close(); }
});

test('restart restores remaining time and completes sessions that expired offline', async () => {
  const { database, repository, makeService, notifications, advance } = setup(Date.parse('2026-09-25T10:00:00Z'));
  const first = makeService();
  try {
    const started = first.start(userA, 'channel', 25);
    assert.equal(started.kind, 'started');
    const originalEnd = started.kind === 'started' ? started.session.endsAt : 0;
    first.dispose();
    advance(10 * 60_000);
    const restored = makeService();
    await restored.recover();
    assert.equal(restored.status(userA)?.endsAt, originalEnd);
    assert.equal(repository.listActive().length, 1);
    restored.dispose();
    advance(16 * 60_000);
    const afterDowntime = makeService();
    await afterDowntime.recover();
    assert.equal(afterDowntime.status(userA), undefined);
    assert.equal(repository.getById(started.kind === 'started' ? started.session.id : 0)?.status, 'COMPLETED');
    assert.equal(afterDowntime.stats(userA).minutes, 25);
    assert.equal(notifications.length, 1);
    await afterDowntime.recover();
    assert.equal(notifications.length, 1);
    afterDowntime.dispose();
    migrate(database);
    assert.equal((database.prepare('SELECT COUNT(*) n FROM schema_migrations').get() as { n: number }).n, 5);
  } finally { first.dispose(); database.close(); }
});

test('focus session survives closing and reopening the SQLite file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studyhub-focus-'));
  const file = join(directory, 'focus.db');
  let database: Database.Database | undefined;
  let service: FocusService | undefined;
  try {
    database = new Database(file);
    database.pragma('foreign_keys = ON');
    migrate(database);
    service = new FocusService(new FocusRepository(database), env, async () => undefined);
    const result = service.start(userA, 'channel', 25);
    assert.equal(result.kind, 'started');
    const endsAt = result.kind === 'started' ? result.session.endsAt : 0;
    service.dispose();
    database.close();

    database = new Database(file);
    database.pragma('foreign_keys = ON');
    migrate(database);
    service = new FocusService(new FocusRepository(database), env, async () => undefined);
    await service.recover();
    assert.equal(service.status(userA)?.endsAt, endsAt);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    service?.dispose();
    if (database?.open) database.close();
    unlinkSync(file);
    rmdirSync(directory);
  }
});

test('timer naturally completes and notifies once; failed notification does not undo completion', async () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  migrate(database);
  const repository = new FocusRepository(database);
  let notifications = 0;
  const service = new FocusService(repository, env, async () => { notifications++; throw new Error('channel gone'); });
  try {
    const session = repository.start(userA, 'channel', 5, Date.now() - 5 * 60_000 + 30);
    assert.ok(session);
    await service.recover();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(repository.getById(session.id)?.status, 'COMPLETED');
    assert.equal(notifications, 1);
    assert.equal(service.stats(userA).minutes, 5);
  } finally { service.dispose(); database.close(); }
});

test('streak counts one day once, respects Asia/Jakarta midnight, resets, and preserves best', () => {
  const day1 = Date.parse('2026-09-25T16:30:00Z'); // 23:30 Jakarta
  const day2 = Date.parse('2026-09-25T17:30:00Z'); // 00:30 next day Jakarta
  const day2Again = Date.parse('2026-09-26T04:00:00Z');
  const day4 = Date.parse('2026-09-28T04:00:00Z');
  assert.deepEqual(calculateStreak([day1, day2, day2Again], day2Again, 'Asia/Jakarta'), { current: 2, best: 2 });
  assert.deepEqual(calculateStreak([day1, day2, day2Again], day4, 'Asia/Jakarta'), { current: 0, best: 2 });
  assert.deepEqual(calculateStreak([day1, day2, day2Again, day4], day4, 'Asia/Jakarta'), { current: 1, best: 2 });
});
