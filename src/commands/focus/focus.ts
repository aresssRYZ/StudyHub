import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Env } from '../../config/env.js';
import type { FocusService } from '../../focus/service.js';

export const focusCommand = new SlashCommandBuilder()
  .setName('focus')
  .setDescription('Atur sesi belajar fokus')
  .addSubcommand((subcommand) => subcommand
    .setName('start').setDescription('Mulai sesi fokus')
    .addIntegerOption((option) => option.setName('duration').setDescription('Durasi dalam menit').setRequired(true).setMinValue(1).setMaxValue(1440)))
  .addSubcommand((subcommand) => subcommand.setName('stop').setDescription('Hentikan sesi fokus'))
  .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Lihat sesi fokus saat ini'))
  .addSubcommand((subcommand) => subcommand.setName('stats').setDescription('Lihat statistik fokus'));

function timestamp(time: number, style: 'f' | 'R' = 'f'): string {
  return `<t:${Math.floor(time / 1000)}:${style}>`;
}

export async function executeFocus(
  interaction: ChatInputCommandInteraction,
  service: FocusService,
  env: Env
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Sesi fokus hanya tersedia di server.', flags: 64 });
    return;
  }
  const identity = { guildId: interaction.guildId, userId: interaction.user.id };
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'start') {
    const duration = interaction.options.getInteger('duration', true);
    const result = service.start(identity, interaction.channelId, duration);
    if (result.kind === 'invalid_duration') {
      await interaction.reply({ content: `Pilih durasi ${env.FOCUS_MIN_DURATION_MINUTES}–${env.FOCUS_MAX_DURATION_MINUTES} menit, ya.`, flags: 64 });
      return;
    }
    if (result.kind === 'already_active') {
      await interaction.reply({ content: 'Kamu masih punya sesi fokus aktif. Selesaikan atau hentikan dulu ya.', flags: 64 });
      return;
    }
    const embed = new EmbedBuilder().setTitle('Focus dimulai').setColor(0x3b82f6)
      .setDescription('Fokus dulu ya. Aku kabarin kalau waktunya selesai 📚')
      .addFields(
        { name: 'Durasi', value: `${duration} menit`, inline: true },
        { name: 'Selesai', value: timestamp(result.session.endsAt), inline: true }
      );
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (subcommand === 'stop') {
    const stopped = service.stop(identity);
    await interaction.reply({ content: stopped
      ? 'Oke, sesi fokusnya aku hentikan. Kalau siap, kamu bisa mulai lagi kapan saja.'
      : 'Kayaknya kamu lagi nggak punya sesi fokus aktif.', flags: stopped ? undefined : 64 });
    return;
  }

  if (subcommand === 'status') {
    const session = service.status(identity);
    if (!session) {
      await interaction.reply({ content: 'Kamu belum punya sesi fokus aktif. Mulai dengan `/focus start` ya.', flags: 64 });
      return;
    }
    const remaining = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 60_000));
    const streak = service.stats(identity).currentStreak;
    const embed = new EmbedBuilder().setTitle('Focus Session').setColor(0x3b82f6)
      .addFields(
        { name: 'Status', value: 'Sedang fokus', inline: true },
        { name: 'Durasi', value: `${session.durationMinutes} menit`, inline: true },
        { name: 'Sisa', value: `${remaining} menit`, inline: true },
        { name: 'Mulai', value: timestamp(session.startedAt), inline: true },
        { name: 'Selesai', value: `${timestamp(session.endsAt)} (${timestamp(session.endsAt, 'R')})`, inline: true },
        { name: 'Streak', value: `${streak} hari`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
    return;
  }

  const stats = service.stats(identity);
  const embed = new EmbedBuilder().setTitle('Statistik Focus').setColor(0x3b82f6)
    .addFields(
      { name: 'Sesi selesai', value: String(stats.sessions), inline: true },
      { name: 'Total fokus', value: `${stats.minutes} menit`, inline: true },
      { name: 'Streak saat ini', value: `${stats.currentStreak} hari`, inline: true },
      { name: 'Streak terbaik', value: `${stats.bestStreak} hari`, inline: true }
    );
  await interaction.reply({ embeds: [embed] });
}
