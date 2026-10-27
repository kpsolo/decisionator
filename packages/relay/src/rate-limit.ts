/** Token bucket settings: `capacity` tokens (burst), refilled at `refillPerSecond`. */
export interface TokenBucketConfig {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-memory token-bucket rate limiter keyed by an arbitrary string (client IP, signer key,
 * tunnel id). Single process only, like the relay itself. Bounded: idle (refilled) buckets are
 * dropped first; if every bucket is still draining, the oldest one is dropped.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly config: TokenBucketConfig,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Takes one token for `key`. Returns 0 when allowed, else the seconds to wait. */
  take(key: string): number {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket) {
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(
        this.config.capacity,
        bucket.tokens + elapsed * this.config.refillPerSecond
      );
      bucket.updatedAt = now;
      // Refresh insertion order so eviction drops the least recently used key.
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    } else {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      bucket = { tokens: this.config.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    const perSecond = this.config.refillPerSecond > 0 ? this.config.refillPerSecond : 1;
    return Math.max(1, Math.ceil((1 - bucket.tokens) / perSecond));
  }

  private evict(now: number) {
    for (const [key, bucket] of this.buckets) {
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      if (bucket.tokens + elapsed * this.config.refillPerSecond >= this.config.capacity) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }
}
