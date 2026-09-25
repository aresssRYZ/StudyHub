import type { Message } from 'discord.js';
import type { ConversationService } from '../conversation/conversation-service.js';

export function onMessageCreate(message: Message, conversations: ConversationService): void {
  void conversations.handleMessage(message);
}
