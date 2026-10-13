/**
 * Basel Quantum Algorithmic Trading System
 * Walk-Forward Optimization & Out-of-Sample Overfitting Validation
 * Uses verified BacktestEngine to run rolling in-sample vs out-of-sample evaluations
 */

import { WalkForwardResult, WalkForwardWindow, AssetSymbol, Candle } from '../domain/types';
import { BacktestEngine } from '../backtest/BacktestEngine';

const ISO_DAY = (ms: number): string => new Date(ms).toISOString();

export class WalkForwardValidator {
  /**
   * @param numWindows number of non-overlapping walk-forward blocks
   * @param providedDataset optional candle series keyed by symbol; when omitted the
   *   deterministic generator is used. Series must share timestamps (index-aligned).
   */
  public static runWalkForwardValidation(
    numWindows: number = 4,
    providedDataset?: Map<string, Candle[]>
  ): WalkForwardResult {
    const windows: WalkForwardWindow[] = [];

    const engine = new BacktestEngine({
      symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'QNT/USDT'] as AssetSymbol[],
      initialCapital: 100000,
      commission: 0.0004,
      slippage: 0.0001,
      maxLeverage: 2,
    });

    const dataset: Map<string, Candle[]> = providedDataset ?? engine.generateDeterministicHighFidelityData();
    const allCandlesCount = Array.from(dataset.values())[0]?.length || 200;
    // Non-overlapping blocks: window i = [IS | OOS] inside block i. OOS never reused as IS.
    const blockSize = Math.floor(allCandlesCount / numWindows);
    const isSize = Math.floor(blockSize * 0.7);
    const refSeries = Array.from(dataset.values())[0] || [];

    let totalISSharpe = 0;
    let totalOOSSharpe = 0;

    for (let i = 0; i < numWindows; i++) {
      const startIdx = i * blockSize;
      const isEndIdx = Math.min(allCandlesCount, startIdx + isSize);
      const oosEndIdx = Math.min(allCandlesCount, startIdx + blockSize);

      // Slice in-sample & out-of-sample datasets
      const isData = new Map<string, any[]>();
      const oosData = new Map<string, any[]>();

      dataset.forEach((candles, sym) => {
        isData.set(sym, candles.slice(startIdx, isEndIdx));
        oosData.set(sym, candles.slice(isEndIdx, oosEndIdx));
      });

      // Run verified BacktestEngine on In-Sample
      const isRes = engine.runSync(isData, {
        entryZ: 1.5,
        maxHurst: 0.55,
      });

      // Run verified BacktestEngine on Out-of-Sample
      const oosRes = engine.runSync(oosData, {
        entryZ: 1.5,
        maxHurst: 0.55,
      });

      // Raw Sharpe values: no floors. Non-finite results fail the window explicitly.
      const isSharpe = Number.isFinite(isRes.sharpeRatio) ? isRes.sharpeRatio : 0;
      const oosSharpe = Number.isFinite(oosRes.sharpeRatio) ? oosRes.sharpeRatio : 0;
      const isReturn = Number(isRes.totalReturnPct.toFixed(1));
      const oosReturn = Number(oosRes.totalReturnPct.toFixed(1));

      // Efficiency undefined when IS Sharpe <= 0: window fails.
      const efficiency = isSharpe > 0 ? Number((oosSharpe / isSharpe).toFixed(2)) : 0;
      const pass = efficiency >= 0.60;

      totalISSharpe += isSharpe;
      totalOOSSharpe += oosSharpe;

      // Labels from candle timestamps (ISO day); ordinal fallback when absent.
      const tsAt = (idx: number): number | undefined => refSeries[idx]?.timestamp;
      const sTs = tsAt(startIdx);
      const isEndTs = tsAt(Math.max(startIdx, isEndIdx - 1));
      const oosStartTs = tsAt(isEndIdx);
      const oosEndTs = tsAt(Math.max(isEndIdx, oosEndIdx - 1));
      const hasTs = [sTs, isEndTs, oosStartTs, oosEndTs].every((t) => typeof t === 'number');

      windows.push({
        windowIndex: i + 1,
        trainStart: hasTs ? ISO_DAY(sTs as number) : `W${i + 1}-IS`,
        trainEnd: hasTs ? ISO_DAY(isEndTs as number) : `W${i + 1}-IS`,
        testStart: hasTs ? ISO_DAY(oosStartTs as number) : `W${i + 1}-OOS`,
        testEnd: hasTs ? ISO_DAY(oosEndTs as number) : `W${i + 1}-OOS`,
        inSampleSharpe: isSharpe,
        outOfSampleSharpe: oosSharpe,
        inSampleReturnPct: isReturn,
        outOfSampleReturnPct: oosReturn,
        efficiencyRatio: efficiency,
        robustnessPass: pass,
      });
    }

    const avgInSampleSharpe = Number((totalISSharpe / numWindows).toFixed(2));
    const avgOutOfSampleSharpe = Number((totalOOSSharpe / numWindows).toFixed(2));
    // Sign-aware: efficiency is meaningful only when in-sample edge is positive.
    // Two negative Sharpes divided to a positive ratio previously certified losing strategies.
    const overallEfficiency =
      avgInSampleSharpe > 0 ? Number((avgOutOfSampleSharpe / avgInSampleSharpe).toFixed(2)) : 0;
    const overfittingScore = Number(Math.max(0, 1 - overallEfficiency).toFixed(2));

    const profitableIS = avgInSampleSharpe > 0;
    const verdict: 'HIGHLY_ROBUST' | 'MODERATE_DECAY' | 'OVERFITTED' =
      !profitableIS
        ? 'OVERFITTED'
        : overallEfficiency >= 0.72
        ? 'HIGHLY_ROBUST'
        : overallEfficiency >= 0.50
        ? 'MODERATE_DECAY'
        : 'OVERFITTED';

    return {
      windows,
      avgInSampleSharpe,
      avgOutOfSampleSharpe,
      overallEfficiency,
      overfittingScore,
      verdict,
    };
  }

  public static runWalkForwardMatrix(numWindows: number = 4): WalkForwardResult {
    return this.runWalkForwardValidation(numWindows);
  }
}
