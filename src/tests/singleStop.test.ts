import assert from 'node:assert/strict';
import { computeStopDistance } from '../app/TradingPipeline';

assert.equal(computeStopDistance(100, 0.0001), 0.4, 'floor 0.4%');
assert.equal(computeStopDistance(100, 5), 3, 'cap 3%');
assert.equal(computeStopDistance(100, 1), 2, '2 sigma in band');
assert.equal(computeStopDistance(100, NaN), 0.4, 'NaN sigma falls to floor');
console.log('PASS single stop distance helper is clamped and deterministic');
