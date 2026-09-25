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
  FOCUS_MIN_DURATION_MINUTES: z.coerce.number().int().min(1).max(180).default(5),
  FOCUS_MAX_DURATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(180),
  APP_TIMEZONE: z.string().refine((value) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
  }).default('Asia/Jakarta'),
  SONATA_HOST: z.string().min(1).default('127.0.0.1'),
  SONATA_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  SONATA_PASSWORD: z.string().min(1),
  SONATA_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MUSIC_DEFAULT_VOLUME: z.coerce.number().int().min(0).max(100).default(50),
  MUSIC_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(180),
  DATABASE_PATH: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test'])
}).refine((value) => value.FOCUS_MIN_DURATION_MINUTES <= value.FOCUS_MAX_DURATION_MINUTES, {
  path: ['FOCUS_MAX_DURATION_MINUTES'], message: 'must be at least FOCUS_MIN_DURATION_MINUTES'
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
