import assert from 'node:assert/strict';
import { KillSwitch } from '../risk/KillSwitch';
import { failClosedOnInvalidEquity, watchdogMayRestart } from '../execution/ReconciliationSafety';

const killSwitch = new KillSwitch();
assert.equal(failClosedOnInvalidEquity('0', killSwitch), false);
assert.equal(killSwitch.getLevel(), 'HARD_HALT');
assert.match(killSwitch.getHistory()[0].reason, /invalid or non-positive/);
assert.equal(watchdogMayRestart(false, killSwitch), false);
const recovered = new KillSwitch();
assert.equal(failClosedOnInvalidEquity('250', recovered), true);
assert.equal(recovered.isActive(), false);

const halted = new KillSwitch();
halted.trigger('HARD_HALT', 'manual safety halt', 'AUTO_RISK_ENGINE');
assert.equal(failClosedOnInvalidEquity('250', halted), true);
assert.equal(halted.getLevel(), 'HARD_HALT');
assert.equal(halted.isActive(), true);
assert.equal(watchdogMayRestart(false, halted), false);

console.log('reconciliation safety test passed');
