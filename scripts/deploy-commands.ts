import { registerCommands } from '../src/app/register-commands.js';
import { loadEnv } from '../src/config/env.js';
import { errorDetails } from '../src/shared/errors.js';
import { configureLogger, logger } from '../src/shared/logger.js';

try {
  const env = loadEnv();
  configureLogger(env.NODE_ENV);
  logger.info('Environment loaded');
  await registerCommands(env);
} catch (error) {
  logger.error(errorDetails(error), 'Command registration failed');
  process.exitCode = 1;
}
