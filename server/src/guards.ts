// In-memory guards. They reset when the process restarts, so they are for
// friendliness and for stopping a burst, not a hard cost ceiling.
const WINDOW_MS = 60_000;

/** Sliding one-minute window per key. Stale keys are pruned so the map stays small. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep: number;
  constructor(private perMinute: number, private now: () => number = Date.now) {
    if (!Number.isFinite(perMinute) || perMinute <= 0)
      throw new Error(`RateLimiter: the per-minute limit must be a positive finite number, got ${perMinute}`);
    this.lastSweep = this.now();
  }
  allow(key: string): boolean {
    const t = this.now();
    this.sweep(t);
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
    if (recent.length >= this.perMinute) { this.hits.set(key, recent); return false; }
    recent.push(t); this.hits.set(key, recent); return true;
  }
  /** Number of keys currently held (for tests). */
  size(): number { return this.hits.size; }
  // Once a window has passed, drop every key whose hits are all stale.
  private sweep(t: number): void {
    if (t - this.lastSweep < WINDOW_MS) return;
    this.lastSweep = t;
    for (const [k, list] of this.hits) {
      if (!list.some((x) => t - x < WINDOW_MS)) this.hits.delete(k);
    }
  }
}

/** A fixed number of calls per UTC day. A cap of 0 is allowed and takes nothing. */
export class DailyCap {
  private day = ''; private used = 0;
  constructor(private max: number, private now: () => number = Date.now) {
    if (!Number.isFinite(max) || max < 0)
      throw new Error(`DailyCap: the daily cap must be a non-negative finite number, got ${max}`);
  }
  private roll() {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.used = 0; }
  }
  tryTake(): boolean { this.roll(); if (this.used >= this.max) return false; this.used++; return true; }
  remaining(): number { this.roll(); return Math.max(0, this.max - this.used); }
}
