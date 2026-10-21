import assert from 'node:assert/strict';
import { RuntimeSupervisor } from '../server/RuntimeSupervisor';
import { D1DatabaseService } from '../storage/D1DatabaseService';
let now = 1000, lost = 0, healthy = true, released = false, conflict = false;
const reasons: string[] = [];
const store = { async ping() { return { ok: healthy }; }, async acquireLease() { return { acquired: !conflict, expiresAt: now + 30000 }; }, async releaseLease() { released = true; } };
const supervisor = new RuntimeSupervisor(store, 'account', async reason => { lost++; reasons.push(reason); }, () => now);
try {
  assert.equal(supervisor.canEnter(), false);
  await supervisor.start(); assert.equal(supervisor.canEnter(), true);
  healthy = false; now += 5000; await supervisor.heartbeat();
  assert.equal(supervisor.canEnter(), false, 'Transient failure blocks entries immediately');
  assert.equal(lost, 0, 'Keep protection alive within existing lease deadline');
  healthy = true; now += 5000; await supervisor.heartbeat();
  assert.equal(supervisor.canEnter(), true, 'Renewed ownership recovers transient failure');
  healthy = false; now += 5000; await supervisor.heartbeat();
  now += 16000; await supervisor.heartbeat();
  assert.equal(lost, 1); assert.equal(supervisor.canEnter(), false);
  assert.match(reasons[0], /expired before renewal/);
  healthy = true; await supervisor.heartbeat(); assert.equal(supervisor.canEnter(), false, 'No silent rearming after expired lease');
} finally { await supervisor.stop(); }
assert.equal(released, true);
const denied = new RuntimeSupervisor({ ...store, async acquireLease() { return { acquired: false, expiresAt: 0 }; } }, 'account', async () => {});
await assert.rejects(denied.start()); assert.equal(denied.canEnter(), false);
const competing = new RuntimeSupervisor(store, 'account', async reason=>{reasons.push(reason)},()=>now);
try {
 await competing.start(); conflict=true; await competing.heartbeat();
 assert.equal(competing.canEnter(),false); assert.match(reasons.at(-1)!,/another instance/);
} finally {conflict=false;await competing.stop();}
const expired = new RuntimeSupervisor(store, 'account', async reason=>{reasons.push(reason)},()=>now);
try {
 await expired.start(); now+=21000; await expired.heartbeat();
 assert.equal(expired.canEnter(),false); assert.match(reasons.at(-1)!,/expired before renewal/);
} finally {await expired.stop();}
const originalFetch=globalThis.fetch;
try {
 globalThis.fetch=async()=>new Response('{}',{status:409});
 const db=new D1DatabaseService('https://worker.invalid','test');
 assert.deepEqual(await db.acquireLease('account','owner'),{acquired:false,expiresAt:0});
 globalThis.fetch=async()=>new Response('{}',{status:503});
 await assert.rejects(db.acquireLease('account','owner'),/D1 API 503/);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS transient failure blocks entries, bounded recovery, deadline halt, no silent rearming, conflict immediate halt, HTTP 409 classification');
