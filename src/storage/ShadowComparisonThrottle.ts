export class ShadowComparisonThrottle {
  private readonly lastPersistedAt = new Map<string, number>();

  constructor(private readonly intervalMs: number) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Shadow comparison persistence interval must be positive');
    }
  }

  shouldPersist(symbol: string, now: number): boolean {
    const key = symbol.trim().toUpperCase();
    if (!key || !Number.isFinite(now)) return false;

    const lastPersisted = this.lastPersistedAt.get(key);
    if (lastPersisted !== undefined && now - lastPersisted < this.intervalMs) {
      return false;
    }

    this.lastPersistedAt.set(key, now);
    return true;
  }
}
