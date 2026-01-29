/**
 * Circuit Breaker States
 */
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing, reject all requests
  HALF_OPEN = 'half_open', // Testing if service recovered
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time to wait before testing recovery (ms) */
  resetTimeout: number;
  /** Number of successful calls to close circuit from half-open */
  successThreshold: number;
  /** Window for counting failures (ms) */
  failureWindow: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  successThreshold: 2,
  failureWindow: 60000, // 1 minute
};

/**
 * Circuit Breaker
 *
 * Prevents cascading failures by stopping requests to failing services.
 * Opens circuit after consecutive failures, then periodically tests recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      // Check if it's time to test recovery
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitOpenError(this.name, this.getTimeUntilRetry());
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Clear old failures outside the window
      this.pruneFailures();
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open goes back to open
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    // Add failure to window
    this.failures.push(now);
    this.pruneFailures();

    // Check if we should open circuit
    if (this.failures.length >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Remove failures outside the failure window
   */
  private pruneFailures(): void {
    const cutoff = Date.now() - this.config.failureWindow;
    this.failures = this.failures.filter(time => time > cutoff);
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    switch (newState) {
      case CircuitState.CLOSED:
        this.failures = [];
        this.successCount = 0;
        console.log(`[CircuitBreaker:${this.name}] ${oldState} -> CLOSED (recovered)`);
        break;

      case CircuitState.OPEN:
        this.successCount = 0;
        console.log(`[CircuitBreaker:${this.name}] ${oldState} -> OPEN (failures: ${this.failures.length})`);
        break;

      case CircuitState.HALF_OPEN:
        this.successCount = 0;
        console.log(`[CircuitBreaker:${this.name}] ${oldState} -> HALF_OPEN (testing recovery)`);
        break;
    }
  }

  /**
   * Get time until retry is allowed (ms)
   */
  private getTimeUntilRetry(): number {
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.resetTimeout - elapsed);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count in current window
   */
  getFailureCount(): number {
    this.pruneFailures();
    return this.failures.length;
  }

  /**
   * Check if circuit allows requests
   */
  isAllowed(): boolean {
    if (this.state === CircuitState.CLOSED) return true;
    if (this.state === CircuitState.OPEN) {
      return Date.now() - this.lastFailureTime >= this.config.resetTimeout;
    }
    return true; // HALF_OPEN allows testing requests
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Manually trip the circuit breaker (for testing)
   */
  trip(): void {
    this.lastFailureTime = Date.now();
    this.transitionTo(CircuitState.OPEN);
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;
  readonly circuitName: string;

  constructor(name: string, retryAfterMs: number) {
    super(`Circuit breaker '${name}' is open. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Registry of circuit breakers by source
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a source
 */
export function getCircuitBreaker(
  sourceId: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  let breaker = circuitBreakers.get(sourceId);
  if (!breaker) {
    breaker = new CircuitBreaker(sourceId, config);
    circuitBreakers.set(sourceId, breaker);
  }
  return breaker;
}

/**
 * Get all circuit breaker states (for monitoring)
 */
export function getCircuitBreakerStates(): Record<string, { state: CircuitState; failures: number }> {
  const states: Record<string, { state: CircuitState; failures: number }> = {};
  for (const [id, breaker] of circuitBreakers) {
    states[id] = {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    };
  }
  return states;
}
