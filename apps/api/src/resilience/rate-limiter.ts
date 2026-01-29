/**
 * Token Bucket Rate Limiter
 *
 * Controls request rate to external sources using the token bucket algorithm.
 * Allows for bursting while maintaining an average rate limit.
 */
export interface RateLimiterConfig {
  /** Maximum tokens (burst capacity) */
  bucketSize: number;
  /** Tokens added per second */
  refillRate: number;
  /** Initial tokens (defaults to bucketSize) */
  initialTokens?: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  bucketSize: 10,
  refillRate: 2, // 2 requests per second = 120 per minute
};

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly config: RateLimiterConfig;
  private readonly name: string;

  constructor(name: string, config: Partial<RateLimiterConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokens = this.config.initialTokens ?? this.config.bucketSize;
    this.lastRefill = Date.now();
  }

  /**
   * Try to acquire a token for making a request
   * @returns true if token acquired, false if rate limited
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Acquire a token, waiting if necessary
   * @returns Promise that resolves when token is acquired
   */
  async acquire(): Promise<void> {
    while (!this.tryAcquire()) {
      const waitTime = this.getWaitTime();
      await sleep(waitTime);
    }
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }

  /**
   * Get time until next token is available (ms)
   */
  getWaitTime(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // Calculate time until we get at least 1 token
    const tokensNeeded = 1 - this.tokens;
    const secondsNeeded = tokensNeeded / this.config.refillRate;
    return Math.ceil(secondsNeeded * 1000);
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Check if requests are currently allowed
   */
  isAllowed(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.config.refillRate;

    this.tokens = Math.min(this.config.bucketSize, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Reset the limiter to full capacity
   */
  reset(): void {
    this.tokens = this.config.bucketSize;
    this.lastRefill = Date.now();
  }

  /**
   * Drain all tokens (for testing)
   */
  drain(): void {
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Registry of rate limiters by source
 */
const rateLimiters = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for a source
 */
export function getRateLimiter(
  sourceId: string,
  config?: Partial<RateLimiterConfig>,
): RateLimiter {
  let limiter = rateLimiters.get(sourceId);
  if (!limiter) {
    limiter = new RateLimiter(sourceId, config);
    rateLimiters.set(sourceId, limiter);
  }
  return limiter;
}

/**
 * Create rate limiter config from requests per minute
 */
export function fromRequestsPerMinute(
  requestsPerMinute: number,
  burstSize?: number,
): RateLimiterConfig {
  const refillRate = requestsPerMinute / 60;
  return {
    bucketSize: burstSize ?? Math.ceil(refillRate * 10), // 10 second burst
    refillRate,
  };
}

/**
 * Get all rate limiter states (for monitoring)
 */
export function getRateLimiterStates(): Record<string, { tokens: number; waitTime: number }> {
  const states: Record<string, { tokens: number; waitTime: number }> = {};
  for (const [id, limiter] of rateLimiters) {
    states[id] = {
      tokens: limiter.getTokens(),
      waitTime: limiter.getWaitTime(),
    };
  }
  return states;
}

/**
 * Global concurrency limiter using semaphore pattern
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly maxConcurrent: number;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    // Wait in queue
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.active--;

    // Let next in queue proceed
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  getActive(): number {
    return this.active;
  }

  getWaiting(): number {
    return this.queue.length;
  }
}

// Global concurrency limiter for all sources
export const globalConcurrencyLimiter = new ConcurrencyLimiter(10);
