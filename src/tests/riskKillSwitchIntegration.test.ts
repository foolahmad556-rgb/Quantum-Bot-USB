import assert from 'node:assert/strict';
import { OrderBookBuilder } from '../market-data/OrderBookBuilder';
import { OrderGateway } from '../execution/OrderGateway';
import { UserDataStream } from '../execution/UserDataStream';
import { KillSwitch } from '../risk/KillSwitch';

const stream = new UserDataStream(1000);
const books = new OrderBookBuilder(5, 42);
books.initialize('BTCUSDT', 50000);
const gateway = new OrderGateway(stream, books, {
  executionMode: 'PAPER',
  simulatedLatencyMs: 0,
});
const killSwitch = new KillSwitch();

let riskAllows = true;
gateway.setPreTradeValidator(() => riskAllows
  ? { allowed: true }
  : { allowed: false, reason: 'RiskController rejected order: exposure limit exceeded' });

const approved = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000,
});
assert.notEqual(approved.status, 'REJECTED');

riskAllows = false;
const riskRejected = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000,
});
assert.equal(riskRejected.status, 'REJECTED');
assert.match(riskRejected.errorMessage ?? '', /exposure limit exceeded/);

killSwitch.trigger('HARD_HALT', 'Risk limit breached');
gateway.setPreTradeValidator((order) => {
  if (killSwitch.isActive() && !order.reduceOnly) {
    return { allowed: false, reason: `New entry blocked by Kill Switch (${killSwitch.getLevel()})` };
  }
  return { allowed: true };
});

const halted = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000,
});
assert.equal(halted.status, 'REJECTED');
assert.match(halted.errorMessage ?? '', /Kill Switch \(HARD_HALT\)/);
assert.equal(killSwitch.isEntryAllowed(), false);
assert.equal(killSwitch.getLevel(), 'HARD_HALT');

console.log('risk and kill switch integration test passed');
