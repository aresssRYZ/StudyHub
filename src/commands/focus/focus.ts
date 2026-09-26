import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Env } from '../../config/env.js';
import type { FocusService } from '../../focus/service.js';
import type { PlaylistService } from '../../playlist/service.js';
import type { MusicService } from '../../music/service.js';
import { logger } from '../../shared/logger.js';

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
  env: Env,
  playlists: PlaylistService,
  music: MusicService
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Sesi fokus hanya tersedia di server.', flags: 64 });
    return;
  }
  const identity = { guildId: interaction.guildId, userId: interaction.user.id };
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'start') {
    await interaction.deferReply();
    const duration = interaction.options.getInteger('duration', true);
    const result = service.start(identity, interaction.channelId, duration);
    if (result.kind === 'invalid_duration') {
      await interaction.editReply({ content: `Pilih durasi ${env.FOCUS_MIN_DURATION_MINUTES}–${env.FOCUS_MAX_DURATION_MINUTES} menit, ya.` });
      return;
    }
    if (result.kind === 'already_active') {
      await interaction.editReply({ content: 'Kamu masih punya sesi fokus aktif. Selesaikan atau hentikan dulu ya.' });
      return;
    }
    let description = 'Fokus dulu ya. Aku kabarin kalau waktunya selesai 📚';
    try {
      const selected = playlists.focus(identity);
      if (selected) {
        const guild = interaction.guild;
        const member = guild && (interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(identity.userId));
        const channel = member?.voice.channel;
        if (!channel) description += '\nPlaylist Focus tersedia, tapi kamu belum masuk voice. Focus berjalan tanpa musik.';
        else if (!music.available()) description += '\nFocus tetap berjalan, tapi server musik belum tersedia.';
        else {
          const me = guild?.members.me ?? await guild?.members.fetchMe();
          if (!me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
            description += '\nFocus tetap berjalan, tapi bot belum punya izin voice yang diperlukan.';
          } else {
            const loaded = await playlists.load(identity, selected, channel.id, interaction.channelId, result.session.id);
            if (loaded.kind === 'busy') description += '\nMusik server lagi dipakai, jadi playlist Focus tidak mengganti lagu yang ada.';
            else if (loaded.kind === 'empty') description += '\nPlaylist Focus masih kosong. Focus berjalan tanpa musik.';
            else if (loaded.loaded) {
              logger.info({ focusSessionId: result.session.id, guildId: identity.guildId, loaded: loaded.loaded }, 'Focus music started');
              description += `\nPlaylist **${selected.name.replace(/[@`*_~|>\\]/g, '\\$&')}** juga diputar (${loaded.loaded} lagu).`;
            }
            else description += '\nFocus tetap berjalan, tapi lagu playlist belum tersedia saat ini.';
            if (service.status(identity)?.id !== result.session.id) await music.stopFocusOwned(identity.guildId, result.session.id);
          }
        }
      }
    } catch (error) {
      logger.warn({ focusSessionId: result.session.id, message: error instanceof Error ? error.message : String(error) }, 'Focus music failed');
      description += '\nFocus tetap berjalan, tapi musiknya belum bisa diputar sekarang.';
    }
    const embed = new EmbedBuilder().setTitle('Focus dimulai').setColor(0x3b82f6)
      .setDescription(description)
      .addFields(
        { name: 'Durasi', value: `${duration} menit`, inline: true },
        { name: 'Selesai', value: timestamp(result.session.endsAt), inline: true }
      );
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    return;
  }

  if (subcommand === 'stop') {
    await interaction.deferReply();
    const stopped = service.stop(identity);
    if (stopped) {
      try { await music.stopFocusOwned(identity.guildId, stopped.id); }
      catch (error) { logger.warn({ focusSessionId: stopped.id, message: error instanceof Error ? error.message : String(error) }, 'Focus music cleanup failed'); }
    }
    await interaction.editReply({ content: stopped
      ? 'Oke, sesi fokusnya aku hentikan. Kalau siap, kamu bisa mulai lagi kapan saja.'
      : 'Kayaknya kamu lagi nggak punya sesi fokus aktif.' });
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
