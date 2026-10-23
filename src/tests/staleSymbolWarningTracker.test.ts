import assert from 'node:assert/strict';
import { StaleSymbolWarningTracker } from '../market-data/StaleSymbolWarningTracker';

const tracker = new StaleSymbolWarningTracker(60_000);
assert.equal(tracker.observe('BTC/USDT', false, 1_000), 'warn');
assert.equal(tracker.observe('BTC/USDT', false, 10_000), 'none');
assert.equal(tracker.observe('BTC/USDT', false, 61_000), 'warn');
assert.equal(tracker.observe('BTC/USDT', true, 62_000), 'recovered');
assert.equal(tracker.observe('BTC/USDT', true, 63_000), 'none');
tracker.observe('ETH/USDT', false, 1_000);
tracker.forgetExcept(['BTC/USDT']);
assert.equal(tracker.observe('ETH/USDT', false, 2_000), 'warn');
console.log('PASS stale symbol warning throttling and recovery');
