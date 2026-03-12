import { childLogger } from './logger.js';

const log = childLogger('rate-limiter');

export class AdaptiveRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private currentRate: number;
  private queue: Array<{ resolve: () => void }> = [];
  private draining = false;

  constructor(
    private readonly name: string,
    private readonly minRate: number,
    private readonly maxRate: number,
    private startRate?: number,
  ) {
    this.currentRate = startRate ?? minRate;
    this.tokens = this.currentRate;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.currentRate, this.tokens + elapsed * this.currentRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      this.scheduleDrain();
    });
  }

  private scheduleDrain() {
    if (this.draining) return;
    this.draining = true;
    const waitMs = Math.ceil(1000 / this.currentRate);
    setTimeout(() => {
      this.draining = false;
      this.refill();
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()!.resolve();
      }
      if (this.queue.length > 0) this.scheduleDrain();
    }, waitMs);
  }

  onSuccess() {
    if (this.currentRate < this.maxRate) {
      this.currentRate = Math.min(this.maxRate, this.currentRate * 1.1);
    }
  }

  onError(statusCode?: number) {
    if (statusCode === 429 || statusCode === 503) {
      this.currentRate = Math.max(this.minRate, this.currentRate * 0.5);
      log.warn({ name: this.name, newRate: this.currentRate.toFixed(2) }, 'Rate limit hit, backing off');
    }
  }

  get rate() {
    return this.currentRate;
  }
}
