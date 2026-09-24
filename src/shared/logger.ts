import pino from 'pino';

const redaction = {
  paths: ['token', 'password', 'secret', 'apiKey', '*.token', '*.password', '*.secret', '*.apiKey'],
  censor: '[REDACTED]'
};

export let logger = pino({ redact: redaction });

export function configureLogger(nodeEnv: string): void {
  logger = pino({
    level: nodeEnv === 'production' ? 'info' : 'debug',
    redact: redaction,
    transport: nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: process.stdout.isTTY ?? false, translateTime: 'SYS:standard' } }
      : undefined
  });
}
