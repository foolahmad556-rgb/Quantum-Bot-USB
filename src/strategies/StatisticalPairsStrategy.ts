/**
 * StatisticalPairsStrategy.ts
 * Cointegration-style statistical pairs trading.
 *
 * - findPairs(): Pearson correlation between all symbol pairs over the last
 *   100 candles; pairs above the correlation threshold are candidates
 * - evaluate(): spread = log(priceA) - beta * log(priceB), beta from an OLS
 *   regression over the last 50 candles; z-score = (spread - mean) / std
 * - Entry: z > 2 -> short A / long B; z < -2 -> long A / short B; else hold
 * - Each leg is sized at 5% of the portfolio; stop-loss sits 2 std beyond the
 *   entry spread and take-profit at the spread mean (mean reversion target)
 */

import { Candle } from '../domain/types';

export interface Pair {
  symbolA: string;
  symbolB: string;
  correlation: number;
}

export type PairSignalSide = 'SHORT_SPREAD' | 'LONG_SPREAD';

export interface Signal {
  side: PairSignalSide;
  pair: { symbolA: string; symbolB: string };
  symbolA: string;
  symbolB: string;
  legASide: 'BUY' | 'SELL';
  legBSide: 'BUY' | 'SELL';
  sizePct: number; // percent of portfolio per leg
  stopLoss: number; // spread level
  takeProfit: number; // spread level
  zScore: number;
  beta: number;
  spread: number;
  spreadMean: number;
  spreadStd: number;
  correlation: number;
  timestamp: number;
  strategy: string;
  reason: string;
}

const CORRELATION_LOOKBACK = 100;
const SPREAD_LOOKBACK = 50;
const ENTRY_ZSCORE = 2;
const STOP_ZSCORE = 4; // 2 std beyond the entry threshold
const LEG_SIZE_PCT = 5;
const MIN_CANDLES = 3;

export class StatisticalPairsStrategy {
  private candlesMap: Map<string, Candle[]> = new Map();

  constructor(_correlationRiskManager?: unknown) {}

  /**
   * Finds candidate pairs via Pearson correlation over the last 100 candles.
   * The candle map is cached so evaluate() can model spreads afterwards.
   */
  public findPairs(
    candlesMap: Map<string, Candle[]> | Record<string, Candle[]>,
    minCorrelation: number
  ): Pair[] {
    const map = candlesMap instanceof Map ? candlesMap : new Map(Object.entries(candlesMap));
    this.candlesMap = map;

    const symbols = Array.from(map.keys());
    const pairs: Pair[] = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symbolA = symbols[i];
        const symbolB = symbols[j];
        const closesA = lastCloses(map.get(symbolA) || [], CORRELATION_LOOKBACK);
        const closesB = lastCloses(map.get(symbolB) || [], CORRELATION_LOOKBACK);
        const correlation = pearson(closesA, closesB);
        if (correlation === null || !Number.isFinite(correlation)) continue;
        if (correlation > minCorrelation) {
          pairs.push({ symbolA, symbolB, correlation: Number(correlation.toFixed(4)) });
        }
      }
    }

    return pairs;
  }

  /**
   * Evaluates all candidate pairs and returns the strongest mean-reversion
   * signal (largest |z-score| beyond the entry threshold), or null when no
   * pair is tradeable.
   */
  public evaluate(pairs: Pair[], currentPrices: Record<string, number>): Signal | null {
    let best: Signal | null = null;
    for (const pair of pairs) {
      const signal = this.evaluatePair(pair, currentPrices);
      if (signal && (!best || Math.abs(signal.zScore) > Math.abs(best.zScore))) {
        best = signal;
      }
    }
    return best;
  }

  private evaluatePair(pair: Pair, currentPrices: Record<string, number>): Signal | null {
    const candlesA = lastCandles(this.candlesMap.get(pair.symbolA) || [], SPREAD_LOOKBACK);
    const candlesB = lastCandles(this.candlesMap.get(pair.symbolB) || [], SPREAD_LOOKBACK);
    if (candlesA.length < MIN_CANDLES || candlesB.length < MIN_CANDLES) return null;

    const priceA = currentPrices[pair.symbolA];
    const priceB = currentPrices[pair.symbolB];
    if (!Number.isFinite(priceA) || priceA <= 0) return null;
    if (!Number.isFinite(priceB) || priceB <= 0) return null;

    const logA = candlesA.map((c) => Math.log(c.close));
    const logB = candlesB.map((c) => Math.log(c.close));
    if (logA.some((v) => !Number.isFinite(v)) || logB.some((v) => !Number.isFinite(v))) return null;

    const n = Math.min(logA.length, logB.length);
    const a = logA.slice(-n);
    const b = logB.slice(-n);

    const beta = olsBeta(a, b);
    const spread = a.map((la, i) => la - beta * b[i]);
    const mean = spread.reduce((sum, v) => sum + v, 0) / n;
    const variance = spread.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(n - 1, 1);
    const std = Math.sqrt(variance);
    if (std <= 1e-12) return null;

    const currentSpread = Math.log(priceA) - beta * Math.log(priceB);
    const zScore = (currentSpread - mean) / std;

    if (zScore > ENTRY_ZSCORE) {
      // Spread is high: A is overvalued relative to B -> short A, long B
      return this.buildSignal('SHORT_SPREAD', pair, {
        beta,
        spread: currentSpread,
        mean,
        std,
        zScore,
      });
    }
    if (zScore < -ENTRY_ZSCORE) {
      // Spread is low: A is undervalued relative to B -> long A, short B
      return this.buildSignal('LONG_SPREAD', pair, {
        beta,
        spread: currentSpread,
        mean,
        std,
        zScore,
      });
    }
    return null;
  }

  private buildSignal(
    side: PairSignalSide,
    pair: Pair,
    stats: { beta: number; spread: number; mean: number; std: number; zScore: number }
  ): Signal {
    const shortSpread = side === 'SHORT_SPREAD';
    const stopDistance = (STOP_ZSCORE - ENTRY_ZSCORE) * stats.std;
    const stopLoss = shortSpread ? stats.spread + stopDistance : stats.spread - stopDistance;

    return {
      side,
      pair: { symbolA: pair.symbolA, symbolB: pair.symbolB },
      symbolA: pair.symbolA,
      symbolB: pair.symbolB,
      legASide: shortSpread ? 'SELL' : 'BUY',
      legBSide: shortSpread ? 'BUY' : 'SELL',
      sizePct: LEG_SIZE_PCT,
      stopLoss: Number(stopLoss.toFixed(6)),
      takeProfit: Number(stats.mean.toFixed(6)),
      zScore: Number(stats.zScore.toFixed(3)),
      beta: Number(stats.beta.toFixed(4)),
      spread: Number(stats.spread.toFixed(6)),
      spreadMean: Number(stats.mean.toFixed(6)),
      spreadStd: Number(stats.std.toFixed(6)),
      correlation: pair.correlation,
      timestamp: Date.now(),
      strategy: 'statistical-pairs',
      reason: `Spread z-score ${stats.zScore.toFixed(2)} breached entry threshold ±${ENTRY_ZSCORE}`,
    };
  }
}

function lastCandles(candles: Candle[], count: number): Candle[] {
  return candles.slice(-count);
}

function lastCloses(candles: Candle[], count: number): number[] {
  return candles.slice(-count).map((c) => c.close);
}

/** Pearson correlation coefficient, or null when undefined (n < 2 / zero variance). */
function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const meanX = x.reduce((sum, v) => sum + v, 0) / n;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator > 1e-12 ? covariance / denominator : null;
}

/** OLS slope of y on x: beta = cov(x, y) / var(x). */
function olsBeta(y: number[], x: number[]): number {
  const n = Math.min(y.length, x.length);
  if (n < 2) return 1;
  const meanX = x.reduce((sum, v) => sum + v, 0) / n;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < n; i++) {
    covariance += (x[i] - meanX) * (y[i] - meanY);
    varianceX += Math.pow(x[i] - meanX, 2);
  }

  return varianceX > 1e-12 ? covariance / varianceX : 1;
}
