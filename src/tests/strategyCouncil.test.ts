import assert from 'node:assert/strict';
import { decideByCouncil, evaluateCandleCouncil } from '../strategies/StrategyCouncil';
import type { Candle } from '../domain/types';

assert.equal(decideByCouncil([
  { member: 'trend', side: 'BUY', confidence: 0.8 },
  { member: 'reversion', side: 'BUY', confidence: 0.7 },
])?.side, 'BUY');

const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
  const close = 100 + i * 0.15 + Math.sin(i) * 0.1;
  return { timestamp: i * 60_000, open: close - 0.02, high: close + 0.3, low: close - 0.3, close, volume: 100 + i, vwap: close };
});
const votes = evaluateCandleCouncil(candles, { intervalMs: 60_000, asOf: 40 * 60_000 });
assert.deepEqual(votes.map((vote) => vote.member), ['trend', 'mean-reversion', 'breakout', 'momentum']);
const beforeLastClose = evaluateCandleCouncil(candles, { intervalMs: 60_000, asOf: 39 * 60_000 });
const withoutUnclosedLast = evaluateCandleCouncil(candles.slice(0, 39), { intervalMs: 60_000, asOf: 39 * 60_000 });
assert.deepEqual(beforeLastClose, withoutUnclosedLast, 'unclosed last candle excluded');
const futureChanged = candles.slice();
futureChanged[39] = { ...futureChanged[39], close: futureChanged[39].close * 1.2 };
assert.deepEqual(evaluateCandleCouncil(futureChanged, { intervalMs: 60_000, asOf: 39 * 60_000 }), beforeLastClose, 'future candle cannot influence earlier votes');
const altered = candles.slice();
altered[39] = { ...altered[39], close: altered[39].close * 1.2 };
const next = evaluateCandleCouncil(altered, { intervalMs: 60_000, asOf: 40 * 60_000 });
assert.ok(votes.some((vote, i) => vote.side !== next[i].side || vote.confidence !== next[i].confidence), 'member logic derives votes from candle inputs');
console.log('strategy council tests passed');
