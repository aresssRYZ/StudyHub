import type { Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { executeBotStatus } from '../commands/bot/status.js';
import { executeFocus } from '../commands/focus/focus.js';
import type { FocusService } from '../focus/service.js';
import { errorDetails } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export async function routeCommand(interaction: Interaction, database: StudyHubDatabase, env: Env, focus: FocusService): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'bot' && interaction.options.getSubcommand(false) === 'status') {
      await executeBotStatus(interaction, database, env);
    } else if (interaction.commandName === 'focus') {
      await executeFocus(interaction, focus, env);
    } else {
      return;
    }
    logger.info({ command: interaction.commandName, guildId: interaction.guildId }, 'Command executed');
  } catch (error) {
    logger.error({ ...errorDetails(error), command: interaction.commandName }, 'Command failed');
    try {
      const message = { content: 'Terjadi kesalahan saat menjalankan command.', flags: 64 } as const;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(message);
      } else {
        await interaction.reply(message);
      }
    } catch (replyError) {
      logger.error(errorDetails(replyError), 'Could not send interaction error response');
    }
  }
}
