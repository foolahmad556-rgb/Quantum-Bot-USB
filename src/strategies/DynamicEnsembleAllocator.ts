/**
 * DynamicEnsembleAllocator.ts
 * Rolling 30-day Sharpe tracking with regime-adjusted ensemble weights.
 *
 * - Tracks per-strategy Sharpe in a rolling 30-day window
 *   (Map<string, { sum, count, latestValue }>)
 * - getAllocations() tilts capital toward the strategy family that
 *   historically wins in the detected market regime and always returns
 *   weights that sum to 100%.
 */

export interface SharpeWindow {
  sum: number;
  count: number;
  latestValue: number;
}

export interface StrategyScore {
  sharpe: number;
  winRate: number; // 0..1
}

export type MarketRegime = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'UNKNOWN';

export interface StrategyPerformanceMetrics {
  strategyName: string;
  sharpeRatio: number;
  winRate: number; // 0..1
  profitFactor: number;
  tradeCount: number;
}

export interface TradeSample {
  timestamp: number;
  pnl: number;
  isWin: boolean;
}

const ROLLING_WINDOW_OBSERVATIONS = 30; // ~30 daily Sharpe observations
const REGIME_BOOST = 1.5;

export class DynamicEnsembleAllocator {
  private sharpeWindows: Map<string, SharpeWindow> = new Map();
  private recentSharpeValues: Map<string, number[]> = new Map();
  private tradeHistory: Map<string, TradeSample[]> = new Map();

  /** Adds a Sharpe observation to the strategy's rolling 30-day window. */
  public updateSharpe(strategyName: string, sharpe: number): void {
    if (!strategyName || !Number.isFinite(sharpe)) return;

    const values = this.recentSharpeValues.get(strategyName) || [];
    values.push(sharpe);
    let evicted = 0;
    while (values.length > ROLLING_WINDOW_OBSERVATIONS) {
      evicted += values.shift() as number;
    }
    this.recentSharpeValues.set(strategyName, values);

    const previous = this.sharpeWindows.get(strategyName);
    const sum = (previous ? previous.sum : 0) + sharpe - evicted;
    this.sharpeWindows.set(strategyName, {
      sum,
      count: values.length,
      latestValue: sharpe,
    });
  }

  /** Returns the rolling-window bookkeeping for a strategy. */
  public getSharpeWindow(strategyName: string): SharpeWindow | undefined {
    return this.sharpeWindows.get(strategyName);
  }

  /** Rolling 30-day average Sharpe for a strategy (0 when untracked). */
  public getRollingSharpe(strategyName: string): number {
    const window = this.sharpeWindows.get(strategyName);
    if (!window || window.count === 0) return 0;
    return window.sum / window.count;
  }

  /**
   * Computes regime-adjusted allocations that sum to 100%.
   *
   * Base weight is each strategy's Sharpe share (sharpe / total sharpe).
   * In TRENDING regimes strategies with "trend"/"breakout" in their name get
   * a 1.5x boost; in RANGING regimes "reversion"/"ou" strategies get 1.5x;
   * in VOLATILE regimes "volatility"/"breakout" strategies get 1.5x. Weights
   * are then normalized to 100%.
   *
   * @param regime market regime key (or a RegimeAnalysis-like object)
   * @param strategyMetrics per-strategy scores keyed by strategy name
   * @returns weights in percent, summing to 100
   */
  public getAllocations(
    regime: string | { marketRegime?: string } | undefined,
    strategyMetrics:
      | Record<string, StrategyScore | StrategyPerformanceMetrics>
      | StrategyPerformanceMetrics[]
      | undefined
  ): Record<string, number> {
    const regimeKey = this.normalizeRegime(regime);
    const entries = this.normalizeMetrics(strategyMetrics);
    if (entries.length === 0) return {};

    let weightedSum = 0;
    const rawWeights = new Map<string, number>();

    for (const entry of entries) {
      const sharpe = Math.max(0, entry.score.sharpe);
      const multiplier = this.regimeMultiplier(regimeKey, entry.name);
      const raw = sharpe * multiplier;
      rawWeights.set(entry.name, raw);
      weightedSum += raw;
    }

    const allocations: Record<string, number> = {};
    if (weightedSum <= 0 || !Number.isFinite(weightedSum)) {
      const equal = 100 / entries.length;
      for (const entry of entries) {
        allocations[entry.name] = round2(equal);
      }
      return this.fixRounding(allocations);
    }

    for (const entry of entries) {
      const raw = rawWeights.get(entry.name) || 0;
      allocations[entry.name] = round2((raw / weightedSum) * 100);
    }

    return this.fixRounding(allocations);
  }

  private regimeMultiplier(regime: MarketRegime, strategyName: string): number {
    const name = (strategyName || '').toLowerCase();
    switch (regime) {
      case 'TRENDING':
        return name.includes('trend') || name.includes('breakout') ? REGIME_BOOST : 1;
      case 'RANGING':
        return name.includes('reversion') || name.includes('ou') ? REGIME_BOOST : 1;
      case 'VOLATILE':
        return name.includes('volatility') || name.includes('breakout') ? REGIME_BOOST : 1;
      default:
        return 1;
    }
  }

  private normalizeRegime(regime?: string | { marketRegime?: string }): MarketRegime {
    const raw = typeof regime === 'string' ? regime : regime?.marketRegime || '';
    switch (String(raw).toUpperCase()) {
      case 'TRENDING':
        return 'TRENDING';
      case 'RANGING':
        return 'RANGING';
      case 'VOLATILE':
        return 'VOLATILE';
      default:
        return 'UNKNOWN';
    }
  }

  private normalizeMetrics(
    strategyMetrics?:
      | Record<string, StrategyScore | StrategyPerformanceMetrics>
      | StrategyPerformanceMetrics[]
  ): Array<{ name: string; score: StrategyScore }> {
    if (!strategyMetrics) return [];
    if (Array.isArray(strategyMetrics)) {
      return strategyMetrics
        .filter((m) => !!m && !!m.strategyName)
        .map((m) => ({
          name: m.strategyName,
          score: { sharpe: Number(m.sharpeRatio) || 0, winRate: Number(m.winRate) || 0 },
        }));
    }
    return Object.entries(strategyMetrics)
      .filter(([, m]) => !!m)
      .map(([name, m]) => ({
        name,
        score: {
          sharpe: Number((m as StrategyScore).sharpe ?? (m as StrategyPerformanceMetrics).sharpeRatio) || 0,
          winRate: Number(m.winRate) || 0,
        },
      }));
  }

  // --- Trade-history tracking (used by TradingPipeline) ---

  public recordTrade(strategyName: string, pnl: number, isWin: boolean, timestamp: number = Date.now()): void {
    if (!strategyName) return;
    const history = this.tradeHistory.get(strategyName) || [];
    history.push({ timestamp, pnl, isWin });
    if (history.length > 5000) history.splice(0, history.length - 5000);
    this.tradeHistory.set(strategyName, history);
    this.updateSharpe(strategyName, this.sharpeFromPnl(history));
  }

  public getTrackedStrategies(): string[] {
    return Array.from(this.tradeHistory.keys());
  }

  /** Computes rolling-window Sharpe / win rate / profit factor for one strategy. */
  public computeMetrics(strategyName: string): StrategyPerformanceMetrics | null {
    const history = this.tradeHistory.get(strategyName);
    if (!history || history.length === 0) return null;

    const wins = history.filter((s) => s.isWin);
    const losses = history.filter((s) => !s.isWin);
    const grossProfit = wins.reduce((sum, s) => sum + s.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, s) => sum + s.pnl, 0));

    const winRate = wins.length / history.length;
    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.MAX_SAFE_INTEGER : 0;

    const mean = history.reduce((sum, s) => sum + s.pnl, 0) / history.length;
    const variance =
      history.reduce((sum, s) => sum + Math.pow(s.pnl - mean, 2), 0) / Math.max(history.length - 1, 1);
    const std = Math.sqrt(variance);

    const elapsedMs = Math.max(1, Date.now() - (history[0]?.timestamp || Date.now()));
    const tradesPerYear = (history.length / elapsedMs) * 365 * 24 * 60 * 60 * 1000;
    const sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(Math.min(tradesPerYear, 100000)) : 0;

    return {
      strategyName,
      sharpeRatio: Number(sharpeRatio.toFixed(3)),
      winRate: Number(winRate.toFixed(4)),
      profitFactor: Number(Math.min(profitFactor, 1000).toFixed(3)),
      tradeCount: history.length,
    };
  }

  private sharpeFromPnl(history: TradeSample[]): number {
    const n = history.length;
    if (n < 2) return 0;
    const mean = history.reduce((sum, s) => sum + s.pnl, 0) / n;
    const variance = history.reduce((sum, s) => sum + Math.pow(s.pnl - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? mean / std : 0;
  }

  /** Adjusts the largest weight so the allocations sum to exactly 100. */
  private fixRounding(allocations: Record<string, number>): Record<string, number> {
    const keys = Object.keys(allocations);
    if (keys.length === 0) return allocations;
    const sum = keys.reduce((acc, k) => acc + allocations[k], 0);
    const drift = Number((100 - sum).toFixed(2));
    if (Math.abs(drift) < 1e-9) return allocations;
    let largestKey = keys[0];
    for (const k of keys) {
      if (allocations[k] > allocations[largestKey]) largestKey = k;
    }
    allocations[largestKey] = Number((allocations[largestKey] + drift).toFixed(2));
    return allocations;
  }
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
