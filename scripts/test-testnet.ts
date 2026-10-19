import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
const enabled = process.env.RUN_TESTNET_CHECKS === 'true';
const base = 'https://testnet.binancefuture.com';
test('Futures Testnet read-only connectivity/time', { skip: !enabled }, async () => {
  const start = Date.now();
  const r = await fetch(`${base}/fapi/v1/time`, { signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, 200);
  const { serverTime } = await r.json();
  assert.ok(Number.isFinite(serverTime));
  assert.ok(Math.abs(serverTime - (start + Date.now()) / 2) < 5000);
});
test('Futures Testnet signed read-only account request', {
  skip: !enabled || !process.env.BINANCE_TESTNET_KEY || !process.env.BINANCE_TESTNET_SECRET,
}, async () => {
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = createHmac('sha256', process.env.BINANCE_TESTNET_SECRET!).update(query).digest('hex');
  const r = await fetch(`${base}/fapi/v2/account?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': process.env.BINANCE_TESTNET_KEY! }, signal: AbortSignal.timeout(10000),
  });
  assert.equal(r.status, 200, 'Testnet account authentication failed');
  const body = await r.json(); assert.ok(Array.isArray(body.positions));
});
