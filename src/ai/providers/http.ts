export type ProviderFailure = 'auth' | 'rate_limit' | 'timeout' | 'server' | 'network' | 'invalid_request';

export class ProviderError extends Error {
  override name = 'ProviderError';

  constructor(
    readonly provider: 'groq' | 'gemini',
    readonly failure: ProviderFailure,
    readonly status?: number
  ) {
    super(`${provider} request failed: ${failure}${status === undefined ? '' : ` (HTTP ${status})`}`);
  }
}

export async function postJson(
  provider: 'groq' | 'gemini',
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    throw new ProviderError(provider, error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
  }

  if (!response.ok) {
    let invalidKey = false;
    if (provider === 'gemini' && response.status === 400) {
      try {
        const details: unknown = await response.json();
        invalidKey = JSON.stringify(details).includes('API_KEY_INVALID');
      } catch {
        // The HTTP status is still enough to classify the failure.
      }
    }
    const failure: ProviderFailure = response.status === 401 || response.status === 403 || invalidKey
      ? 'auth'
      : response.status === 429
        ? 'rate_limit'
        : response.status === 408 || response.status === 504
          ? 'timeout'
          : response.status >= 500
            ? 'server'
            : 'invalid_request';
    throw new ProviderError(provider, failure, response.status);
  }

  try {
    return await response.json() as unknown;
  } catch {
    throw new ProviderError(provider, 'server', response.status);
  }
}
