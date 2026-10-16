import assert from 'node:assert/strict';
import { createReproducibilityRecord, reproducibilityHash } from '../backtest/ReproducibilityTracking';

const input = {
  datasetHash: 'abc123',
  strategyVersion: 'v1.2.0',
  parameters: { entryZ: 1.2, feeRate: 0.001 },
  seed: 42,
  codeVersion: 'commit-123',
};
const first = createReproducibilityRecord(input);
const second = createReproducibilityRecord(input);
assert.deepEqual(first, second);
assert.equal(first.inputHash, reproducibilityHash(input));
assert.equal(first.seed, 42);
assert.equal(first.strategyVersion, 'v1.2.0');
assert.notEqual(createReproducibilityRecord({ ...input, seed: 43 }).inputHash, first.inputHash);
assert.notEqual(createReproducibilityRecord({ ...input, parameters: { feeRate: 0.001, entryZ: 1.2 } }).inputHash, '');
assert.throws(() => createReproducibilityRecord({ ...input, datasetHash: '' }), /datasetHash/);
console.log('reproducibility tracking tests passed');
