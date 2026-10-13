/**
 * Regression test: KillSwitch severity escalation.
 * Run: npx tsx src/tests/killSwitch.regression.ts
 */
import assert from 'node:assert/strict';
import { KillSwitch } from '../risk/KillSwitch';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test('CIRCUIT_BREAKER -> HARD_HALT escalates', () => {
  const ks = new KillSwitch();
  assert.equal(ks.trigger('CIRCUIT_BREAKER', 'breaker'), true);
  assert.equal(ks.getLevel(), 'CIRCUIT_BREAKER');
  assert.equal(ks.trigger('HARD_HALT', 'hard halt'), true);
  assert.equal(ks.getLevel(), 'HARD_HALT');
});

test('HARD_HALT -> CIRCUIT_BREAKER is rejected (no de-escalation)', () => {
  const ks = new KillSwitch();
  ks.trigger('HARD_HALT', 'hard halt');
  assert.equal(ks.trigger('CIRCUIT_BREAKER', 'downgrade'), false);
  assert.equal(ks.getLevel(), 'HARD_HALT');
});

test('same-level trigger returns false', () => {
  const ks = new KillSwitch();
  ks.trigger('HARD_HALT', 'first');
  assert.equal(ks.trigger('HARD_HALT', 'again'), false);
  assert.equal(ks.getHistory().length, 1);
});

test('full escalation chain NORMAL -> EMERGENCY_LIQUIDATE', () => {
  const ks = new KillSwitch();
  assert.equal(ks.trigger('SOFT_HALT', 's'), true);
  assert.equal(ks.trigger('CIRCUIT_BREAKER', 'c'), true);
  assert.equal(ks.trigger('HARD_HALT', 'h'), true);
  assert.equal(ks.trigger('EMERGENCY_LIQUIDATE', 'e'), true);
  assert.equal(ks.getLevel(), 'EMERGENCY_LIQUIDATE');
  assert.equal(ks.trigger('HARD_HALT', 'back'), false);
});

test('trigger return value is boolean and history records transitions', () => {
  const ks = new KillSwitch();
  const r1 = ks.trigger('SOFT_HALT', 'x', 'MANUAL_OPERATOR');
  const r2 = ks.trigger('SOFT_HALT', 'x');
  assert.equal(typeof r1, 'boolean');
  assert.equal(typeof r2, 'boolean');
  const h = ks.getHistory();
  assert.equal(h[0].fromLevel, 'NORMAL');
  assert.equal(h[0].toLevel, 'SOFT_HALT');
  assert.equal(h[0].triggeredBy, 'MANUAL_OPERATOR');
});

console.log('All KillSwitch regression tests passed.');
