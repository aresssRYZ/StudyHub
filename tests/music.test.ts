import assert from 'node:assert/strict';
import test from 'node:test';
import { MusicService } from '../src/music/service.js';
import type { MusicProvider, MusicTrack } from '../src/music/types.js';
import { executeMusic } from '../src/commands/music/music.js';
import type { ChatInputCommandInteraction } from 'discord.js';

class FakeProvider implements MusicProvider {
  online = true;
  joined: string[] = [];
  played: string[] = [];
  left: string[] = [];
  paused: boolean[] = [];
  levels: number[] = [];
  failOnPlay = new Set<string>();
  onEnd?: MusicProvider['onEnd'];
  onFailure?: MusicProvider['onFailure'];
  onOffline?: MusicProvider['onOffline'];
  available(): boolean { return this.online; }
  async resolve(query: string, requesterId: string): Promise<MusicTrack | null> {
    await new Promise((resolve) => setTimeout(resolve, query === 'first' ? 5 : 0));
    return query === 'missing' ? null : { encoded: query, title: query, uri: `https://youtube.com/watch?v=${query}`, durationMs: 60000, requesterId, source: 'youtube' };
  }
  async join(guildId: string): Promise<void> { this.joined.push(guildId); }
  async play(_guildId: string, track: MusicTrack): Promise<void> {
    this.played.push(track.encoded);
    if (this.failOnPlay.has(track.encoded)) throw new Error('simulated playback failure');
  }
  async pause(_guildId: string, paused: boolean): Promise<void> { this.paused.push(paused); }
  async stopTrack(): Promise<void> { /* Shoukaku emits 'stopped' later. */ }
  async volume(_guildId: string, level: number): Promise<void> { this.levels.push(level); }
  async leave(guildId: string): Promise<void> { this.left.push(guildId); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('serializes concurrent play, auto-next, and isolates guild queues', async () => {
  const provider = new FakeProvider();
  const music = new MusicService(provider, 50, 10, async () => undefined);
  const [first, second] = await Promise.all([
    music.play('a', 'voice-a', 'text-a', 'first', 'u1'),
    music.play('a', 'voice-a', 'text-a', 'second', 'u2')
  ]);
  await music.play('b', 'voice-b', 'text-b', 'other', 'u3');
  assert.equal(first.kind, 'playing');
  assert.equal(second.kind, 'queued');
  assert.deepEqual(provider.played, ['first', 'other']);
  assert.equal(music.snapshot('a')?.queue[0]?.title, 'second');
  provider.onEnd?.('a', 'first', 'finished');
  await tick();
  assert.equal(music.snapshot('a')?.current?.title, 'second');
  assert.equal(music.snapshot('b')?.current?.title, 'other');
  await music.dispose();
});

test('skip advances once and ignores stopped/replaced end events', async () => {
  const provider = new FakeProvider();
  const music = new MusicService(provider, 50, 10, async () => undefined);
  await music.play('a', 'v', 't', 'one', 'u');
  await music.play('a', 'v', 't', 'two', 'u');
  await music.play('a', 'v', 't', 'three', 'u');
  const next = await music.skip('a');
  provider.onEnd?.('a', 'one', 'stopped');
  provider.onEnd?.('a', 'one', 'replaced');
  await tick();
  assert.equal(next?.title, 'two');
  assert.equal(music.snapshot('a')?.current?.title, 'two');
  assert.deepEqual(music.snapshot('a')?.queue.map((x) => x.title), ['three']);
  await music.pause('a', true);
  await music.pause('a', false);
  await music.volume('a', 70);
  assert.deepEqual(provider.paused, [true, false]);
  assert.deepEqual(provider.levels, [70]);
  await music.stop('a');
  assert.equal(music.snapshot('a'), null);
  assert.deepEqual(provider.left, ['a']);
});

test('missing track and offline node do not create a player', async () => {
  const provider = new FakeProvider();
  const music = new MusicService(provider, 50, 10, async () => undefined);
  await assert.rejects(music.play('a', 'v', 't', 'missing', 'u'), /tidak ditemukan/);
  provider.online = false;
  await assert.rejects(music.play('a', 'v', 't', 'first', 'u'), /offline/);
  assert.deepEqual(provider.joined, []);
});

test('rejects another voice channel and advances after track failure', async () => {
  const provider = new FakeProvider();
  const notices: string[] = [];
  const music = new MusicService(provider, 50, 10, async (_channel, message) => { notices.push(message); });
  await music.play('a', 'voice-a', 'text-a', 'one', 'u');
  await music.play('a', 'voice-a', 'text-a', 'two', 'u');
  await assert.rejects(music.play('a', 'voice-b', 'text-a', 'three', 'u'), /voice channel/);
  provider.onFailure?.('a', 'one');
  await tick();
  assert.equal(music.snapshot('a')?.current?.title, 'two');
  assert.ok(notices.some((message) => message.includes('gagal diputar')));
  provider.online = false;
  provider.onOffline?.();
  await tick();
  assert.equal(music.snapshot('a'), null);
});

test('new song cancels idle disconnect, and stop clears the timer', async () => {
  const provider = new FakeProvider();
  const music = new MusicService(provider, 50, 0.03, async () => undefined);
  await music.play('a', 'v', 't', 'one', 'u');
  provider.onEnd?.('a', 'one', 'finished');
  await tick();
  await music.play('a', 'v', 't', 'two', 'u');
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(music.snapshot('a')?.current?.title, 'two');
  provider.onEnd?.('a', 'two', 'finished');
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(music.snapshot('a'), null);
  assert.deepEqual(provider.left, ['a']);
});

test('skip passes over an unplayable queued track without stranding the queue', async () => {
  const provider = new FakeProvider();
  provider.failOnPlay.add('broken');
  const music = new MusicService(provider, 50, 10, async () => undefined);
  await music.play('a', 'v', 't', 'one', 'u');
  await music.play('a', 'v', 't', 'broken', 'u');
  await music.play('a', 'v', 't', 'three', 'u');
  const next = await music.skip('a');
  assert.equal(next?.title, 'three');
  assert.equal(music.snapshot('a')?.queue.length, 0);
  await music.dispose();
});

test('play requires voice and controls reject another voice channel', async () => {
  const provider = new FakeProvider();
  const music = new MusicService(provider, 50, 10, async () => undefined);
  const replies: string[] = [];
  const events: string[] = [];
  let voice: { id: string } | null = null;
  const interaction = {
    guild: { id: 'a', members: { fetch: async () => { events.push('fetch'); return { voice: { channel: voice } }; } } },
    member: null, user: { id: 'u' }, commandName: 'play',
    deferReply: async () => { events.push('defer'); },
    editReply: async (value: { content: string }) => { replies.push(value.content); }
  } as unknown as ChatInputCommandInteraction;
  await executeMusic(interaction, music);
  assert.deepEqual(events.slice(0, 2), ['defer', 'fetch']);
  assert.match(replies[0] ?? '', /voice channel dulu/);
  await music.play('a', 'voice-a', 'text-a', 'one', 'u');
  voice = { id: 'voice-b' };
  Object.assign(interaction, { commandName: 'pause' });
  await executeMusic(interaction, music);
  assert.match(replies[1] ?? '', /voice channel tempat bot/);
  assert.deepEqual(provider.paused, []);
  await music.dispose();
});
