import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { openDatabase, type StudyHubDatabase } from '../database/database.js';
import { migrate } from '../database/migrate.js';
import { onReady } from '../events/ready.js';
import { onInteractionCreate } from '../events/interaction-create.js';
import { onMessageCreate } from '../events/message-create.js';
import { ConversationRepository } from '../conversation/repository.js';
import { ConversationService } from '../conversation/conversation-service.js';
import { AiService } from '../ai/ai-service.js';
import { GroqProvider } from '../ai/providers/groq.js';
import { GeminiProvider } from '../ai/providers/gemini.js';
import { DiscordError, errorDetails } from '../shared/errors.js';
import { configureLogger, logger } from '../shared/logger.js';

export async function startBot(): Promise<void> {
  let database: StudyHubDatabase | undefined;
  let client: Client | undefined;
  let shuttingDown = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    logger.info('Shutting down StudyHub');
    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        logger.error(errorDetails(error), 'Discord client shutdown failed');
        process.exitCode = 1;
      }
    }
    if (database?.open) {
      try {
        database.close();
        logger.info('Database closed');
      } catch (error) {
        logger.error(errorDetails(error), 'Database close failed');
        process.exitCode = 1;
      }
    }
  };

  process.once('SIGINT', () => { void shutdown(0); });
  process.once('SIGTERM', () => { void shutdown(0); });
  process.once('uncaughtException', (error) => {
    logger.error(errorDetails(error), 'Uncaught exception');
    void shutdown(1);
  });
  process.once('unhandledRejection', (reason) => {
    logger.error(errorDetails(reason), 'Unhandled rejection');
    void shutdown(1);
  });

  try {
    logger.info('StudyHub starting');
    const env = loadEnv();
    configureLogger(env.NODE_ENV);
    logger.info('Environment loaded');

    database = openDatabase(env.DATABASE_PATH);
    const activeDatabase = database;
    logger.info('Database connected');
    migrate(activeDatabase);

    const conversations = new ConversationService(
      new ConversationRepository(activeDatabase, env.AI_MAX_CONTEXT_MESSAGES),
      new AiService(
        new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL),
        new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
      ),
      env
    );

    client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
    const activeClient = client;
    client.once(Events.ClientReady, (readyClient) => onReady(readyClient));
    client.on(Events.InteractionCreate, (interaction) => onInteractionCreate(interaction, activeDatabase, env));
    client.on(Events.MessageCreate, (message) => onMessageCreate(message, conversations));
    client.on(Events.Error, (error) => logger.error(errorDetails(error), 'Discord client error'));
    client.on(Events.Warn, (message) => logger.warn({ message }, 'Discord client warning'));

    logger.info('Discord login started');
    try {
      await activeClient.login(env.DISCORD_TOKEN);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/disallowed intents/i.test(message)) {
        throw new DiscordError('Discord login failed: enable Message Content Intent in Developer Portal > Bot > Privileged Gateway Intents.');
      }
      throw new DiscordError('Discord login failed. Check DISCORD_TOKEN and network access.');
    }
  } catch (error) {
    logger.error(errorDetails(error), 'StudyHub startup failed');
    await shutdown(1);
  }
}
