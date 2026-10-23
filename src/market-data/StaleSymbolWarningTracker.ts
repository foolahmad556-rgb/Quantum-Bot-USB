export type StaleWarningAction = 'warn' | 'recovered' | 'none';

type StaleState = {
  lastWarnAt: number;
};

/** Emits one warning on transition to stale, then at most once per cooldown. */
export class StaleSymbolWarningTracker {
  private readonly states = new Map<string, StaleState>();

  constructor(private readonly cooldownMs = 5 * 60 * 1000) {}

  public observe(symbol: string, fresh: boolean, now = Date.now()): StaleWarningAction {
    const state = this.states.get(symbol);
    if (fresh) {
      if (!state) return 'none';
      this.states.delete(symbol);
      return 'recovered';
    }

    if (!state || now - state.lastWarnAt >= this.cooldownMs) {
      this.states.set(symbol, { lastWarnAt: now });
      return 'warn';
    }
    return 'none';
  }

  public forgetExcept(symbols: Iterable<string>): void {
    const active = new Set(symbols);
    for (const symbol of this.states.keys()) {
      if (!active.has(symbol)) this.states.delete(symbol);
    }
  }
}
