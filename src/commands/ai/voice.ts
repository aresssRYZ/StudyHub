import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { VoiceService } from '../../voice/service.js';
import type { VoiceMode } from '../../voice/conversation.js';

export const aiCommand = new SlashCommandBuilder().setName('ai').setDescription('Ngobrol dengan StudyHub di voice')
  .addSubcommand((s) => s.setName('join').setDescription('Ajak StudyHub masuk voice'))
  .addSubcommand((s) => s.setName('leave').setDescription('Akhiri sesi Voice AI'))
  .addSubcommand((s) => s.setName('mode').setDescription('Ganti gaya ngobrol Voice AI')
    .addStringOption((o) => o.setName('mode').setDescription('Gaya ngobrol').setRequired(true)
      .addChoices({ name: 'Assistant', value: 'assistant' }, { name: 'Casual', value: 'casual' }, { name: 'Curhat', value: 'curhat' })))
  .addSubcommand((s) => s.setName('status').setDescription('Lihat status sesi Voice AI'));

const names: Record<VoiceMode, string> = { assistant: 'Assistant', casual: 'Casual', curhat: 'Curhat' };

export async function executeAi(interaction: ChatInputCommandInteraction, service: VoiceService): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: 'Voice AI hanya tersedia di server.', flags: 64 }); return; }
  await interaction.deferReply({ flags: 64 });
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'status') {
      const status = service.snapshot(guild.id);
      if (!status) { await interaction.editReply('Voice AI belum aktif.'); return; }
      const duration = Math.floor((Date.now() - status.createdAt) / 1000);
      await interaction.editReply({ content: `**Voice AI:** Connected\n**Channel:** <#${status.voiceChannelId}>\n**Owner:** <@${status.ownerId}>\n**Mode:** ${names[status.mode]}\n**State:** ${status.state}\n**Durasi:** ${Math.floor(duration / 60)}m ${duration % 60}s`, allowedMentions: { parse: [] } });
      return;
    }
    if (sub === 'mode') {
      const mode = interaction.options.getString('mode', true) as VoiceMode;
      service.mode(guild.id, interaction.user.id, mode);
      await interaction.editReply(`Mode voice sekarang: ${names[mode]}.`);
      return;
    }
    if (sub === 'leave') {
      await service.leave(guild.id, interaction.user.id);
      await interaction.editReply('Siap, aku keluar dari voice dulu 👋');
      return;
    }
    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel) { await interaction.editReply('Kamu masuk voice dulu ya, baru aku bisa ikut ngobrol 😄'); return; }
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      await interaction.editReply('Bot perlu izin View Channel, Connect, dan Speak di voice channel itu.'); return;
    }
    await service.join(channel, interaction.channelId, interaction.user.id);
    await interaction.editReply('Aku sudah masuk voice. Kamu bisa langsung bicara; aku mendengarkan kamu saja.');
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : 'Voice AI gagal menjalankan perintah.');
  }
}
