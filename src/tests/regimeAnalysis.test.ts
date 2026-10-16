import assert from 'node:assert/strict';
import { analyzeRegimes, classifyRegime } from '../backtest/RegimeAnalysis';

const up = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
const flat = Array.from({ length: 30 }, (_, i) => 115 + Math.sin(i) * 0.05);
assert.equal(classifyRegime(up), 'TRENDING');
assert.equal(classifyRegime(flat), 'RANGING');

const result = analyzeRegimes([
  { regime: 'TRENDING', returnPct: 0.02 },
  { regime: 'TRENDING', returnPct: -0.01 },
  { regime: 'RANGING', returnPct: 0.01 },
  { regime: 'RANGING', returnPct: -0.02 },
]);
assert.equal(result.totalTrades, 4);
assert.equal(result.byRegime.TRENDING.trades, 2);
assert.equal(result.byRegime.RANGING.trades, 2);
assert.equal(result.byRegime.VOLATILE.trades, 0);
assert.equal(result.byRegime.TRENDING.winRate, 0.5);
assert.equal(result.bestRegime, 'TRENDING');
console.log('regime analysis tests passed');
