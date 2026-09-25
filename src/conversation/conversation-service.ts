import type { Message } from 'discord.js';
import type { Env } from '../config/env.js';
import { AiService } from '../ai/ai-service.js';
import { studyPrompt } from '../ai/prompt.js';
import { logger } from '../shared/logger.js';
import { splitMessage } from '../shared/split-message.js';
import { isCloseIntent } from './close-intent.js';
import { ConversationRepository, type ConversationIdentity } from './repository.js';

export class ConversationService {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly repository: ConversationRepository,
    private readonly ai: AiService,
    private readonly env: Env
  ) {}

  handleMessage(message: Message): Promise<void> {
    if (message.channelId !== this.env.STUDY_CHANNEL_ID || !message.guildId || message.author.bot || message.webhookId) return Promise.resolve();
    if (this.seen.has(message.id)) return Promise.resolve();
    this.seen.add(message.id);
    if (this.seen.size > 500) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }

    const identity: ConversationIdentity = {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id
    };
    const key = `${identity.guildId}:${identity.channelId}:${identity.userId}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.then(async () => {
      try {
        await this.process(message, identity);
      } catch (error) {
        logger.error({ type: error instanceof Error ? error.name : 'Unknown', userId: identity.userId }, 'Conversation processing failed');
      }
    });
    this.queues.set(key, current);
    void current.finally(() => {
      if (this.queues.get(key) === current) this.queues.delete(key);
    });
    return current;
  }

  private async process(message: Message, identity: ConversationIdentity): Promise<void> {
    const botId = message.client.user?.id;
    if (!botId) return;
    const mention = new RegExp(`<@!?${botId}>`, 'g');
    const explicitlyMentioned = mention.test(message.content);
    const content = message.content.replace(mention, '').trim();
    const now = Date.now();
    let session = this.repository.getActive(identity);

    if (session && now - session.lastActivityAt >= this.env.AI_SESSION_TIMEOUT_MINUTES * 60_000) {
      this.repository.close(session.id, now);
      logger.info({ conversationId: session.id }, 'Conversation expired');
      session = undefined;
    }

    if (explicitlyMentioned && isCloseIntent(content)) {
      if (session) {
        this.repository.close(session.id, now);
        logger.info({ conversationId: session.id }, 'Conversation closed');
        await this.reply(message, 'Sip, selesai dulu ya 😄 Kalau butuh bantuan lagi tinggal panggil aku.');
      }
      return;
    }

    const repliedToBot = !session && !explicitlyMentioned && await this.isReplyToBot(message, botId);
    if (!session && !explicitlyMentioned && !repliedToBot) return;
    if (!session) {
      session = this.repository.start(identity, now);
      logger.info({ conversationId: session.id, trigger: repliedToBot ? 'reply' : 'mention' }, 'Conversation started');
    } else {
      this.repository.touch(session.id, now);
      logger.debug({ conversationId: session.id }, 'Conversation resumed');
    }

    if (!content) {
      await this.reply(message, 'Mau bahas apa? Kirim pertanyaan atau soalmu aja 😄');
      return;
    }
    if (content.length > 4000) {
      await this.reply(message, 'Pesannya kepanjangan. Coba bagi jadi beberapa bagian, ya.');
      return;
    }

    try {
      if ('sendTyping' in message.channel) await message.channel.sendTyping();
    } catch {
      logger.warn({ conversationId: session.id }, 'Could not send typing indicator');
    }

    try {
      const response = await this.ai.generate({
        systemPrompt: studyPrompt,
        history: this.repository.recentMessages(session.id),
        userMessage: content
      }, session.id);
      for (const part of splitMessage(response)) await this.reply(message, part);
      this.repository.saveExchange(session.id, content, response, Date.now());
      logger.info({ conversationId: session.id }, 'AI response sent');
    } catch (error) {
      logger.error({ conversationId: session.id, type: error instanceof Error ? error.name : 'Unknown' }, 'AI request failed');
      try {
        await this.reply(message, 'Maaf, aku lagi susah menghubungi AI. Coba lagi sebentar ya 😅');
      } catch {
        logger.warn({ conversationId: session.id }, 'Could not send AI error response');
      }
    }
  }

  private async isReplyToBot(message: Message, botId: string): Promise<boolean> {
    if (!message.reference?.messageId) return false;
    try {
      const referenced = await message.fetchReference();
      return referenced.author.id === botId;
    } catch {
      return false;
    }
  }

  private async reply(message: Message, content: string): Promise<void> {
    await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  }
}
