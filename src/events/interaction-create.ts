import type { Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { routeCommand } from '../app/command-router.js';
import type { FocusService } from '../focus/service.js';
import type { MusicService } from '../music/service.js';

export function onInteractionCreate(interaction: Interaction, database: StudyHubDatabase, env: Env, focus: FocusService, music: MusicService): void {
  void routeCommand(interaction, database, env, focus, music);
}
