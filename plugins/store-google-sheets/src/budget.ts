export interface BudgetConfig {
  maxReadsPerMinute: number;
  maxWritesPerMinute: number;
  maxBackoffSeconds: number;
}

export type BudgetEventType = "pausedUntil";
export type BudgetEventListener = (event: { pausedUntil: number }) => void;

export class QuotaBudget {
  private readsThisWindow: number[] = [];
  private writesThisWindow: number[] = [];
  private backoffAttempts = 0;
  private pausedUntil = 0;
  private listeners: Set<BudgetEventListener> = new Set();

  constructor(
    private config: BudgetConfig = {
      maxReadsPerMinute: 20,
      maxWritesPerMinute: 20,
      maxBackoffSeconds: 64,
    }
  ) {}

  on(event: BudgetEventType, listener: BudgetEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyPaused(pausedUntil: number): void {
    for (const listener of this.listeners) {
      listener({ pausedUntil });
    }
  }

  private pruneOldTimestamps(timestamps: number[], now: number): number[] {
    const oneMinuteAgo = now - 60_000;
    return timestamps.filter((t) => t > oneMinuteAgo);
  }

  isPaused(now = Date.now()): boolean {
    return now < this.pausedUntil;
  }

  getPausedUntil(): number {
    return this.pausedUntil;
  }

  canRead(now = Date.now()): boolean {
    if (this.isPaused(now)) return false;
    this.readsThisWindow = this.pruneOldTimestamps(this.readsThisWindow, now);
    return this.readsThisWindow.length < this.config.maxReadsPerMinute;
  }

  canWrite(now = Date.now()): boolean {
    if (this.isPaused(now)) return false;
    this.writesThisWindow = this.pruneOldTimestamps(this.writesThisWindow, now);
    return this.writesThisWindow.length < this.config.maxWritesPerMinute;
  }

  recordRead(now = Date.now()): void {
    this.readsThisWindow = this.pruneOldTimestamps(this.readsThisWindow, now);
    this.readsThisWindow.push(now);
  }

  recordWrite(now = Date.now()): void {
    this.writesThisWindow = this.pruneOldTimestamps(this.writesThisWindow, now);
    this.writesThisWindow.push(now);
  }

  /**
   * Registers a rate limit event (429 or 403 rateLimitExceeded).
   * Calculates truncated exponential backoff with jitter up to 1 s, capped at 64 s.
   */
  handleRateLimit(now = Date.now(), jitter = Math.random()): number {
    this.backoffAttempts++;
    // Truncated exponential: base 2^(attempts), max 64s + jitter up to 1s
    const baseSeconds = Math.min(this.config.maxBackoffSeconds, 2 ** this.backoffAttempts);
    const totalBackoffSeconds = Math.min(this.config.maxBackoffSeconds, baseSeconds + jitter);
    this.pausedUntil = now + Math.round(totalBackoffSeconds * 1000);
    this.notifyPaused(this.pausedUntil);
    return this.pausedUntil;
  }

  resetBackoff(): void {
    this.backoffAttempts = 0;
    this.pausedUntil = 0;
  }
}
