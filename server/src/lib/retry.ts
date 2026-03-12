import { childLogger } from './logger.js';

const log = childLogger('retry');

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  label?: string;
}

const defaults: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, label } = { ...defaults, ...opts };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        log.error({ err, label, attempt }, 'All retry attempts exhausted');
        throw err;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      log.warn({ label, attempt, delay, err: (err as Error).message }, 'Retrying after error');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
