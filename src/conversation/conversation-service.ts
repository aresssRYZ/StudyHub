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
    const linkedSession = !explicitlyMentioned && message.reference?.messageId
      ? this.repository.getByReply(message.reference.messageId, identity)
      : undefined;
    if (!explicitlyMentioned && !linkedSession) return;

    const now = Date.now();
    let activeSession = this.repository.getActive(identity);
    const expiredSessionId = activeSession && now - activeSession.lastActivityAt >= this.env.AI_SESSION_TIMEOUT_MINUTES * 60_000
      ? activeSession.id : undefined;
    if (expiredSessionId) {
      this.repository.close(expiredSessionId, now);
      logger.info({ conversationId: expiredSessionId }, 'Conversation expired');
      activeSession = undefined;
    }

    if (explicitlyMentioned && isCloseIntent(content)) {
      if (activeSession) {
        this.repository.close(activeSession.id, now);
        logger.info({ conversationId: activeSession.id }, 'Conversation closed');
        await this.reply(message, 'Sip, selesai dulu ya 😄 Kalau butuh bantuan lagi tinggal panggil aku.');
      }
      return;
    }

    let session;
    if (explicitlyMentioned) {
      if (activeSession) this.repository.close(activeSession.id, now);
      session = this.repository.start(identity, now);
      logger.info({ conversationId: session.id, trigger: 'mention' }, 'Conversation started');
    } else if (linkedSession?.status === 'ACTIVE' && activeSession?.id === linkedSession.id) {
      session = activeSession;
      this.repository.touch(session.id, now);
      logger.debug({ conversationId: session.id }, 'Conversation resumed');
    } else if (linkedSession?.id === expiredSessionId) {
      session = this.repository.start(identity, now);
      logger.info({ conversationId: session.id, trigger: 'reply_after_timeout' }, 'Conversation started');
    } else {
      return;
    }

    if (!content) {
      await this.replyAndLink(message, 'Mau bahas apa? Kirim pertanyaan atau soalmu aja 😄', session.id);
      return;
    }
    if (content.length > 4000) {
      await this.replyAndLink(message, 'Pesannya kepanjangan. Coba bagi jadi beberapa bagian, ya.', session.id);
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
      for (const part of splitMessage(response)) await this.replyAndLink(message, part, session.id);
      this.repository.saveExchange(session.id, content, response, Date.now());
      logger.info({ conversationId: session.id }, 'AI response sent');
    } catch (error) {
      logger.error({ conversationId: session.id, type: error instanceof Error ? error.name : 'Unknown' }, 'AI request failed');
      try {
        await this.replyAndLink(message, 'Maaf, aku lagi susah menghubungi AI. Coba lagi sebentar ya 😅', session.id);
      } catch {
        logger.warn({ conversationId: session.id }, 'Could not send AI error response');
      }
    }
  }

  private async replyAndLink(message: Message, content: string, conversationId: number): Promise<void> {
    const sent = await this.reply(message, content);
    this.repository.linkReply(sent.id, conversationId);
  }

  private async reply(message: Message, content: string): Promise<Message> {
    return message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  }
}
