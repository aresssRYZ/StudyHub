import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { ConfigurationError } from '../shared/errors.js';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/),
  STUDY_CHANNEL_ID: z.string().regex(/^\d{17,20}$/),
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1),
  AI_SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(20),
  AI_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(40).refine((value) => value % 2 === 0).default(20),
  DATABASE_PATH: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test'])
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new ConfigurationError(`Invalid environment variables: ${fields.join(', ')}`);
  }

  return result.data;
}
