import assert from 'node:assert/strict';
import { runMonteCarloStress } from '../backtest/MonteCarloStress';

const trades = [0.02, -0.01, 0.03, -0.015, 0.01, -0.02, 0.025];
const first = runMonteCarloStress(trades, { simulations: 200, initialCapital: 10_000, seed: 42 });
const second = runMonteCarloStress(trades, { simulations: 200, initialCapital: 10_000, seed: 42 });
assert.deepEqual(first, second, 'fixed seed must be deterministic');
assert.equal(first.simulations, 200);
assert.equal(first.distribution.length, 200);
assert.ok(first.percentiles.p05 <= first.percentiles.p50);
assert.ok(first.percentiles.p50 <= first.percentiles.p95);
assert.ok(first.worstFinalEquity <= first.bestFinalEquity);
assert.ok(first.probabilityOfLoss >= 0 && first.probabilityOfLoss <= 1);
assert.ok(first.worstMaxDrawdownPct >= 0 && first.worstMaxDrawdownPct <= 100);
assert.throws(() => runMonteCarloStress([], { simulations: 10, initialCapital: 1000, seed: 1 }), /trades/);
assert.throws(() => runMonteCarloStress(trades, { simulations: 0, initialCapital: 1000, seed: 1 }), /simulations/);
console.log('monte carlo stress tests passed');
