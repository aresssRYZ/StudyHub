import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { PlaylistService } from '../../playlist/service.js';
import type { MusicService } from '../../music/service.js';
import { DatabaseError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export const playlistCommand = new SlashCommandBuilder().setName('playlist').setDescription('Kelola playlist pribadi')
  .addSubcommand((s) => s.setName('create').setDescription('Buat playlist').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true).setMaxLength(40)))
  .addSubcommand((s) => s.setName('add').setDescription('Simpan lagu aktif atau cari lagu').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)).addStringOption((o) => o.setName('query').setDescription('Judul atau URL YouTube (opsional)')))
  .addSubcommand((s) => s.setName('import').setDescription('Impor lagu dari playlist YouTube').addStringOption((o) => o.setName('name').setDescription('Playlist StudyHub tujuan').setRequired(true)).addStringOption((o) => o.setName('url').setDescription('URL playlist YouTube').setRequired(true)))
  .addSubcommand((s) => s.setName('load').setDescription('Muat playlist ke antrean').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Daftar playlist kamu'))
  .addSubcommand((s) => s.setName('show').setDescription('Lihat isi playlist').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Hapus lagu dari playlist').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)).addIntegerOption((o) => o.setName('position').setDescription('Nomor lagu').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('delete').setDescription('Hapus playlist').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)))
  .addSubcommand((s) => s.setName('set-focus').setDescription('Pilih playlist untuk sesi Focus').addStringOption((o) => o.setName('name').setDescription('Nama playlist').setRequired(true)))
  .addSubcommand((s) => s.setName('unset-focus').setDescription('Lepas playlist Focus'));

const safe = (value: string): string => value.replace(/\s+/g, ' ').replace(/[@`*_~|>\\]/g, '\\$&').slice(0, 120);

export async function executePlaylist(interaction: ChatInputCommandInteraction, service: PlaylistService, music: MusicService): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: 'Playlist hanya tersedia di server.', flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const owner = { guildId: interaction.guildId, userId: interaction.user.id };
  const action = interaction.options.getSubcommand();
  const name = interaction.options.getString('name') ?? '';
  let content: string;
  try {
    switch (action) {
      case 'create': {
        const item = service.create(owner, name);
        content = `Playlist **${safe(item.name)}** dibuat.`;
        break;
      }
      case 'add': {
        const track = await service.add(owner, name, owner.userId, interaction.options.getString('query') ?? undefined);
        content = `**${safe(track.title)}** ditambahkan ke playlist **${safe(name)}**.`;
        break;
      }
      case 'import': {
        const result = await service.importYoutube(owner, name, interaction.options.getString('url', true));
        content = `${result.added} lagu berhasil ditambahkan ke playlist **${safe(name)}**.` +
          (result.skipped ? ` ${result.skipped} lagu dilewati karena metadata tidak valid.` : '') +
          (result.full ? ' Batas lagu playlist tercapai; sisanya belum ditambahkan.' : '');
        break;
      }
      case 'list': {
        const items = service.list(owner);
        content = items.length ? `Playlist kamu:\n${items.slice(0, 20).map((item, i) =>
          `${i + 1}. **${safe(item.name)}** — ${item.count} lagu${item.isFocus ? ' ★ Focus' : ''}`).join('\n')}${items.length > 20 ? `\n+ ${items.length - 20} playlist lainnya` : ''}` : 'Kamu belum punya playlist.';
        break;
      }
      case 'show': {
        const { playlist, tracks } = service.show(owner, name);
        content = `**${safe(playlist.name)}** — ${tracks.length} lagu${playlist.isFocus ? ' ★ Focus' : ''}\n${tracks.slice(0, 15).map((track, i) =>
          `${i + 1}. ${safe(track.title)}`).join('\n') || 'Playlist masih kosong.'}${tracks.length > 15 ? `\n+ ${tracks.length - 15} lagu lainnya` : ''}`;
        break;
      }
      case 'remove': {
        const track = service.remove(owner, name, interaction.options.getInteger('position', true));
        content = `**${safe(track.title)}** sudah dihapus dari playlist **${safe(name)}**.`;
        break;
      }
      case 'delete': {
        const item = service.delete(owner, name);
        content = `Playlist **${safe(item.name)}** dan semua lagunya dihapus.`;
        break;
      }
      case 'set-focus': {
        const item = service.setFocus(owner, name);
        content = `**${safe(item.name)}** sekarang menjadi playlist Focus kamu.`;
        break;
      }
      case 'unset-focus':
        service.unsetFocus(owner);
        content = 'Playlist Focus dilepas. Sesi Focus berikutnya berjalan tanpa musik otomatis.';
        break;
      case 'load': {
        const item = service.get(owner, name);
        if (!item.count) { content = `Playlist **${safe(item.name)}** masih kosong.`; break; }
        const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(owner.userId);
        const channel = member.voice.channel;
        if (!channel) { content = 'Kamu masuk voice dulu ya sebelum memuat playlist.'; break; }
        const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
          content = 'Bot perlu izin View Channel, Connect, dan Speak di voice channel itu.'; break;
        }
        if (!music.available()) { content = 'Playlist-nya aman, tapi server musik lagi nggak tersedia.'; break; }
        const result = await service.load(owner, item, channel.id, interaction.channelId);
        content = result.kind === 'empty' ? `Playlist **${safe(item.name)}** masih kosong.` :
          `${result.loaded} lagu dimuat dari playlist **${safe(item.name)}**.${result.unavailable ? ` ${result.unavailable} lagu tidak tersedia saat ini.` : ''}`;
        break;
      }
      default: return;
    }
  } catch (error) {
    if (error instanceof DatabaseError || (error instanceof Error && /SQLITE_/.test(error.message))) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Playlist database operation failed');
      content = 'Maaf, playlist-nya belum bisa diproses sekarang.';
    } else {
      content = error instanceof Error ? error.message : 'Playlist belum bisa diproses sekarang.';
    }
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}
