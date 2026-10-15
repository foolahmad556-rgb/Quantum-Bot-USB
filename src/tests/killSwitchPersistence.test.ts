import assert from 'node:assert/strict';
import { KillSwitch } from '../risk/KillSwitch';
import { restorePersistentKillSwitch } from '../execution/ReconciliationSafety';

const killSwitch = new KillSwitch();
const restored = restorePersistentKillSwitch({
  level: 'HARD_HALT',
  active: true,
  reason: 'Exchange reconciliation failed: invalid or non-positive account equity',
}, killSwitch);

assert.equal(restored, true);
assert.equal(killSwitch.getLevel(), 'HARD_HALT');
assert.equal(killSwitch.isEntryAllowed(), false);
assert.match(killSwitch.getHistory()[0].reason, /Restored from persistent state/);

const normal = new KillSwitch();
assert.equal(restorePersistentKillSwitch({ level: 'NORMAL', active: false, reason: '' }, normal), false);
assert.equal(normal.isEntryAllowed(), true);
console.log('kill switch persistence test passed');
