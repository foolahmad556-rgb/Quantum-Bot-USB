import assert from 'node:assert/strict';
import { assertNoLeakage, splitChronologically, validateOosResult } from '../backtest/LeakagePrevention';
import type { Candle } from '../domain/types';

const candles = Array.from({ length: 10 }, (_, i) => ({
  timestamp: 1_700_000_000_000 + i * 3_600_000,
  open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10, vwap: 100 + i,
} as Candle));

const split = splitChronologically(candles, 0.6, 0.2);
assert.equal(split.train.length, 6);
assert.equal(split.validation.length, 2);
assert.equal(split.test.length, 2);
assert.ok(split.train.at(-1)!.timestamp < split.validation[0].timestamp);
assert.ok(split.validation.at(-1)!.timestamp < split.test[0].timestamp);

assert.deepEqual(assertNoLeakage(split.train, split.validation, split.test), { valid: true, errors: [] });
assert.equal(assertNoLeakage(split.train, [...split.train], split.test).valid, false);
assert.equal(validateOosResult({ testStart: split.test[0].timestamp, lastTrainingTimestamp: split.validation.at(-1)!.timestamp }).valid, true);
assert.equal(validateOosResult({ testStart: split.validation[0].timestamp, lastTrainingTimestamp: split.validation.at(-1)!.timestamp }).valid, false);
assert.throws(() => splitChronologically(candles, 0.9, 0.2), /fractions/);

console.log('leakage prevention tests passed');
