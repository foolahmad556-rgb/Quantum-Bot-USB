/**
 * Basel Quantum Algorithmic Trading System
 * Walk-Forward Optimization & Out-of-Sample Overfitting Validation
 * Uses verified BacktestEngine to run rolling in-sample vs out-of-sample evaluations
 */

import { WalkForwardResult, WalkForwardWindow, AssetSymbol } from '../domain/types';
import { BacktestEngine } from '../backtest/BacktestEngine';

export class WalkForwardValidator {
  public static runWalkForwardValidation(numWindows: number = 4): WalkForwardResult {
    const windows: WalkForwardWindow[] = [];
    const months = [
      { is: 'Jan-Feb', oos: 'Mar' },
      { is: 'Feb-Mar', oos: 'Apr' },
      { is: 'Mar-Apr', oos: 'May' },
      { is: 'Apr-May', oos: 'Jun' },
      { is: 'May-Jun', oos: 'Jul' },
      { is: 'Jun-Jul', oos: 'Aug' },
    ];

    const engine = new BacktestEngine({
      symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'QNT/USDT'] as AssetSymbol[],
      initialCapital: 100000,
      commission: 0.0004,
      slippage: 0.0001,
      maxLeverage: 2,
    });

    const dataset = engine.generateDeterministicHighFidelityData();
    // Validate dataset is non-empty before slicing
    const firstSymbolCandles = Array.from(dataset.values())[0];
    if (!firstSymbolCandles || firstSymbolCandles.length === 0) {
      throw new Error('WalkForward: dataset is empty — cannot slice windows');
    }
    const allCandlesCount = firstSymbolCandles.length;
    const windowSize = Math.floor(allCandlesCount / (numWindows + 1));
    const isSize = Math.floor(windowSize * 0.7);

    let totalISSharpe = 0;
    let totalOOSSharpe = 0;

    for (let i = 0; i < numWindows; i++) {
      const label = months[i] || { is: `W${i + 1}-IS`, oos: `W${i + 1}-OOS` };
      const startIdx = i * Math.floor(windowSize * 0.5);
      const isEndIdx = Math.min(allCandlesCount, startIdx + isSize);
      const oosEndIdx = Math.min(allCandlesCount, isEndIdx + (windowSize - isSize));

      // Bounds-check window indices before slicing
      if (startIdx >= isEndIdx || isEndIdx >= oosEndIdx) {
        console.warn(`WalkForward: skipping window ${i + 1} — invalid slice bounds [${startIdx}, ${isEndIdx}, ${oosEndIdx}]`);
        continue;
      }

      // Slice in-sample & out-of-sample datasets
      const isData = new Map<string, any[]>();
      const oosData = new Map<string, any[]>();

      dataset.forEach((candles, sym) => {
        const isSlice = candles.slice(startIdx, isEndIdx);
        const oosSlice = candles.slice(isEndIdx, oosEndIdx);
        // Only include symbols with enough data in each segment
        if (isSlice.length >= 20) isData.set(sym, isSlice);
        if (oosSlice.length >= 20) oosData.set(sym, oosSlice);
      });

      if (isData.size === 0 || oosData.size === 0) {
        console.warn(`WalkForward: skipping window ${i + 1} — insufficient data in IS/OOS segments`);
        continue;
      }

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

      // Use RAW Sharpe values — do NOT clamp with Math.max floors.
      // Clamping guaranteed efficiencyRatio >= 0.625 >= 0.60, making robustnessPass
      // always true and the overfitting detector inert.
      const isSharpe = isRes.sharpeRatio;
      const oosSharpe = oosRes.sharpeRatio;
      const isReturn = Number(isRes.totalReturnPct.toFixed(1));
      const oosReturn = Number(oosRes.totalReturnPct.toFixed(1));

      const efficiency = Number((oosSharpe / (isSharpe || 1)).toFixed(2));
      const pass = efficiency >= 0.60;

      totalISSharpe += isSharpe;
      totalOOSSharpe += oosSharpe;

      windows.push({
        windowIndex: i + 1,
        trainStart: `2024-${label.is}-01`,
        trainEnd: `2024-${label.is}-28`,
        testStart: `2024-${label.oos}-01`,
        testEnd: `2024-${label.oos}-28`,
        inSampleSharpe: isSharpe,
        outOfSampleSharpe: oosSharpe,
        inSampleReturnPct: isReturn,
        outOfSampleReturnPct: oosReturn,
        efficiencyRatio: efficiency,
        robustnessPass: pass,
      });
    }

    const validWindows = windows.length;
    const avgInSampleSharpe = validWindows > 0 ? Number((totalISSharpe / validWindows).toFixed(2)) : 0;
    const avgOutOfSampleSharpe = validWindows > 0 ? Number((totalOOSSharpe / validWindows).toFixed(2)) : 0;
    const overallEfficiency = Number((avgOutOfSampleSharpe / (avgInSampleSharpe || 1)).toFixed(2));
    const overfittingScore = Number(Math.max(0, 1 - overallEfficiency).toFixed(2));

    const verdict =
      overallEfficiency >= 0.72
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
