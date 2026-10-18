import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ShadowComparisonThrottle } from '../storage/ShadowComparisonThrottle';

describe('ShadowComparisonThrottle', () => {
  it('allows first write and blocks repeat writes within interval', () => {
    const throttle = new ShadowComparisonThrottle(15 * 60_000);
    assert.equal(throttle.shouldPersist('BTC/USDT', 1_000), true);
    assert.equal(throttle.shouldPersist('BTC/USDT', 1_001), false);
    assert.equal(throttle.shouldPersist('BTC/USDT', 15 * 60_000 + 999), false);
    assert.equal(throttle.shouldPersist('BTC/USDT', 15 * 60_000 + 1_000), true);
  });

  it('throttles each symbol independently', () => {
    const throttle = new ShadowComparisonThrottle(15 * 60_000);
    assert.equal(throttle.shouldPersist('BTC/USDT', 1_000), true);
    assert.equal(throttle.shouldPersist('ETH/USDT', 1_001), true);
    assert.equal(throttle.shouldPersist('BTC/USDT', 1_002), false);
  });
});
