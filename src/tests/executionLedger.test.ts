import assert from 'node:assert/strict';
import { appendUniqueFill, adverseSlippageBps, settleExecution, takeFillQuantity, type ExecutionLedgerFill } from '../execution/ExecutionLedger';

const entry: ExecutionLedgerFill = {
  fillId: 'entry-1', orderId: 'order-entry', symbol: 'BTC/USDT', side: 'BUY',
  price: 100, quantity: 2, commission: 0.1, commissionAsset: 'USDT', timestamp: 1, isMaker: false,
};
const exit: ExecutionLedgerFill = {
  fillId: 'exit-1', orderId: 'order-exit', symbol: 'BTC/USDT', side: 'SELL',
  price: 110, quantity: 2, commission: 0.11, commissionAsset: 'USDT', timestamp: 2, isMaker: false,
};
const fills = [entry];
appendUniqueFill(fills, entry);
assert.equal(fills.length, 1, 'duplicate websocket fill must be ignored');
const settled = settleExecution({ side: 'BUY', entryFills: fills, exitFills: [exit], entryReferencePrice: 99, exitReferencePrice: 111 });
assert.ok(settled);
assert.equal(settled?.grossPnl, 20);
assert.equal(settled?.totalFees, 0.21);
assert.equal(settled?.netPnl, 19.79);
assert.equal(settled?.entrySlippageBps, 101.01);
assert.equal(settled?.exitSlippageBps, 90.09);
assert.equal(adverseSlippageBps('BUY', 100, 100.1), 10);
const allocation = takeFillQuantity([{ ...exit }], 1);
assert.equal(allocation[0].quantity, 1);
assert.equal(allocation[0].commission, 0.055);
console.log('PASS execution ledger attribution');
