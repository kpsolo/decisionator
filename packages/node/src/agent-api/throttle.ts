/**
 * Throttles clients that keep presenting invalid bearer tokens (agentic API 1.4.0). After
 * `maxFailures` failed attempts within `windowMs`, the client is refused with 429 until the
 * window ends. Grant and owner tokens carry 256 bits, so this is defence in depth against token
 * guessing and log flooding, not the primary protection.
 */
export interface AuthFailureThrottleOptions {
  /** Failed attempts allowed per window. Default 20. */
  maxFailures?: number;
  /** Window length. Default 1 minute. */
  windowMs?: number;
  /** Most clients tracked at once; the oldest are dropped first. Default 10 000. */
  maxClients?: number;
  /** Clock, for tests. */
  now?: () => number;
}

interface FailureWindow {
  start: number;
  failures: number;
}

export class AuthFailureThrottle {
  private readonly clients = new Map<string, FailureWindow>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly maxClients: number;
  private readonly now: () => number;

  constructor(options: AuthFailureThrottleOptions = {}) {
    this.maxFailures = options.maxFailures ?? 20;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxClients = options.maxClients ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Whether `client` used up its failed attempts for the current window. */
  isBlocked(client: string): boolean {
    const entry = this.current(client);
    return entry !== undefined && entry.failures >= this.maxFailures;
  }

  /** Records one failed authentication of `client`. */
  recordFailure(client: string): void {
    const entry = this.current(client);
    if (entry) {
      entry.failures += 1;
      return;
    }
    this.sweep();
    while (this.clients.size >= this.maxClients) {
      const oldest = this.clients.keys().next().value;
      if (oldest === undefined) break;
      this.clients.delete(oldest);
    }
    this.clients.set(client, { start: this.now(), failures: 1 });
  }

  /** Seconds until `client` may try again (at least 1). */
  retryAfterSeconds(client: string): number {
    const entry = this.clients.get(client);
    if (!entry) return 1;
    return Math.max(1, Math.ceil((entry.start + this.windowMs - this.now()) / 1000));
  }

  private current(client: string): FailureWindow | undefined {
    const entry = this.clients.get(client);
    if (entry && this.now() - entry.start >= this.windowMs) {
      this.clients.delete(client);
      return undefined;
    }
    return entry;
  }

  /** Drops windows that ended. */
  private sweep(): void {
    const now = this.now();
    for (const [client, entry] of this.clients) {
      if (now - entry.start >= this.windowMs) this.clients.delete(client);
    }
  }
}
