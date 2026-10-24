export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
  /** Upper bound on tracked keys so a flood of distinct keys can't grow memory forever. */
  maxKeys?: number;
}

/** In-memory sliding-window limiter that counts *failures* per key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(opts: RateLimiterOptions) {
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Whether another attempt is allowed right now, and if not, how long until it is. */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const list = this.recent(key);
    if (list.length < this.max) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: Math.max(0, list[0] + this.windowMs - this.now()) };
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
