import assert from 'node:assert/strict';
import { roundPriceSig, floorQty } from '../domain/types';

assert.equal(roundPriceSig(0.08214567), 0.0821457, 'cheap coin keeps precision (old toFixed(2) gave 0.08)');
assert.equal(roundPriceSig(65432.123456), 65432.12);
assert.equal(roundPriceSig(1.23456789), 1.23457);
assert.equal(floorQty(0.123456789, 4), 0.1234, 'quantity never rounds up');
assert.equal(floorQty(0.99999, 2), 0.99);
assert.equal(floorQty(-1), 0);
assert.equal(floorQty(NaN), 0);
console.log('PASS price rounding keeps precision, quantity rounds down');
