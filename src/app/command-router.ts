import { DiscordAPIError, type Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { executeBotStatus } from '../commands/bot/status.js';
import { executeFocus } from '../commands/focus/focus.js';
import type { FocusService } from '../focus/service.js';
import type { MusicService } from '../music/service.js';
import { executeMusic } from '../commands/music/music.js';
import { executeMusicButton } from '../commands/music/ui.js';
import { executePlaylist } from '../commands/playlist/playlist.js';
import type { PlaylistService } from '../playlist/service.js';
import type { VoiceService } from '../voice/service.js';
import { executeAi } from '../commands/ai/voice.js';
import { errorDetails } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export async function routeCommand(interaction: Interaction, database: StudyHubDatabase, env: Env, focus: FocusService, music: MusicService, playlists: PlaylistService, voice?: VoiceService): Promise<void> {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  if (interaction.isButton() && !interaction.customId.startsWith('music:')) return;
  const command = interaction.isButton() ? interaction.customId : interaction.commandName;

  try {
    if (interaction.isButton()) {
      await executeMusicButton(interaction, music);
    } else if (interaction.commandName === 'bot' && interaction.options.getSubcommand(false) === 'status') {
      await executeBotStatus(interaction, database, env, music);
    } else if (interaction.commandName === 'focus') {
      await executeFocus(interaction, focus, env, playlists, music);
    } else if (interaction.commandName === 'playlist') {
      await executePlaylist(interaction, playlists, music);
    } else if (interaction.commandName === 'ai' && voice) {
      await executeAi(interaction, voice);
    } else if (['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'volume'].includes(interaction.commandName)) {
      await executeMusic(interaction, music);
    } else {
      return;
    }
    logger.info({ command, guildId: interaction.guildId }, 'Command executed');
  } catch (error) {
    logger.error({ ...errorDetails(error), command }, 'Command failed');
    if (error instanceof DiscordAPIError && (error.code === 10062 || error.code === 40060)) return;
    try {
      const content = 'Terjadi kesalahan saat menjalankan command.';
      if (interaction.isButton() && (interaction.deferred || interaction.replied)) {
        await interaction.followUp({ content, flags: 64 });
      } else if (interaction.deferred) {
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
