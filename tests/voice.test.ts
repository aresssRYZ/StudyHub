import assert from 'node:assert/strict';
import test from 'node:test';
import { AiService } from '../src/ai/ai-service.js';
import type { AiRequest } from '../src/ai/types.js';
import { VoiceConversationService, voicePrompts } from '../src/voice/conversation.js';
import { pcmDurationMs, wavFromDiscordPcm } from '../src/voice/audio.js';
import { GroqWhisperProvider } from '../src/voice/stt.js';
import { MusicService } from '../src/music/service.js';
import type { MusicProvider } from '../src/music/types.js';
import OpusScript from 'opusscript';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { VoiceReceiver } from '@discordjs/voice';
import { VoiceInputService } from '../src/voice/input.js';
import { executeAi } from '../src/commands/ai/voice.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { VoiceService } from '../src/voice/service.js';

test('voice conversation keeps only recent pairs and separates mode prompts', async () => {
  const requests: AiRequest[] = [];
  const ai = new AiService({ name: 'groq', generate: async (request) => {
    requests.push(request);
    return `jawab ${requests.length}`;
  } }, { name: 'gemini', generate: async () => 'fallback' });
  const voice = new VoiceConversationService(ai, 4);
  await voice.respond('pertama', 'assistant');
  await voice.respond('kedua', 'casual');
  await voice.respond('ketiga', 'curhat');
  assert.equal(requests[1]?.history[0]?.content, 'pertama');
  assert.equal(requests[2]?.history.length, 4);
  assert.ok(requests[2]?.systemPrompt.includes('tanpa menghakimi'));
  assert.ok(voicePrompts.assistant.includes('belajar'));
  assert.ok(voicePrompts.casual.includes('teman'));
  voice.clear();
  await voice.respond('baru', 'assistant');
  assert.deepEqual(requests[3]?.history, []);
});

test('Discord PCM is converted into mono 16 kHz WAV in memory', () => {
  const pcm = Buffer.alloc(192000);
  pcm.writeInt16LE(1000, 0);
  pcm.writeInt16LE(-1000, 2);
  const wav = wavFromDiscordPcm([pcm]);
  assert.equal(pcmDurationMs([pcm]), 1000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.length, 32044);
  assert.equal(wav.readInt16LE(44), 0);
});

test('Opus speech frame decodes into PCM before WAV conversion', () => {
  const codec = new OpusScript(48000, 2);
  try {
    const pcm = Buffer.alloc(3840);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(1000 * Math.sin(i / 24)), i);
    const decoded = codec.decode(codec.encode(pcm, 960));
    assert.equal(decoded.length, pcm.length);
    assert.equal(wavFromDiscordPcm([decoded]).readUInt32LE(24), 16000);
  } finally { codec.delete(); }
});

test('voice receiver subscribes only to owner and ignores speech while processing', async () => {
  const speaking = new EventEmitter();
  const streams: PassThrough[] = [];
  const subscribed: string[] = [];
  const receiver = {
    speaking,
    subscribe: (id: string) => {
      subscribed.push(id);
      const stream = new PassThrough();
      streams.push(stream);
      return stream;
    }
  } as unknown as VoiceReceiver;
  const codec = new OpusScript(48000, 2);
  let listening = true;
  const utterances: Buffer[] = [];
  const input = new VoiceInputService(receiver, 'owner', 1000, 30, () => listening,
    (wav) => { utterances.push(wav); listening = false; });
  try {
    speaking.emit('start', 'other');
    assert.deepEqual(subscribed, []);
    speaking.emit('start', 'owner');
    assert.deepEqual(subscribed, ['owner']);
    const packet = codec.encode(Buffer.alloc(3840), 960);
    for (let i = 0; i < 25; i++) streams[0]?.write(packet);
    streams[0]?.end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(utterances.length, 1);
    assert.equal(utterances[0]?.readUInt32LE(24), 16000);
    speaking.emit('start', 'owner');
    assert.deepEqual(subscribed, ['owner']);
    listening = true;
    speaking.emit('start', 'owner');
    assert.deepEqual(subscribed, ['owner', 'owner']);
    for (let i = 0; i < 5; i++) streams[1]?.write(packet);
    streams[1]?.end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(utterances.length, 1);
  } finally { input.dispose(); codec.delete(); }
});

test('Groq STT sends transient WAV and language hint', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const form = options?.body as FormData;
      assert.equal(form.get('model'), 'whisper-large-v3-turbo');
      assert.equal(form.get('language'), 'id');
      assert.ok(form.get('file') instanceof File);
      return new Response(JSON.stringify({ text: '  halo StudyHub  ' }), { status: 200 });
    };
    const result = await new GroqWhisperProvider('test', 'whisper-large-v3-turbo', 'id')
      .transcribe(Buffer.from('wav'), AbortSignal.timeout(1000));
    assert.equal(result, 'halo StudyHub');
  } finally { globalThis.fetch = original; }
});

test('Groq STT rejects HTTP failure without exposing response content', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('sensitive provider body', { status: 503 });
    await assert.rejects(new GroqWhisperProvider('test', 'model', '')
      .transcribe(Buffer.from('wav'), AbortSignal.timeout(1000)), /HTTP 503/);
  } finally { globalThis.fetch = original; }
});

test('music rejects play while Voice AI is active and works after leave', async () => {
  let joined = 0;
  const provider: MusicProvider = {
    available: () => true,
    resolve: async (query, requesterId) => ({ encoded: query, title: query, uri: '', durationMs: 1000, requesterId, source: 'youtube' }),
    join: async () => { joined++; }, play: async () => undefined, pause: async () => undefined,
    stopTrack: async () => undefined, volume: async () => undefined, leave: async () => undefined
  };
  const music = new MusicService(provider, 50, 10, async () => undefined);
  let active = true;
  music.setVoiceAiActiveChecker(() => active);
  await assert.rejects(music.play('g', 'v', 't', 'song', 'u'), /Voice AI lagi aktif/);
  await assert.rejects(music.enqueueResolved('g', 'v', 't', [{ encoded: 'song', title: 'song', uri: '', durationMs: 1000, requesterId: 'u', source: 'youtube' }]), /Voice AI lagi aktif/);
  assert.equal(joined, 0);
  active = false;
  await music.play('g', 'v', 't', 'song', 'u');
  assert.equal(joined, 1);
  assert.equal(music.occupied('g'), true);
  await music.dispose();
  assert.equal(music.occupied('g'), false);
});

test('/ai join without voice gives a friendly answer', async () => {
  let answer = '';
  const interaction = {
    guild: { id: 'g', members: { fetch: async () => ({ voice: { channel: null } }) } },
    user: { id: 'u' }, member: null,
    options: { getSubcommand: () => 'join' },
    deferReply: async () => undefined,
    editReply: async (content: string) => { answer = content; }
  } as unknown as ChatInputCommandInteraction;
  await executeAi(interaction, {} as VoiceService);
  assert.match(answer, /masuk voice dulu/);
});
