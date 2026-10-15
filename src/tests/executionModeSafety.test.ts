import assert from 'node:assert/strict';
import { getBinanceBaseUrl, normalizeExecutionMode } from '../domain/types';

function test(name: string, fn: () => void): void {
  fn();
  console.log(`PASS ${name}`);
}

test('explicit PAPER stays PAPER', () => {
  assert.equal(normalizeExecutionMode('PAPER', false), 'PAPER');
});

test('explicit TESTNET stays TESTNET', () => {
  assert.equal(normalizeExecutionMode('TESTNET', true), 'TESTNET');
  assert.equal(getBinanceBaseUrl('TESTNET'), 'https://testnet.binancefuture.com');
});

test('missing mode is deterministic safe PAPER', () => {
  assert.equal(normalizeExecutionMode(undefined, false), 'PAPER');
});

test('unknown mode never escalates to exchange', () => {
  assert.throws(() => normalizeExecutionMode('BROKEN_MODE', true), /Invalid EXECUTION_MODE/);
});

test('LIVE requires explicit live value', () => {
  assert.equal(normalizeExecutionMode('LIVE', true), 'LIVE');
  assert.equal(getBinanceBaseUrl('LIVE'), 'https://fapi.binance.com');
});
