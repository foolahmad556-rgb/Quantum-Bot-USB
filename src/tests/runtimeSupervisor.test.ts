import assert from 'node:assert/strict';
import { RuntimeSupervisor } from '../server/RuntimeSupervisor';
let now = 1000, lost = 0, healthy = true, released = false;
const store = { async ping() { return { ok: healthy }; }, async acquireLease() { return { acquired: true, expiresAt: now + 30000 }; }, async releaseLease() { released = true; } };
const supervisor = new RuntimeSupervisor(store, 'account', async () => { lost++; }, () => now);
try {
  assert.equal(supervisor.canEnter(), false);
  await supervisor.start(); assert.equal(supervisor.canEnter(), true);
  now += 21000; assert.equal(supervisor.canEnter(), false);
  await supervisor.heartbeat(); assert.equal(supervisor.canEnter(), true);
  healthy = false; await supervisor.heartbeat();
  assert.equal(lost, 1); assert.equal(supervisor.canEnter(), false);
  healthy = true; await supervisor.heartbeat(); assert.equal(supervisor.canEnter(), false, "No silent rearming after loss");
} finally { await supervisor.stop(); }
assert.equal(released, true);
const denied = new RuntimeSupervisor({ ...store, async ping() { return { ok: true }; }, async acquireLease() { return { acquired: false, expiresAt: 0 }; } }, 'account', async () => {});
await assert.rejects(denied.start()); assert.equal(denied.canEnter(), false);
console.log('PASS lease expiry, storage failure, competing owner, shutdown release');
