import { REST, Routes } from 'discord.js';
import type { Env } from '../config/env.js';
import { botCommand } from '../commands/bot/status.js';
import { DiscordError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export async function registerCommands(env: Env): Promise<void> {
  try {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: [botCommand.toJSON()]
    });
    logger.info({ command: '/bot status', guildId: env.DISCORD_GUILD_ID }, 'Command registered');
  } catch {
    throw new DiscordError('Could not register Discord command. Check the token, application ID, guild ID, and installation.');
  }
}
