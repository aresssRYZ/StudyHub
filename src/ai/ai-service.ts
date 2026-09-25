import type { AiProvider, AiRequest } from './types.js';
import { ProviderError } from './providers/http.js';
import { logger } from '../shared/logger.js';

export class AiService {
  constructor(private readonly primary: AiProvider, private readonly fallback: AiProvider) {}

  async generate(request: AiRequest, conversationId: number): Promise<string> {
    logger.info({ conversationId, provider: this.primary.name }, 'AI request started');
    try {
      const text = await this.primary.generate(request);
      logger.info({ conversationId, provider: this.primary.name }, 'AI provider used');
      return text;
    } catch (error) {
      const details = error instanceof ProviderError
        ? { provider: error.provider, failure: error.failure, status: error.status }
        : { provider: this.primary.name, failure: 'unknown' };
      logger.warn({ conversationId, ...details }, 'AI primary request failed');
      if (!(error instanceof ProviderError) || !['rate_limit', 'timeout', 'server', 'network'].includes(error.failure)) {
        throw error;
      }
    }

    logger.info({ conversationId, provider: this.fallback.name }, 'AI provider fallback');
    try {
      const text = await this.fallback.generate(request);
      logger.info({ conversationId, provider: this.fallback.name }, 'AI provider used');
      return text;
    } catch (error) {
      const details = error instanceof ProviderError
        ? { provider: error.provider, failure: error.failure, status: error.status }
        : { provider: this.fallback.name, failure: 'unknown' };
      logger.error({ conversationId, ...details }, 'AI fallback request failed');
      throw error;
    }
  }
}
