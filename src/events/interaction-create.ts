import type { Interaction } from 'discord.js';
import type { Env } from '../config/env.js';
import type { StudyHubDatabase } from '../database/database.js';
import { routeCommand } from '../app/command-router.js';

export function onInteractionCreate(interaction: Interaction, database: StudyHubDatabase, env: Env): void {
  void routeCommand(interaction, database, env);
}
