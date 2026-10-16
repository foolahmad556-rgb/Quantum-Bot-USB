import assert from 'node:assert/strict';
import { BacktestEngine } from '../backtest/BacktestEngine';
import { WalkForwardOptimizer } from '../backtest/WalkForwardOptimizer';
import { WalkForwardValidator } from '../validation/WalkForward';
import { PRESET_STRESS_SCENARIOS } from '../validation/StressScenarios';
import type { Candle } from '../domain/types';

const DAY = 24 * 60 * 60 * 1000;

function candles(count = 240, start = Date.UTC(2024, 0, 1)): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 9) * 3 + i * 0.03;
    return {
      timestamp: start + i * DAY,
      open: close - 0.2,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 1000 + i,
      vwap: close,
    };
  });
}

function dataset(count = 240): Map<string, Candle[]> {
  return new Map([
    ['BTC/USDT', candles(count)],
    ['ETH/USDT', candles(count).map((c) => ({ ...c, close: c.close * 0.8 }))],
  ]);
}

function finite(value: unknown, name: string): void {
  assert.equal(typeof value, 'number', `${name} must be number`);
  assert.ok(Number.isFinite(value), `${name} must be finite`);
}

const data = dataset();
const engine = new BacktestEngine({
  symbols: ['BTC/USDT', 'ETH/USDT'],
  initialCapital: 10_000,
  commission: 0.0004,
  slippage: 0.0001,
  maxLeverage: 2,
});

const result = engine.runSync(data, { entryZ: 1.5, maxHurst: 0.55 });
assert.equal(result.config.initialCapital, 10_000, 'capital must propagate');
for (const field of ['totalReturnPct', 'sharpeRatio', 'sortinoRatio', 'maxDrawdownPct', 'totalFeesPaid']) {
  finite(result[field as keyof typeof result], field);
}
assert.ok(result.totalTrades >= 0, 'trade count cannot be negative');
assert.ok(result.totalFeesPaid >= 0, 'fees cannot be negative');
assert.ok(result.equityCurve.length > 0, 'equity curve must exist');
assert.equal(result.equityCurve.length, data.get('BTC/USDT')!.length, 'equity curve must cover timeline');
assert.equal(result.trades.length, result.totalTrades * 2, 'each completed trade must have entry and exit fills');

const repeated = engine.runSync(data, { entryZ: 1.5, maxHurst: 0.55 });
assert.deepEqual(repeated, result, 'same candles and params must be deterministic');

const validator = WalkForwardValidator.runWalkForwardValidation(4, data);
assert.equal(validator.windows.length, 4, 'validator must produce requested windows');
assert.ok(validator.windows.every((w) => w.trainEnd <= w.testStart), 'IS/OOS windows must not overlap');
assert.ok(validator.windows.every((w) => w.efficiencyRatio >= 0 || w.efficiencyRatio === 0), 'efficiency must be non-negative');
assert.ok(['HIGHLY_ROBUST', 'MODERATE_DECAY', 'OVERFITTED'].includes(validator.verdict), 'verdict must be controlled');
finite(validator.overallEfficiency, 'overallEfficiency');
finite(validator.overfittingScore, 'overfittingScore');

const optimizer = new WalkForwardOptimizer(['BTC/USDT'], 120, 60, 20);
const end = Date.UTC(2024, 6, 1);
optimizer.generateSegments(end);
const segments = await optimizer.run(new Map([['BTC/USDT', candles(140, end - 140 * DAY)]]));
assert.ok(segments.length > 0, 'optimizer must create at least one segment');
assert.ok(segments.every((s) => s.inSampleEnd <= s.outSampleStart), 'optimizer must prevent leakage');
assert.ok(segments.every((s) => s.bestParams), 'optimizer must select params');
assert.ok(segments.every((s) => s.oosPerformance), 'optimizer must evaluate OOS');

assert.equal(PRESET_STRESS_SCENARIOS.length, 5, 'stress catalog must contain five scenarios');
assert.equal(new Set(PRESET_STRESS_SCENARIOS.map((s) => s.id)).size, 5, 'stress IDs must be unique');
for (const scenario of PRESET_STRESS_SCENARIOS) {
  assert.ok(scenario.priceDropPct > 0, `${scenario.id}: drop must be positive`);
  assert.ok(scenario.volatilityMultiplier >= 1, `${scenario.id}: volatility multiplier invalid`);
  assert.ok(scenario.spreadMultiplier >= 1, `${scenario.id}: spread multiplier invalid`);
  assert.ok(scenario.liquidityDrainPct >= 0 && scenario.liquidityDrainPct <= 100, `${scenario.id}: liquidity range invalid`);
}

console.log('backtesting network tests passed: engine, determinism, leakage, WFO, stress catalog');
