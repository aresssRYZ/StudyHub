import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { Message } from 'discord.js';
import { AiService } from '../src/ai/ai-service.js';
import { ProviderError } from '../src/ai/providers/http.js';
import { GroqProvider } from '../src/ai/providers/groq.js';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import type { AiProvider, AiRequest } from '../src/ai/types.js';
import type { Env } from '../src/config/env.js';
import { ConversationService } from '../src/conversation/conversation-service.js';
import { ConversationRepository } from '../src/conversation/repository.js';
import { isCloseIntent } from '../src/conversation/close-intent.js';
import { migrate } from '../src/database/migrate.js';
import { splitMessage } from '../src/shared/split-message.js';

const botId = '123456789012345678';
const channelId = '234567890123456789';
const guildId = '345678901234567890';

const env = {
  DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: botId, DISCORD_GUILD_ID: guildId,
  STUDY_CHANNEL_ID: channelId, GROQ_API_KEY: 'test', GROQ_MODEL: 'test',
  GEMINI_API_KEY: 'test', GEMINI_MODEL: 'test', DATABASE_PATH: ':memory:',
  NODE_ENV: 'test', AI_SESSION_TIMEOUT_MINUTES: 20, AI_MAX_CONTEXT_MESSAGES: 20,
  FOCUS_MIN_DURATION_MINUTES: 5, FOCUS_MAX_DURATION_MINUTES: 180, APP_TIMEZONE: 'Asia/Jakarta',
  SONATA_HOST: '127.0.0.1', SONATA_PORT: 2333, SONATA_PASSWORD: 'test', SONATA_SECURE: false,
  MUSIC_DEFAULT_VOLUME: 50, MUSIC_IDLE_TIMEOUT_SECONDS: 180, PLAYLIST_MAX_PER_USER: 50, PLAYLIST_MAX_TRACKS: 200,
  VOICE_STT_MODEL: 'whisper-large-v3-turbo', VOICE_STT_LANGUAGE: 'id', VOICE_END_SILENCE_MS: 1000,
  VOICE_MAX_UTTERANCE_SECONDS: 30, VOICE_MAX_CONTEXT_MESSAGES: 12, VOICE_SESSION_IDLE_MINUTES: 10, VOICE_TTS_VOICE: 'id-ID-GadisNeural'
} satisfies Env;

function setup(generate: (request: AiRequest) => Promise<string>) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  migrate(database);
  const primary: AiProvider = { name: 'groq', generate };
  const fallback: AiProvider = { name: 'gemini', generate: async () => 'fallback' };
  const conversations = new ConversationService(new ConversationRepository(database, 20), new AiService(primary, fallback), env);
  const replies: Array<{ id: string; botMessageId: string; content: string }> = [];
  let nextId = 0;
  let nextBotId = 0;

  function message(userId: string, content: string, options: { channel?: string; replyTo?: string; id?: string } = {}): Message {
    const id = options.id ?? String(++nextId);
    return {
      id, guildId, channelId: options.channel ?? channelId, content,
      author: { id: userId, bot: false }, webhookId: null,
      client: { user: { id: botId } },
      reference: options.replyTo ? { messageId: options.replyTo } : null,
      channel: { sendTyping: async () => undefined },
      reply: async (payload: { content: string }) => {
        const botMessageId = `bot-${++nextBotId}`;
        replies.push({ id, botMessageId, content: payload.content });
        return { id: botMessageId };
      }
    } as unknown as Message;
  }

  return { database, conversations, replies, message };
}

test('close intent recognizes natural variants without closing ordinary questions', () => {
  for (const text of ['sudah selesai', 'cukup dulu', 'udahan dulu', 'selesai ya', 'makasih, cukup', 'sampai sini dulu', 'stop dulu']) {
    assert.equal(isCloseIntent(text), true, text);
  }
  assert.equal(isCloseIntent('jelaskan kenapa tugasnya selesai'), false);
  assert.equal(isCloseIntent('makasih'), false);
});

test('fallback is selective', async () => {
  let fallbackCalls = 0;
  const fallback: AiProvider = { name: 'gemini', generate: async () => { fallbackCalls++; return 'Gemini answer'; } };
  const request = { systemPrompt: 'test', history: [], userMessage: 'hi' };
  const limited: AiProvider = { name: 'groq', generate: async () => { throw new ProviderError('groq', 'rate_limit', 429); } };
  assert.equal(await new AiService(limited, fallback).generate(request, 1), 'Gemini answer');
  assert.equal(fallbackCalls, 1);
  const unauthorized: AiProvider = { name: 'groq', generate: async () => { throw new ProviderError('groq', 'auth', 401); } };
  await assert.rejects(new AiService(unauthorized, fallback).generate(request, 1), ProviderError);
  assert.equal(fallbackCalls, 1);
  const brokenFallback: AiProvider = { name: 'gemini', generate: async () => { throw new ProviderError('gemini', 'server', 503); } };
  await assert.rejects(new AiService(limited, brokenFallback).generate(request, 1), ProviderError);
});

test('provider requests preserve conversation roles and parse text responses', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as unknown);
    return new Response(JSON.stringify(bodies.length === 1
      ? { choices: [{ message: { content: 'Groq answer' } }] }
      : { candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] }), { status: 200 });
  };
  try {
    const request: AiRequest = { systemPrompt: 'study', history: [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }], userMessage: 'Q2' };
    assert.equal(await new GroqProvider('safe-test-key', 'test-model').generate(request), 'Groq answer');
    assert.equal(await new GeminiProvider('safe-test-key', 'test-model').generate(request), 'Gemini answer');
    const groq = bodies[0] as { messages: Array<{ role: string; content: string }> };
    const gemini = bodies[1] as { contents: Array<{ role: string; parts: Array<{ text: string }> }> };
    assert.deepEqual(groq.messages.map((item) => item.role), ['system', 'user', 'assistant', 'user']);
    assert.deepEqual(gemini.contents.map((item) => item.role), ['user', 'model', 'user']);
    assert.equal(gemini.contents[2]?.parts[0]?.text, 'Q2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider HTTP failures distinguish rate limits from invalid credentials', async () => {
  const originalFetch = globalThis.fetch;
  const request: AiRequest = { systemPrompt: 'study', history: [], userMessage: 'hello' };
  try {
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    await assert.rejects(new GroqProvider('safe-test-key', 'test-model').generate(request),
      (error: unknown) => error instanceof ProviderError && error.failure === 'rate_limit');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 });
    await assert.rejects(new GeminiProvider('safe-test-key', 'test-model').generate(request),
      (error: unknown) => error instanceof ProviderError && error.failure === 'auth');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only owner replies continue a session; mentions start fresh; timeout resets context', async () => {
  const requests: AiRequest[] = [];
  const { database, conversations, replies, message } = setup(async (request) => { requests.push(request); return `answer ${requests.length}`; });
  try {
    await conversations.handleMessage(message('user-a', `<@${botId}> halo`, { channel: 'other-channel' }));
    await conversations.handleMessage(message('user-a', 'halo'));
    assert.equal(requests.length, 0);

    await conversations.handleMessage(message('user-a', `<@${botId}> siapa Einstein?`));
    const firstAnswer = replies.at(-1)!.botMessageId;
    await conversations.handleMessage(message('user-b', 'dia lahir di mana?'));
    await conversations.handleMessage(message('user-b', 'dia lahir di mana?', { replyTo: firstAnswer }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.userMessage, 'siapa Einstein?');
    await conversations.handleMessage(message('user-a', 'dia lahir di mana?'));
    assert.equal(requests.length, 1);
    await conversations.handleMessage(message('user-a', 'dia lahir di mana?', { replyTo: firstAnswer }));
    assert.deepEqual(requests[1]?.history.map((item) => item.role), ['user', 'assistant']);
    assert.equal(requests[1]?.history[0]?.content, 'siapa Einstein?');

    await conversations.handleMessage(message('user-a', `<@${botId}> makasih, cukup`));
    await conversations.handleMessage(message('user-a', 'lanjut lagi'));
    await conversations.handleMessage(message('user-a', 'lanjut lagi', { replyTo: firstAnswer }));
    assert.equal(requests.length, 2);
    await conversations.handleMessage(message('user-a', `<@${botId}> topik baru`));
    assert.equal(requests[2]?.history.length, 0);
    const newAnswer = replies.at(-1)!.botMessageId;
    await conversations.handleMessage(message('user-a', 'balas topik lama', { replyTo: firstAnswer }));
    assert.equal(requests.length, 3);

    database.prepare("UPDATE conversation_sessions SET last_activity_at = 1 WHERE user_id = 'user-a' AND status = 'ACTIVE'").run();
    await conversations.handleMessage(message('user-a', 'tanpa mention setelah timeout'));
    assert.equal(requests.length, 3);
    await conversations.handleMessage(message('user-a', 'mulai lagi', { replyTo: newAnswer }));
    assert.equal(requests[3]?.history.length, 0);
    assert.equal(replies.filter((reply) => reply.content.startsWith('answer')).length, 4);
  } finally {
    database.close();
  }
});

test('rapid messages stay ordered, duplicates are ignored, and long replies split safely', async () => {
  const requests: AiRequest[] = [];
  const longText = `${'Paragraf pertama. '.repeat(120)}\n\n${'Paragraf kedua. '.repeat(120)}`;
  const { database, conversations, replies, message } = setup(async (request) => {
    requests.push(request);
    if (requests.length === 1) await new Promise((resolve) => setTimeout(resolve, 20));
    return requests.length === 1 ? 'jawaban pertama' : longText;
  });
  try {
    const first = message('user-a', `<@${botId}> pesan satu`, { id: 'same' });
    await Promise.all([conversations.handleMessage(first), conversations.handleMessage(first)]);
    const firstAnswer = replies[0]!.botMessageId;
    const second = message('user-a', 'pesan dua', { replyTo: firstAnswer });
    const third = message('user-a', 'pesan tiga', { replyTo: firstAnswer });
    await Promise.all([conversations.handleMessage(second), conversations.handleMessage(third)]);
    assert.equal(requests.length, 3);
    assert.equal(requests[1]?.history[1]?.content, 'jawaban pertama');
    assert.equal(requests[2]?.history[3]?.content, longText);
    assert.equal(replies[0]?.content, 'jawaban pertama');
    assert.ok(replies.length > 2);
    assert.ok(replies.every((reply) => reply.content.length <= 1900));
    assert.equal(splitMessage('x'.repeat(4500)).join(''), 'x'.repeat(4500));
  } finally {
    database.close();
  }
});

test('AI failure gets a friendly reply and migration remains idempotent', async () => {
  const { database, conversations, replies, message } = setup(async () => { throw new ProviderError('groq', 'auth', 401); });
  try {
    await conversations.handleMessage(message('user-a', `<@${botId}> halo`));
    assert.match(replies[0]?.content ?? '', /^Maaf, aku lagi susah/);
    migrate(database);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 5);
  } finally {
    database.close();
  }
});
