import assert from 'node:assert/strict';
import { RateLimiter } from '../utils/RateLimiter';

const limiter = new RateLimiter();
limiter.syncUsed(2250);
const status = limiter.getRateLimitStatus('/fapi/v1/time');
assert.equal(status.used, 2250, 'Binance reported weight must be reflected for every endpoint');
assert.equal(status.isApproachingLimit, true, 'near-limit Binance usage must trigger conservative status');

const queued = new RateLimiter();
const originalFetch = globalThis.fetch;
let active = 0;
let peak = 0;
globalThis.fetch = async () => {
  active++;
  peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 5));
  active--;
  return new Response('{}', { status: 200 });
};
try {
  await Promise.all([
    queued.fetch('https://fapi.binance.com/fapi/v1/time'),
    queued.fetch('https://fapi.binance.com/fapi/v1/time'),
  ]);
  assert.equal(peak, 1, 'Binance REST calls must be serialized by BinanceRestGate');

  const banned = new RateLimiter();
  globalThis.fetch = async () => new Response('{}', {
    status: 418,
    headers: { 'Retry-After': '120' },
  });
  await banned.fetch('https://fapi.binance.com/fapi/v1/time');
  const quarantine = banned.getQuarantineStatus();
  assert.equal(quarantine.reason, '418');
  assert.ok(quarantine.remainingMs >= 120_000, '418 must honor Retry-After');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS Binance server-reported rate-limit accounting, serialized queue, and 418 quarantine');
