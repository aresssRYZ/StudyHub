import { DiscordAPIError, type Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { executeBotStatus } from '../commands/bot/status.js';
import { executeFocus } from '../commands/focus/focus.js';
import type { FocusService } from '../focus/service.js';
import type { MusicService } from '../music/service.js';
import { executeMusic } from '../commands/music/music.js';
import { errorDetails } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export async function routeCommand(interaction: Interaction, database: StudyHubDatabase, env: Env, focus: FocusService, music: MusicService): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'bot' && interaction.options.getSubcommand(false) === 'status') {
      await executeBotStatus(interaction, database, env, music);
    } else if (interaction.commandName === 'focus') {
      await executeFocus(interaction, focus, env);
    } else if (['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'volume'].includes(interaction.commandName)) {
      await executeMusic(interaction, music);
    } else {
      return;
    }
    logger.info({ command: interaction.commandName, guildId: interaction.guildId }, 'Command executed');
  } catch (error) {
    logger.error({ ...errorDetails(error), command: interaction.commandName }, 'Command failed');
    if (error instanceof DiscordAPIError && (error.code === 10062 || error.code === 40060)) return;
    try {
      const content = 'Terjadi kesalahan saat menjalankan command.';
      if (interaction.deferred) {
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
      } else if (interaction.replied) {
        await interaction.followUp({ content, flags: 64 });
      } else {
        await interaction.reply({ content, flags: 64 });
      }
    } catch (replyError) {
      logger.error(errorDetails(replyError), 'Could not send interaction error response');
    }
  }
}
