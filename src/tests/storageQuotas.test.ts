import assert from 'node:assert/strict';
import { StorageQuotaManager } from '../storage/StorageQuotas';

const manager = new StorageQuotaManager({ maxRecords: 2, maxBytes: 100 });
assert.equal(manager.canStore(40), true);
manager.recordStored(40);
manager.recordStored(30);
assert.equal(manager.canStore(20), false);
assert.equal(manager.getUsage().records, 2);
assert.equal(manager.getUsage().bytes, 70);
assert.equal(manager.shouldPrune(), true);
assert.equal(manager.prune(1), 1);
assert.equal(manager.getUsage().records, 1);
assert.equal(manager.getUsage().bytes, 0);
assert.throws(() => manager.recordStored(101), /quota/);
console.log('storage quota tests passed');
