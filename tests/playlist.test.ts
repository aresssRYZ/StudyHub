import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../src/database/migrate.js';
import { PlaylistRepository } from '../src/playlist/repository.js';
import { PlaylistService } from '../src/playlist/service.js';
import { MusicService } from '../src/music/service.js';
import { normalizePlaylist } from '../src/music/sonata-provider.js';
import { readYoutubePlaylistPage } from '../src/music/youtube-playlist.js';
import type { MusicProvider, MusicTrack } from '../src/music/types.js';
import { FocusRepository } from '../src/focus/repository.js';
import { FocusService } from '../src/focus/service.js';
import type { Env } from '../src/config/env.js';
import { executeFocus } from '../src/commands/focus/focus.js';
import type { ChatInputCommandInteraction } from 'discord.js';

class Provider implements MusicProvider {
  online = true;
  joined = 0;
  left = 0;
  played: string[] = [];
  unavailable = new Set<string>();
  playlistTracks: MusicTrack[] = [];
  playlistUrl = '';
  onEnd?: MusicProvider['onEnd'];
  onFailure?: MusicProvider['onFailure'];
  onOffline?: MusicProvider['onOffline'];
  available(): boolean { return this.online; }
  async resolve(query: string, requesterId: string): Promise<MusicTrack | null> {
    const id = new URL(query).searchParams.get('v') ?? '';
    if (this.unavailable.has(id)) return null;
    return { encoded: id, title: `Track ${id}`, uri: query, durationMs: 90000,
      requesterId, source: 'youtube', author: 'Artist' };
  }
  async resolvePlaylist(url: string): Promise<MusicTrack[]> { this.playlistUrl = url; return this.playlistTracks; }
  async join(): Promise<void> { this.joined++; }
  async play(_guildId: string, track: MusicTrack): Promise<void> { this.played.push(track.encoded); }
  async pause(): Promise<void> {}
  async stopTrack(): Promise<void> {}
  async volume(): Promise<void> {}
  async leave(): Promise<void> { this.left++; }
}

const owner = { guildId: 'guild', userId: 'a' };
const other = { guildId: 'guild', userId: 'b' };
const video = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function setup(maxPlaylists = 50, maxTracks = 200) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const provider = new Provider();
  const music = new MusicService(provider, 50, 180, async () => undefined);
  const playlists = new PlaylistService(new PlaylistRepository(db), music, maxPlaylists, maxTracks);
  return { db, provider, music, playlists };
}

test('playlist persistence, owner isolation, duplicate names, order and cascade delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studyhub-playlist-'));
  const path = join(dir, 'test.db');
  let db = new Database(path);
  db.pragma('foreign_keys = ON');
  migrate(db);
  const provider = new Provider();
  const music = new MusicService(provider, 50, 180, async () => undefined);
  let playlists = new PlaylistService(new PlaylistRepository(db), music, 50, 200);
  try {
    playlists.create(owner, ' Belajar ');
    await assert.rejects(async () => playlists.create(owner, 'belajar'), /sudah punya/);
    assert.equal(playlists.list(other).length, 0);
    await music.play(owner.guildId, 'voice', 'text', video('aaaaaaaaaaa'), owner.userId);
    await playlists.add(owner, 'belajar', owner.userId);
    await playlists.add(owner, 'Belajar', owner.userId, video('bbbbbbbbbbb'));
    await playlists.add(owner, 'Belajar', owner.userId, video('aaaaaaaaaaa'));
    assert.deepEqual(playlists.show(owner, 'BELAJAR').tracks.map((t) => t.identifier), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'aaaaaaaaaaa']);
    assert.equal(playlists.remove(owner, 'belajar', 2).identifier, 'bbbbbbbbbbb');
    assert.deepEqual(playlists.show(owner, 'belajar').tracks.map((t) => t.identifier), ['aaaaaaaaaaa', 'aaaaaaaaaaa']);
    playlists.setFocus(owner, 'Belajar');
    playlists.create(owner, 'Santai');
    playlists.setFocus(owner, 'Santai');
    assert.equal(playlists.focus(owner)?.name, 'Santai');
    playlists.setFocus(owner, 'Belajar');
    assert.equal(playlists.list(owner).filter((item) => item.isFocus).length, 1);
    db.close();
    db = new Database(path);
    db.pragma('foreign_keys = ON');
    migrate(db);
    playlists = new PlaylistService(new PlaylistRepository(db), music, 50, 200);
    assert.equal(playlists.focus(owner)?.name, 'Belajar');
    assert.equal(playlists.show(owner, 'belajar').tracks.length, 2);
    assert.throws(() => playlists.get(other, 'belajar'), /nggak ditemukan/);
    playlists.delete(owner, 'belajar');
    assert.equal(playlists.focus(owner), undefined);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM playlist_tracks').get() as { count: number }).count, 0);
  } finally { await music.dispose(); if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('limits, empty load, partial availability and same-voice rules', async () => {
  const { db, provider, music, playlists } = setup(1, 2);
  try {
    const item = playlists.create(owner, 'Study');
    assert.throws(() => playlists.create(owner, 'Another'), /Batas/);
    assert.deepEqual(await playlists.load(owner, item, 'voice', 'text'), { kind: 'empty', loaded: 0, unavailable: 0 });
    assert.equal(provider.joined, 0);
    await playlists.add(owner, 'Study', owner.userId, video('aaaaaaaaaaa'));
    await playlists.add(owner, 'Study', owner.userId, video('bbbbbbbbbbb'));
    await assert.rejects(playlists.add(owner, 'Study', owner.userId, video('ccccccccccc')), /batas lagu/);
    provider.unavailable.add('bbbbbbbbbbb');
    const result = await playlists.load(owner, item, 'voice', 'text');
    assert.deepEqual(result, { kind: 'loaded', loaded: 1, unavailable: 1 });
    assert.equal(music.snapshot(owner.guildId)?.current?.encoded, 'aaaaaaaaaaa');
    assert.equal(playlists.show(owner, 'Study').tracks.length, 2);
    await assert.rejects(playlists.load(owner, item, 'other-voice', 'text'), /voice channel/);
  } finally { await music.dispose(); db.close(); }
});

test('YouTube playlist import preserves order, duplicates, limit, and canonical URL', async () => {
  const { db, provider, music, playlists } = setup(50, 3);
  try {
    const item = playlists.create(owner, 'Belajar');
    provider.playlistTracks = [
      { encoded: 'a', title: 'A', uri: video('aaaaaaaaaaa'), durationMs: 1, requesterId: owner.userId, source: 'youtube' },
      { encoded: 'b', title: 'B', uri: video('bbbbbbbbbbb'), durationMs: 2, requesterId: owner.userId, source: 'youtube' },
      { encoded: 'a', title: 'A', uri: video('aaaaaaaaaaa'), durationMs: 1, requesterId: owner.userId, source: 'youtube' },
      { encoded: 'c', title: 'C', uri: video('ccccccccccc'), durationMs: 3, requesterId: owner.userId, source: 'youtube' }
    ];
    const result = await playlists.importYoutube(owner, item.name, 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL_1234567890');
    assert.deepEqual(result, { added: 3, skipped: 0, full: true });
    assert.equal(provider.playlistUrl, 'https://www.youtube.com/playlist?list=PL_1234567890');
    assert.deepEqual(playlists.show(owner, item.name).tracks.map((t) => t.identifier), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'aaaaaaaaaaa']);
    await assert.rejects(playlists.importYoutube(owner, item.name, 'https://www.youtube.com/playlist?list=PL_1234567890'), /batas lagu/);
    assert.throws(() => playlists.get(other, item.name), /nggak ditemukan/);
  } finally { await music.dispose(); db.close(); }
});

test('YouTube playlist import rejects unsafe URLs and skips tracks with bad identifiers', async () => {
  const { db, provider, music, playlists } = setup();
  try {
    const item = playlists.create(owner, 'Study');
    await assert.rejects(playlists.importYoutube(owner, item.name, 'https://evil.example/playlist?list=PL_1234567890'), /YouTube HTTPS/);
    await assert.rejects(playlists.importYoutube(owner, item.name, 'https://www.youtube.com/watch?v=aaaaaaaaaaa'), /ID playlist/);
    assert.equal(provider.playlistUrl, '');
    provider.playlistTracks = [
      { encoded: 'bad', title: 'Bad', uri: 'https://temporary.example/audio', durationMs: 1, requesterId: owner.userId, source: 'youtube' },
      { encoded: 'good', title: 'Good', uri: video('aaaaaaaaaaa'), durationMs: 1, requesterId: owner.userId, source: 'youtube' }
    ];
    provider.online = false;
    assert.deepEqual(await playlists.importYoutube(owner, item.name, 'https://www.youtube.com/playlist?list=PL_1234567890'),
      { added: 1, skipped: 1, full: false });
    assert.equal(playlists.show(owner, item.name).tracks[0]?.identifier, 'aaaaaaaaaaa');
  } finally { await music.dispose(); db.close(); }
});

test('Sonata playlist response uses video IDs and discards temporary stream URLs', () => {
  const tracks = normalizePlaylist({ loadType: 'PLAYLIST_LOADED', tracks: [
    { encoded: 'encoded1', info: { identifier: 'aaaaaaaaaaa', title: 'A', author: 'Singer', length: 1000, sourceName: 'youtube', uri: 'https://temporary.example/stream' } },
    { encoded: 'encoded2', info: { identifier: 'bad', title: 'Unavailable', uri: 'https://temporary.example/stream' } },
    { encoded: 'encoded3', info: { identifier: 'bbbbbbbbbbb', title: 'B', length: 2000, uri: 'https://temporary.example/stream' } }
  ] }, 'user');
  assert.deepEqual(tracks.map((track) => track.uri), [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')]);
  assert.deepEqual(normalizePlaylist({ loadType: 'LOAD_FAILED', tracks: [] }, 'user'), []);
});

test('YouTube page parser preserves order and reads continuation token', () => {
  const item = (id: string, title: string) => ({ lockupViewModel: { contentId: id, metadata: { lockupMetadataViewModel: {
    title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [
      { metadataParts: [{ text: { content: 'Artist' } }] },
      { metadataParts: [{ text: { content: '3:21' } }] }
    ] } }
  } } } });
  const page = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: {
    sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
      item('aaaaaaaaaaa', 'One'), item('bbbbbbbbbbb', 'Two'),
      { continuationItemViewModel: { continuationCommand: { innertubeCommand: {
        continuationCommand: { token: 'next-page' }
      } } } }
    ] } }] }
  } } }] } } };
  const parsed = readYoutubePlaylistPage(page, 'user');
  assert.deepEqual(parsed.tracks.map((track) => track.title), ['One', 'Two']);
  assert.deepEqual(parsed.tracks.map((track) => track.uri), [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')]);
  assert.equal(parsed.tracks[0]?.author, 'Artist');
  assert.equal(parsed.tracks[0]?.durationMs, 201000);
  assert.equal(parsed.continuation, 'next-page');
});

test('focus ownership never replaces busy music and manual changes revoke automatic stop', async () => {
  const { db, music, playlists } = setup();
  try {
    const item = playlists.create(owner, 'Focus');
    await playlists.add(owner, 'Focus', owner.userId, video('aaaaaaaaaaa'));
    playlists.setFocus(owner, item.name);
    await music.play(owner.guildId, 'voice', 'text', video('bbbbbbbbbbb'), other.userId);
    assert.equal((await playlists.load(owner, item, 'voice', 'text', 1)).kind, 'busy');
    assert.equal(music.snapshot(owner.guildId)?.current?.encoded, 'bbbbbbbbbbb');
    await music.stop(owner.guildId);
    assert.equal((await playlists.load(owner, item, 'voice', 'text', 1)).loaded, 1);
    await music.volume(owner.guildId, 60);
    assert.equal(await music.stopFocusOwned(owner.guildId, 1), false);
    assert.ok(music.snapshot(owner.guildId));
    await music.stop(owner.guildId);
    assert.equal((await playlists.load(owner, item, 'voice', 'text', 2)).loaded, 1);
    assert.equal(await music.stopFocusOwned(owner.guildId, 2), true);
    assert.equal(music.snapshot(owner.guildId), null);
  } finally { await music.dispose(); db.close(); }
});

test('focus timer persists independently from Sonata and completion cleans only owned music', async () => {
  const { db, provider, music, playlists } = setup();
  const env = { FOCUS_MIN_DURATION_MINUTES: 1, FOCUS_MAX_DURATION_MINUTES: 180, APP_TIMEZONE: 'Asia/Jakarta' } as Env;
  const repo = new FocusRepository(db);
  let now = Date.now();
  const focus = new FocusService(repo, env, async () => undefined, () => now,
    async (session) => { await music.stopFocusOwned(session.guildId, session.id); });
  try {
    const item = playlists.create(owner, 'Focus');
    await playlists.add(owner, item.name, owner.userId, video('aaaaaaaaaaa'));
    provider.online = false;
    const started = focus.start(owner, 'text', 1);
    assert.equal(started.kind, 'started');
    assert.equal(focus.status(owner)?.status, 'ACTIVE');
    provider.online = true;
    if (started.kind === 'started') await playlists.load(owner, item, 'voice', 'text', started.session.id);
    now += 61_000;
    await focus.recover();
    assert.equal(focus.status(owner), undefined);
    assert.equal(music.snapshot(owner.guildId), null);
  } finally { focus.dispose(); await music.dispose(); db.close(); }
});

test('focus start command keeps timer active without voice or Sonata and avoids busy player', async () => {
  const { db, provider, music, playlists } = setup();
  const env = { FOCUS_MIN_DURATION_MINUTES: 1, FOCUS_MAX_DURATION_MINUTES: 180, APP_TIMEZONE: 'Asia/Jakarta' } as Env;
  const focus = new FocusService(new FocusRepository(db), env, async () => undefined);
  let voiceId: string | null = null;
  const descriptions: string[] = [];
  const interaction = {
    guildId: owner.guildId, channelId: 'text', user: { id: owner.userId }, member: null,
    guild: { members: { me: { id: 'bot' }, fetch: async () => ({ voice: { channel: voiceId ? {
      id: voiceId, permissionsFor: () => ({ has: () => true })
    } : null } }) } },
    options: { getSubcommand: () => 'start', getInteger: () => 1 },
    deferReply: async () => undefined,
    editReply: async (data: { embeds?: Array<{ toJSON(): { description?: string } }> }) => {
      descriptions.push(data.embeds?.[0]?.toJSON().description ?? '');
    }
  } as unknown as ChatInputCommandInteraction;
  try {
    const item = playlists.create(owner, 'Focus');
    await playlists.add(owner, item.name, owner.userId, video('aaaaaaaaaaa'));
    playlists.setFocus(owner, item.name);
    await executeFocus(interaction, focus, env, playlists, music);
    assert.ok(focus.status(owner));
    assert.match(descriptions.at(-1) ?? '', /tanpa musik/);
    focus.stop(owner);

    voiceId = 'voice';
    provider.online = false;
    await executeFocus(interaction, focus, env, playlists, music);
    assert.ok(focus.status(owner));
    assert.match(descriptions.at(-1) ?? '', /server musik belum tersedia/);
    focus.stop(owner);

    provider.online = true;
    await music.play(owner.guildId, 'voice', 'text', video('bbbbbbbbbbb'), other.userId);
    await executeFocus(interaction, focus, env, playlists, music);
    assert.ok(focus.status(owner));
    assert.match(descriptions.at(-1) ?? '', /lagi dipakai/);
    assert.equal(music.snapshot(owner.guildId)?.current?.encoded, 'bbbbbbbbbbb');
  } finally { focus.dispose(); await music.dispose(); db.close(); }
});
