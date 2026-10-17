/**
 * SignalScoringEngine.ts
 * Score-based multi-indicator consensus for signal quality improvement
 * Target: Confidence 35% → 60%+, Win Rate 62% → 70%+
 */

import { TradingSignal, SignalType } from '../domain/types';
import { CalculatedFeatures } from '../features/FeatureEngine';

export interface IndicatorScore {
  name: string;
  score: number; // 0-25 points
  weight: number; // 0-1
  reason: string;
}

export interface SignalConsensus {
  totalScore: number; // 0-100
  confidence: number; // 0-1
  signals: IndicatorScore[];
  shouldTrade: boolean;
  marketRegime: 'STRONG_TREND' | 'SIDEWAYS' | 'VOLATILE';
}

export class SignalScoringEngine {
  private readonly RSI_MIN = 30;
  private readonly RSI_MAX = 70;
  private readonly MIN_CONSENSUS_TRENDING = 0.55; // 55%+ in trending markets
  private readonly MIN_CONSENSUS_SIDEWAYS = 0.70; // 70%+ in sideways
  private readonly MIN_CONSENSUS_VOLATILE = 0.60; // 60%+ in volatile

  /**
   * Calculate RSI component score (0-25 points)
   * Strong overbought/oversold = higher confidence
   */
  private scoreRSI(rsi: number, side: 'BUY' | 'SELL'): IndicatorScore {
    let score = 0;
    let reason = '';

    if (side === 'BUY') {
      // For longs, want RSI bouncing from oversold
      if (rsi < 15) {
        score = 25; // Extreme oversold panic
        reason = `Extreme Oversold (RSI=${rsi.toFixed(0)})`;
      } else if (rsi < 25) {
        score = 23; // Very strong oversold
        reason = `Extreme Oversold (RSI=${rsi.toFixed(0)})`;
      } else if (rsi < 30) {
        score = 22; // Strong oversold, high reversal probability
        reason = `Extreme Oversold (RSI=${rsi.toFixed(0)})`;
      } else if (rsi < 40) {
        score = 18;
        reason = `Oversold Zone (RSI=${rsi.toFixed(0)})`;
      } else if (rsi < 50) {
        score = 12;
        reason = `Weak (RSI=${rsi.toFixed(0)})`;
      }
    } else {
      // For shorts, want RSI falling from overbought
      if (rsi > 85) {
        score = 25; // Extreme overbought panic
        reason = `Extreme Overbought (RSI=${rsi.toFixed(0)})`;
      } else if (rsi > 75) {
        score = 23; // Very strong overbought
        reason = `Extreme Overbought (RSI=${rsi.toFixed(0)})`;
      } else if (rsi > 70) {
        score = 22;
        reason = `Extreme Overbought (RSI=${rsi.toFixed(0)})`;
      } else if (rsi > 60) {
        score = 18;
        reason = `Overbought Zone (RSI=${rsi.toFixed(0)})`;
      } else if (rsi > 50) {
        score = 12;
        reason = `Weak (RSI=${rsi.toFixed(0)})`;
      }
    }

    return { name: 'RSI14', score, weight: 0.25, reason };
  }

  /**
   * Calculate trend component score (0-25 points)
   * Multi-timeframe alignment = higher confidence
   */
  private scoreTrend(
    zScore: number,
    hurstExponent: number,
    isStationary: boolean,
    side: 'BUY' | 'SELL'
  ): IndicatorScore {
    let score = 0;
    let reason = '';

    // Z-score indicates mean-reversion strength
    const zAbs = Math.abs(zScore);
    // Scale: 0σ=0pts, 1σ=8pts, 2σ=16pts, 3σ=24pts (capped at 25)
    const zStrength = Math.min(25, zAbs * 8);

    // Hurst exponent: > 0.5 = trending, < 0.5 = mean-reverting
    let hurstBoost = 0;
    if (hurstExponent > 0.6) {
      hurstBoost = 8; // Strong trend
      reason += `Hurst=${hurstExponent.toFixed(2)} (strong trend) `;
    } else if (hurstExponent > 0.55) {
      hurstBoost = 5;
      reason += `Hurst=${hurstExponent.toFixed(2)} (weak trend) `;
    } else if (hurstExponent < 0.45) {
      hurstBoost = 10; // Mean reverting = good for reversion trades
      reason += `Hurst=${hurstExponent.toFixed(2)} (mean-reverting) `;
    } else {
      hurstBoost = 3;
      reason += `Hurst=${hurstExponent.toFixed(2)} (neutral) `;
    }

    // Stationarity check: mean-reverting pairs safer & higher reward
    if (isStationary) {
      score = Math.min(25, zStrength + hurstBoost + 8); // +8 stationarity bonus
      reason += `| Stationary (ADF passed)`;
    } else {
      score = Math.min(25, zStrength + hurstBoost);
      reason += `| Non-stationary`;
    }

    if (score === 0) reason = `Z-Score=${zScore.toFixed(2)}, No clear signal`;

    return { name: 'Trend', score, weight: 0.25, reason };
  }

  /**
   * Calculate volume component score (0-25 points)
   * Volume surge on breakout = higher conviction
   */
  private scoreVolume(
    currentPrice: number,
    bbUpper: number,
    bbLower: number,
    // Volume ratio passed from caller
    volumeRatio: number,
    side: 'BUY' | 'SELL'
  ): IndicatorScore {
    let score = 0;
    let reason = '';

    // Price at Bollinger Band edges = higher conviction
    const bbWidth = bbUpper - bbLower;
    const priceInBB = (currentPrice - bbLower) / bbWidth; // 0-1

    if (side === 'BUY' && priceInBB < 0.2) {
      score += 8; // Price near lower band
      reason += `At lower BB `;
    } else if (side === 'SELL' && priceInBB > 0.8) {
      score += 8; // Price near upper band
      reason += `At upper BB `;
    }

    // Volume surge (relative to 20-period average)
    if (volumeRatio > 2.0) {
      score += 15; // 2x+ volume
      reason += `Heavy Volume (${volumeRatio.toFixed(1)}x)`;
    } else if (volumeRatio > 1.5) {
      score += 10;
      reason += `Above Avg Vol (${volumeRatio.toFixed(1)}x)`;
    } else if (volumeRatio > 1.0) {
      score += 5;
      reason += `Normal Vol (${volumeRatio.toFixed(1)}x)`;
    } else {
      score += 0;
      reason = `Low Vol (${volumeRatio.toFixed(1)}x) - weak`;
    }

    return { name: 'Volume', score: Math.min(25, score), weight: 0.25, reason };
  }

  /**
   * Calculate momentum component score (0-25 points)
   * Directional MACD/momentum alignment
   */
  private scoreMomentum(
    priceChange: number, // Last 5-period price change
    volatility: number,
    side: 'BUY' | 'SELL'
  ): IndicatorScore {
    let score = 0;
    let reason = '';

    const absChange = Math.abs(priceChange);
    const volAdjustedMove = absChange / (volatility + 1e-9);

    // Direction alignment
    const directionMatch =
      (side === 'BUY' && priceChange > 0) || (side === 'SELL' && priceChange < 0);

    if (directionMatch) {
      if (volAdjustedMove > 2.0) {
        score = 22; // Large directional move
        reason = `Strong ${side} Momentum`;
      } else if (volAdjustedMove > 1.0) {
        score = 15;
        reason = `Moderate ${side} Momentum`;
      } else if (volAdjustedMove > 0.5) {
        score = 10;
        reason = `Weak ${side} Momentum`;
      }
    } else {
      score = 3; // Opposite direction = weak
      reason = `Counter-directional momentum`;
    }

    return {
      name: 'Momentum',
      score: Math.min(25, score),
      weight: 0.25,
      reason,
    };
  }

  /**
   * Main scoring function: combine all indicators
   */
  public scoreSignal(
    features: CalculatedFeatures,
    side: 'BUY' | 'SELL',
    volumeRatio: number = 1.0,
    priceChange5Period: number = 0,
    marketRegime: 'STRONG_TREND' | 'SIDEWAYS' | 'VOLATILE' = 'STRONG_TREND'
  ): SignalConsensus {
    const scores: IndicatorScore[] = [];

    // 1. RSI score
    const rsiScore = this.scoreRSI(features.rsi14, side);
    scores.push(rsiScore);

    // 2. Trend score (z-score, hurst, stationarity)
    const trendScore = this.scoreTrend(
      features.zScore,
      features.hurstExponent,
      features.isStationary,
      side
    );
    scores.push(trendScore);

    // 3. Volume score
    const volScore = this.scoreVolume(
      features.currentPrice,
      features.bbUpper,
      features.bbLower,
      volumeRatio,
      side
    );
    scores.push(volScore);

    // 4. Momentum score
    const momScore = this.scoreMomentum(
      priceChange5Period,
      features.realizedVolAnn / Math.sqrt(252),
      side
    );
    scores.push(momScore);

    // Simple average: each indicator 0-25, sum 0-100, confidence 0-1
    const rawSum = scores.reduce((sum, s) => sum + s.score, 0);
    const totalScore = rawSum; // 0-100 directly (4 indicators × 0-25)
    const confidence = totalScore / 100; // Convert to 0-1

    // Determine threshold based on market regime
    let threshold = this.MIN_CONSENSUS_TRENDING;
    if (marketRegime === 'SIDEWAYS') threshold = this.MIN_CONSENSUS_SIDEWAYS;
    else if (marketRegime === 'VOLATILE') threshold = this.MIN_CONSENSUS_VOLATILE;

    const shouldTrade = confidence >= threshold;

    return {
      totalScore: Number(totalScore.toFixed(1)),
      confidence: Number(confidence.toFixed(3)),
      signals: scores,
      shouldTrade,
      marketRegime,
    };
  }

  /**
   * Adjust scoring thresholds dynamically based on market conditions
   */
  public getDynamicThreshold(marketRegime: string): number {
    switch (marketRegime) {
      case 'STRONG_TREND':
        return 0.55; // Lower threshold in strong trends - more opportunities
      case 'SIDEWAYS':
        return 0.70; // Higher threshold in choppy - need stronger signals
      case 'VOLATILE':
        return 0.65; // Moderate in high volatility
      default:
        return 0.60;
    }
  }

  /**
   * Generate detailed report for debugging
   */
  public generateReport(consensus: SignalConsensus): string {
    const lines = [
      `📊 Signal Consensus Report`,
      `═══════════════════════════`,
      `Market Regime: ${consensus.marketRegime}`,
      `Total Score: ${consensus.totalScore}/100`,
      `Confidence: ${(consensus.confidence * 100).toFixed(1)}%`,
      `Should Trade: ${consensus.shouldTrade ? '✅ YES' : '❌ NO'}`,
      ``,
      `Indicator Breakdown:`,
    ];

    consensus.signals.forEach((sig) => {
      lines.push(
        `  ${sig.name.padEnd(12)} | Score: ${sig.score}/25 | ${sig.reason}`
      );
    });

    return lines.join('\n');
  }
}
