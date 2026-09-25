import { DiscordAPIError, HTTPError, REST, Routes } from 'discord.js';
import type { Env } from '../config/env.js';
import { botCommand } from '../commands/bot/status.js';
import { focusCommand } from '../commands/focus/focus.js';
import { DiscordError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export async function registerCommands(env: Env): Promise<void> {
  try {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: [botCommand.toJSON(), focusCommand.toJSON()]
    });
    logger.info({ commands: ['/bot status', '/focus'], guildId: env.DISCORD_GUILD_ID }, 'Commands registered');
  } catch (error) {
    // Only expose numeric API metadata; REST errors also contain request data.
    if (error instanceof DiscordAPIError || error instanceof HTTPError) {
      const code = error instanceof DiscordAPIError && typeof error.code === 'number' ? error.code : undefined;
      let hint = 'Check the application ID, guild ID, and bot installation.';
      if (error.status === 401) hint = 'DISCORD_TOKEN is invalid or expired. Reset the bot token and update .env.';
      else if (code === 50001) hint = 'Missing Access. Install this application in the target server with the bot and applications.commands scopes; verify both IDs.';
      else if (code === 50013) hint = 'Missing Permissions. Check the application installation and server permissions.';
      else if (code === 10002) hint = 'Unknown Application. DISCORD_CLIENT_ID must be the Application ID belonging to this bot token.';
      else if (code === 10004) hint = 'Unknown Guild. Check DISCORD_GUILD_ID and install the bot in that server.';
      else if (code === 50035) hint = 'Invalid Form Body. Check the slash command definition and IDs.';
      throw new DiscordError(`Command registration failed (HTTP ${error.status}${code === undefined ? '' : `, Discord ${code}`}). ${hint}`);
    }
    throw new DiscordError('Could not reach Discord. Check the network, DNS, proxy, and TLS configuration, then retry.');
  }
}
