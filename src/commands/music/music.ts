import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { MusicService } from '../../music/service.js';

export const musicCommands = [
  new SlashCommandBuilder().setName('play').setDescription('Putar lagu YouTube atau tambahkan ke antrean')
    .addStringOption((o) => o.setName('query').setDescription('Judul lagu atau URL YouTube').setRequired(true)),
  new SlashCommandBuilder().setName('pause').setDescription('Jeda lagu saat ini'),
  new SlashCommandBuilder().setName('resume').setDescription('Lanjutkan lagu yang dijeda'),
  new SlashCommandBuilder().setName('skip').setDescription('Lewati lagu saat ini'),
  new SlashCommandBuilder().setName('stop').setDescription('Hentikan musik dan kosongkan antrean'),
  new SlashCommandBuilder().setName('queue').setDescription('Lihat lagu dan antrean musik'),
  new SlashCommandBuilder().setName('volume').setDescription('Atur volume musik 0 sampai 100')
    .addIntegerOption((o) => o.setName('value').setDescription('Volume 0 sampai 100').setRequired(true).setMinValue(0).setMaxValue(100))
];

const safe = (title: string): string => title.replace(/[@`*_~|>\\]/g, '\\$&').slice(0, 100);
const duration = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export async function executeMusic(interaction: ChatInputCommandInteraction, service: MusicService): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: 'Perintah musik hanya tersedia di server.', flags: 64 }); return; }
  await interaction.deferReply();
  const name = interaction.commandName;
  if (name === 'queue') {
    const snapshot = service.snapshot(guild.id);
    if (!snapshot?.current) { await interaction.editReply({ content: 'Antrean masih kosong.' }); return; }
    const items = snapshot.queue.slice(0, 10).map((track, index) => `${index + 1}. ${safe(track.title)} (${duration(track.durationMs)})`).join('\n');
    await interaction.editReply({ content: `**Sedang diputar:** ${safe(snapshot.current.title)} (${duration(snapshot.current.durationMs)})${snapshot.paused ? ' [jeda]' : ''} — <@${snapshot.current.requesterId}>\n**Volume:** ${snapshot.volume}%\n**Antrean (${snapshot.queue.length}):**\n${items || 'Kosong'}${snapshot.queue.length > 10 ? `\n+ ${snapshot.queue.length - 10} lagu lainnya` : ''}`, allowedMentions: { parse: [] } });
    return;
  }
  const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
  const channel = member.voice.channel;
  if (!channel) { await interaction.editReply({ content: 'Kamu masuk voice channel dulu ya, baru aku bisa putarin musik 😄' }); return; }
  const snapshot = service.snapshot(guild.id);
  if (snapshot && snapshot.voiceChannelId !== channel.id) {
    await interaction.editReply({ content: 'Masuk ke voice channel tempat bot berada untuk mengontrol musik.' }); return;
  }
  if (name === 'play') {
    if (!service.available()) { await interaction.editReply({ content: 'Server musik Sonata sedang offline. Coba lagi nanti.' }); return; }
    const me = guild.members.me ?? await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      await interaction.editReply({ content: 'Bot perlu izin View Channel, Connect, dan Speak di voice channel itu.' }); return;
    }
    let content: string;
    try {
      const result = await service.play(guild.id, channel.id, interaction.channelId, interaction.options.getString('query', true), interaction.user.id);
      content = result.kind === 'playing'
        ? `Sekarang memutar: ${safe(result.track.title)} (${duration(result.track.durationMs)})`
        : `Ditambahkan ke antrean #${result.position}: ${safe(result.track.title)} (${duration(result.track.durationMs)})`;
    } catch (error) { content = error instanceof Error ? error.message : 'Gagal memutar lagu.'; }
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
    return;
  }
  let content: string;
  try {
    switch (name) {
      case 'pause': await service.pause(guild.id, true); content = 'Musik dijeda.'; break;
      case 'resume': await service.pause(guild.id, false); content = 'Musik dilanjutkan.'; break;
      case 'skip': {
        const next = await service.skip(guild.id);
        content = next ? `Lewati lagu. Sekarang memutar: ${safe(next.title)}` : 'Lagu dilewati. Antrean kosong.';
        break;
      }
      case 'stop':
        if (!snapshot) throw new Error('Bot belum memutar musik di server ini.');
        await service.stop(guild.id); content = 'Musik dihentikan, antrean dikosongkan, dan bot keluar dari voice.'; break;
      case 'volume': {
        const level = interaction.options.getInteger('value', true);
        await service.volume(guild.id, level); content = `Volume diatur ke ${level}%.`; break;
      }
      default: return;
    }
  } catch (error) {
    content = error instanceof Error ? error.message : 'Perintah musik gagal.';
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}
