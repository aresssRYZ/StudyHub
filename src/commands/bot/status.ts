import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { StudyHubDatabase } from '../../database/database.js';
import type { Env } from '../../config/env.js';
import { formatDuration } from '../../shared/format-duration.js';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

export const botCommand = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('StudyHub bot commands')
  .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show StudyHub status'));

export async function executeBotStatus(
  interaction: ChatInputCommandInteraction,
  database: StudyHubDatabase,
  env: Env
): Promise<void> {
  database.prepare('SELECT 1').get();

  const embed = new EmbedBuilder()
    .setTitle('StudyHub AI')
    .setColor(0x3b82f6)
    .addFields(
      { name: 'Status', value: 'Online', inline: true },
      { name: 'Database', value: 'Connected', inline: true },
      { name: 'Discord Ping', value: `${interaction.client.ws.ping} ms`, inline: true },
      { name: 'Uptime', value: formatDuration(interaction.client.uptime ?? 0), inline: true },
      { name: 'Version', value: packageJson.version, inline: true },
      { name: 'Environment', value: env.NODE_ENV, inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}
