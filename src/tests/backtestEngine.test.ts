import assert from 'node:assert/strict';
import { BacktestEngine } from '../backtest/BacktestEngine';
import type { Candle } from '../domain/types';

const engine = new BacktestEngine({ symbols: ['BTC/USDT'], initialCapital: 10_000, takerFeeBps: 5, slippage: 0 });
assert.throws(() => engine.runSync(new Map()), /no historical candles/i);

const candles: Candle[] = Array.from({ length: 100 }, (_, i) => {
  const close = 100 + Math.sin(i / 3) * 4 + Math.sin(i / 11) * 7;
  return { timestamp: i * 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 1000, vwap: close };
});
const result = engine.runSync(new Map([['BTC/USDT', candles]]));
assert.equal(result.equityCurve.length, candles.length);
assert.ok(Array.isArray(result.councilEvaluations), 'backtest report must expose per-symbol council evaluations');
assert.ok(result.trades.some((fill) => fill.councilReport), 'backtest result must include council data consumed by the UI');
assert.ok(result.trades.filter((fill) => fill.fillId.startsWith('FILL-EXIT-')).every((fill) => fill.councilEvaluationId && fill.tradeId && fill.exitReason && fill.realizedPnl !== undefined), 'closed trades must retain council linkage and exit details for the UI');
assert.ok(result.councilEvaluations!.length > 0, 'council evaluations must be recorded');
assert.ok(result.councilEvaluations!.every((evaluation) => evaluation.symbol === 'BTC/USDT' && evaluation.votes.length === 4));
assert.ok(result.trades.filter((fill) => fill.fillId.startsWith('FILL-ENT-')).every((fill) => fill.councilEvaluationId),
  'each entry fill must reference its symbol-specific council evaluation');
assert.ok(result.trades.filter((fill) => fill.fillId.startsWith('FILL-EXIT-')).every((fill) => fill.tradeId),
  'each exit fill must reference its originating trade');
assert.ok(result.equityCurve.every((point) => Number.isFinite(point.equity) && Number.isFinite(point.cash)));
assert.ok(Number.isFinite(result.totalFeesPaid) && result.totalFeesPaid >= 0);
for (const point of result.equityCurve) {
  assert.ok(Math.abs(point.equity - (point.cash + point.holdingsValue)) < 0.02,
    `equity must equal cash plus holdings at ${point.timestamp}`);
}
const fillFees = result.trades.reduce((sum, fill) => sum + fill.commission, 0);
assert.ok(Math.abs(result.totalFeesPaid - fillFees) < 0.02, 'reported fees must reconcile to fill fees');
assert.ok(Math.abs(result.equityCurve.at(-1)!.equity - result.equityCurve.at(-1)!.cash) < 0.01,
  'final equity and cash must reconcile when no positions remain');
assert.ok(result.equityCurve.every((point) => point.equity >= 0));
console.log('backtest engine smoke tests passed');
