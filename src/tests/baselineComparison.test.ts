import assert from 'node:assert/strict';
import { compareBaselines } from '../backtest/BaselineComparison';

const prices = [100, 105, 102, 110, 121];
const strategy = [0.02, -0.01, 0.03, 0.04];
const result = compareBaselines(prices, strategy, 10_000);

assert.equal(result.buyAndHold.finalEquity, 12_100);
assert.equal(result.strategy.finalEquity, 10_000 * 1.02 * 0.99 * 1.03 * 1.04);
assert.equal(result.randomBaseline.simulations, 1_000);
assert.equal(result.randomBaseline.distribution.length, 1_000);
assert.deepEqual(compareBaselines(prices, strategy, 10_000).randomBaseline, result.randomBaseline);
assert.equal(result.strategy.beatsBuyAndHold, result.strategy.finalEquity > result.buyAndHold.finalEquity);
assert.equal(result.strategy.beatsRandom, result.strategy.finalEquity > result.randomBaseline.medianFinalEquity);
assert.throws(() => compareBaselines([100], strategy, 10_000), /prices/);
assert.throws(() => compareBaselines(prices, [], 10_000), /returns/);
console.log('baseline comparison tests passed');
