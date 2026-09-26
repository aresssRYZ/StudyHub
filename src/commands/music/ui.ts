import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder,
  GuildMember, MessageFlags
} from 'discord.js';
import type { MusicService } from '../../music/service.js';

type Snapshot = NonNullable<ReturnType<MusicService['snapshot']>>;
type Action = 'pause' | 'resume' | 'skip' | 'stop' | 'queue' | 'volume_down' | 'volume_up';
const actions = new Set<Action>(['pause', 'resume', 'skip', 'stop', 'queue', 'volume_down', 'volume_up']);

function control(action: Action, label: string, disabled: boolean, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`music:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);
}

function upcoming(id: string, label: string): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`music:upcoming_${id}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(true);
}

const safe = (value: string): string => value.replace(/\s+/g, ' ').replace(/[@`*_~|>\\]/g, '\\$&').slice(0, 100);
const duration = (ms: number): string => ms > 0
  ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : 'Live';

function youtubeUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)
      ? url.toString() : null;
  } catch { return null; }
}

function coverUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['i.ytimg.com', 'img.youtube.com', 'i9.ytimg.com'].includes(url.hostname)
      ? url.toString() : null;
  } catch { return null; }
}

function progress(positionMs: number, totalMs: number): string {
  if (totalMs <= 0) return '🔴 Live';
  const position = Math.min(Math.max(0, positionMs), totalMs);
  const filled = Math.min(15, Math.floor(position / totalMs * 15));
  return `\`${duration(position)}  ${'━'.repeat(filled)}●${'─'.repeat(15 - filled)}  ${duration(totalMs)}\``;
}

export function musicView(snapshot: Snapshot | null, content = '') {
  const current = snapshot?.current;
  const embed = new EmbedBuilder()
    .setColor(current ? (snapshot.paused ? 0xD9A75F : 0x7289DA) : 0x747F8D)
    .setAuthor({ name: 'STUDYHUB  •  MUSIC' })
    .setTitle(current ? safe(current.title) || 'Judul tidak tersedia' : 'Pemutar musik')
    .setDescription(current
      ? `**${snapshot.paused ? '⏸  DIJEDA' : '♫  NOW PLAYING'}**\n${current.author ? `${safe(current.author)}\n` : ''}\n${progress(snapshot.positionMs, current.durationMs)}`
      : 'Belum ada lagu yang sedang diputar.')
    .addFields(
      { name: 'Diminta oleh', value: current ? `<@${current.requesterId}>` : '—', inline: true },
      { name: 'Volume', value: snapshot ? `${snapshot.volume}%` : '—', inline: true },
      { name: 'Antrean', value: snapshot ? `${snapshot.queue.length} lagu` : 'Kosong', inline: true }
    )
    .setFooter({ text: 'STUDYHUB MUSIC  •  Kontrol tersedia di voice channel bot' });
  const link = youtubeUrl(current?.uri);
  if (link) embed.setURL(link);
  const cover = coverUrl(current?.artworkUrl);
  if (cover) embed.setImage(cover);
  if (snapshot?.queue.length) {
    embed.addFields({ name: 'Berikutnya', value: snapshot.queue.slice(0, 3)
      .map((track, index) => `${index + 1}. ${safe(track.title)}`).join('\n') });
  }
  if (snapshot) embed.addFields({ name: 'Voice channel', value: `<#${snapshot.voiceChannelId}>`, inline: false });
  const playbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    control('resume', '▶', !current || !snapshot.paused),
    upcoming('prev', '|◁'),
    control('pause', '❚❚', !current || snapshot.paused),
    control('skip', '▷|', !current),
    upcoming('loop', '↻')
  );
  const volumeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    control('volume_down', '—', !snapshot || snapshot.volume === 0),
    upcoming('rewind', '≪'),
    upcoming('like', '♡'),
    upcoming('forward', '≫'),
    control('volume_up', '＋', !snapshot || snapshot.volume === 100)
  );
  const extraRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    upcoming('lyrics', '♪'),
    upcoming('shuffle', '⤨'),
    control('stop', '■', !snapshot),
    upcoming('filter', '❖'),
    control('queue', '☰', false)
  );
  return { content, embeds: [embed], components: [playbackRow, volumeRow, extraRow], allowedMentions: { parse: [] as [] } };
}

function queueText(snapshot: Snapshot | null): string {
  if (!snapshot?.current) return 'Antrean masih kosong.';
  const items = snapshot.queue.slice(0, 10)
    .map((track, index) => `${index + 1}. ${safe(track.title)} (${duration(track.durationMs)})`).join('\n');
  return `**Sedang diputar:** ${safe(snapshot.current.title)} (${duration(snapshot.current.durationMs)})${snapshot.paused ? ' [jeda]' : ''} — <@${snapshot.current.requesterId}>\n**Volume:** ${snapshot.volume}%\n**Antrean (${snapshot.queue.length}):**\n${items || 'Kosong'}${snapshot.queue.length > 10 ? `\n+ ${snapshot.queue.length - 10} lagu lainnya` : ''}`;
}

export async function executeMusicButton(interaction: ButtonInteraction, service: MusicService): Promise<void> {
  const action = interaction.customId.slice('music:'.length) as Action;
  if (!actions.has(action)) return;
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: 'Kontrol musik hanya tersedia di server.', flags: MessageFlags.Ephemeral }); return; }
  if (action === 'queue') {
    await interaction.reply({ content: queueText(service.snapshot(guild.id)), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  await interaction.deferUpdate();
  const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
  const snapshot = service.snapshot(guild.id);
  if (!member.voice.channel || !snapshot || snapshot.voiceChannelId !== member.voice.channel.id) {
    await interaction.followUp({ content: 'Masuk ke voice channel tempat bot berada untuk mengontrol musik.', flags: MessageFlags.Ephemeral });
    await interaction.editReply(musicView(snapshot));
    return;
  }
  let content: string;
  try {
    switch (action) {
      case 'pause': await service.pause(guild.id, true); content = 'Musik dijeda.'; break;
      case 'resume': await service.pause(guild.id, false); content = 'Musik dilanjutkan.'; break;
      case 'skip': {
        const next = await service.skip(guild.id);
        content = next ? `Sekarang memutar: ${safe(next.title)}` : 'Lagu dilewati. Antrean kosong.';
        break;
      }
      case 'stop': await service.stop(guild.id); content = 'Musik dihentikan dan bot keluar dari voice.'; break;
      case 'volume_down':
      case 'volume_up': {
        const next = Math.max(0, Math.min(100, snapshot.volume + (action === 'volume_up' ? 10 : -10)));
        await service.volume(guild.id, next);
        content = `Volume diatur ke ${next}%.`;
        break;
      }
    }
  } catch (error) {
    await interaction.followUp({ content: error instanceof Error ? error.message : 'Kontrol musik gagal.', flags: MessageFlags.Ephemeral });
    await interaction.editReply(musicView(service.snapshot(guild.id)));
    return;
  }
  await interaction.editReply(musicView(service.snapshot(guild.id), content));
}
