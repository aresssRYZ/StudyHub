export class ConfigurationError extends Error {
  override name = 'ConfigurationError';
}

export class DatabaseError extends Error {
  override name = 'DatabaseError';
}

export class DiscordError extends Error {
  override name = 'DiscordError';
}

export function errorDetails(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    return { type: error.name, message: error.message };
  }

  return { type: 'UnknownApplicationError', message: 'An unknown error occurred' };
}
