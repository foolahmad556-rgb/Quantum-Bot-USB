import assert from 'node:assert/strict';
import { evaluateCandleCouncil } from '../strategies/StrategyCouncil';
import type { Candle } from '../domain/types';

const candles: Candle[] = Array.from({ length: 25 }, (_, index) => {
  const close = 100 + index * 0.2;
  return {
    timestamp: index * 60_000,
    open: close - 0.05,
    high: close + (index === 24 ? 2 : 0.1),
    low: close - 0.1,
    close,
    volume: index === 24 ? 500 : 100,
    vwap: close,
  };
});

const votes = evaluateCandleCouncil(candles, {
  intervalMs: 60_000,
  asOf: 25 * 60_000,
});

assert.deepEqual(votes.map(({ member }) => member), [
  'trend', 'mean-reversion', 'breakout', 'momentum',
]);
assert.equal(votes.find(({ member }) => member === 'trend')?.side, 'BUY');
assert.equal(votes.find(({ member }) => member === 'mean-reversion')?.side, 'SELL');
assert.equal(votes.find(({ member }) => member === 'breakout')?.side, 'BUY');
assert.ok((votes.find(({ member }) => member === 'breakout')?.confidence ?? 0) > 0.52);
assert.equal(votes.find(({ member }) => member === 'momentum')?.side, 'BUY');

const notYetClosed = evaluateCandleCouncil(candles, {
  intervalMs: 60_000,
  asOf: 24 * 60_000,
});
assert.deepEqual(notYetClosed, evaluateCandleCouncil(candles.slice(0, 24), {
  intervalMs: 60_000,
  asOf: 24 * 60_000,
}), 'candle closes only when timestamp + intervalMs <= asOf');
console.log('candle council signal tests passed');
