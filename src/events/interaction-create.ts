import type { Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { routeCommand } from '../app/command-router.js';
import type { FocusService } from '../focus/service.js';
import type { MusicService } from '../music/service.js';
import type { PlaylistService } from '../playlist/service.js';
import type { VoiceService } from '../voice/service.js';

export function onInteractionCreate(interaction: Interaction, database: StudyHubDatabase, env: Env, focus: FocusService, music: MusicService, playlists: PlaylistService, voice?: VoiceService): void {
  void routeCommand(interaction, database, env, focus, music, playlists, voice);
}
