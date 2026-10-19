import assert from 'node:assert/strict';
import { submitManualOrder } from '../server/manualOrders';
const stored = new Map<string, any>(); let submissions = 0;
const store = {
  async claimOrder(id: string, requestHash: string) {
    if (stored.has(id)) return { claimed: false, order: stored.get(id) };
    const order = { id, requestHash, status: 'CLAIMED' }; stored.set(id, order);
    return { claimed: true, order };
  },
  async saveOrder(order: any) { stored.set(order.id, order); },
};
const input = { symbol: 'BTC/USDT', side: 'BUY', quantity: 1 };
const gateway = { submitOrder(params: any) { submissions++; return { id: params.orderId, status: 'REJECTED', errorMessage: 'Kill switch active' }; } };
const result = await submitManualOrder(store, gateway, 'test-key-1234567890', input);
assert.equal(result.statusCode, 422); assert.equal(('executed' in result.body && result.body.executed), false);
await submitManualOrder(store, gateway, 'test-key-1234567890', input);
assert.equal(submissions, 1);
assert.equal((await submitManualOrder(store, gateway, 'test-key-1234567890', { ...input, quantity: 2 })).statusCode, 409);
const pending = await submitManualOrder(store, { submitOrder(p: any) { return { id: p.orderId, status: 'PENDING_NEW' }; } }, 'other-key-123456789', input);
assert.equal(pending.statusCode, 202); assert.equal(('executed' in pending.body && pending.body.executed), false);
await assert.rejects(submitManualOrder(store, gateway, 'short', input));
await assert.rejects(submitManualOrder(store, gateway, 'invalid-quantity-key', { ...input, quantity: NaN }));
console.log('PASS manual order rejection, pending status, stable IDs and retry deduplication');
