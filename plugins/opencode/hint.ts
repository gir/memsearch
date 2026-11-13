/** Cached skill-candidate hint: refreshed in the background, never awaited on a model call. */
export class HintCache {
  private value = "";
  private fetchedAt = -1;
  private inflight = false;
  private readonly load: () => Promise<string>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(load: () => Promise<string>, ttlMs = 600_000, now: () => number = Date.now) {
    this.load = load; this.ttlMs = ttlMs; this.now = now;
  }

  /** Returns the last known hint immediately and refreshes it in the background once stale. */
  get(): string {
    if (!this.inflight && (this.fetchedAt < 0 || this.now() - this.fetchedAt >= this.ttlMs)) {
      this.inflight = true;
      this.fetchedAt = this.now();
      void this.load().then(value => { this.value = value; }, () => {}).finally(() => { this.inflight = false; });
    }
    return this.value;
  }
}
