import { ActivityType, type Client } from 'discord.js';
import { logger } from '../shared/logger.js';

export function onReady(client: Client<true>): void {
  client.user.setPresence({ status: 'online', activities: [{ name: '/bot status', type: ActivityType.Playing }] });
  logger.info({ botId: client.user.id }, 'Discord connected');
}
