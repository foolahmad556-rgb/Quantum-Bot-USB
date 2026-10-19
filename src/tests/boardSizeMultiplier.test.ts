import assert from 'node:assert/strict';
import { applyBoardSizeMultiplier } from '../app/TradingPipeline';

assert.equal(applyBoardSizeMultiplier(10, 0.5), 5);
assert.equal(applyBoardSizeMultiplier(10, 1), 10);
assert.equal(applyBoardSizeMultiplier(10, 2), 10, 'council must never increase risk-sized quantity');
assert.equal(applyBoardSizeMultiplier(10, 0), 0);
assert.equal(applyBoardSizeMultiplier(Number.NaN, 0.5), 0);

console.log('PASS board size multiplier is applied and capped');
