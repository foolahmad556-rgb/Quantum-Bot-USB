import assert from 'node:assert/strict';
import { RateLimiter } from '../utils/RateLimiter';

const limiter = new RateLimiter();
limiter.syncUsed(2250);
const status = limiter.getRateLimitStatus('/fapi/v1/time');
assert.equal(status.used, 2250, 'Binance reported weight must be reflected for every endpoint');
assert.equal(status.isApproachingLimit, true, 'near-limit Binance usage must trigger conservative status');
console.log('PASS Binance server-reported rate-limit accounting');
