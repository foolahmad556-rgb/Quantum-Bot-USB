import assert from 'node:assert/strict';
import { generateWalkForwardWindows, parseBacktestArgs } from '../backtest/ComprehensiveBacktest';

const parsed = parseBacktestArgs(['--symbols', 'BTCUSDT,ETHUSDT', '--timeframe', '1h', '--data-dir', 'data/historical', '--capital', '25000']);
assert.deepEqual(parsed.symbols, ['BTCUSDT', 'ETHUSDT']);
assert.equal(parsed.timeframe, '1h');
assert.equal(parsed.dataDir, 'data/historical');
assert.equal(parsed.initialCapital, 25000);
assert.throws(() => parseBacktestArgs(['--timeframe', '7m']), /timeframe/i);
assert.throws(() => parseBacktestArgs(['--capital', '-1']), /capital/i);

const day = 86_400_000;
const windows = generateWalkForwardWindows(0, 730 * day - 3_600_000, 3_600_000);
assert.equal(windows.length, 4, '730 days hourly data must support four 365d/90d windows');
assert.equal(windows[0].trainStart, 0);
assert.equal(windows[0].testStart, 365 * day);
assert.equal(windows[0].testEnd, 455 * day);
for (let i = 1; i < windows.length; i++) {
  assert.equal(windows[i].testStart, windows[i - 1].testEnd, 'OOS windows must be contiguous and non-overlapping');
}
assert.equal(generateWalkForwardWindows(0, 364 * day, 3_600_000).length, 0, 'insufficient history must not fabricate a window');
assert.throws(() => generateWalkForwardWindows(10, 0, 3_600_000), /invalid/i);
console.log('comprehensive backtest tests passed');

