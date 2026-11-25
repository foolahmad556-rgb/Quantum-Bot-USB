import assert from 'node:assert/strict';
import { normalizeSignalSide } from '../domain/types';

assert.equal(normalizeSignalSide('STRONG_BUY'), 'BUY');
assert.equal(normalizeSignalSide('BUY'), 'BUY');
assert.equal(normalizeSignalSide('STRONG_SELL'), 'SELL');
assert.equal(normalizeSignalSide('SELL'), 'SELL');
assert.equal(normalizeSignalSide('NEUTRAL'), null);
assert.equal(normalizeSignalSide(undefined), null);
console.log('PASS STRONG signals normalize to a real order side');
