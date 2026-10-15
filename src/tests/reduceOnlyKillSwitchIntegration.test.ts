import assert from 'node:assert/strict';
import { OrderBookBuilder } from '../market-data/OrderBookBuilder';
import { OrderGateway } from '../execution/OrderGateway';
import { UserDataStream } from '../execution/UserDataStream';
import { KillSwitch } from '../risk/KillSwitch';

const stream = new UserDataStream(1000);
const books = new OrderBookBuilder(5, 7);
books.initialize('BTCUSDT', 50000);
const gateway = new OrderGateway(stream, books, {
  executionMode: 'PAPER',
  simulatedLatencyMs: 0,
});
const killSwitch = new KillSwitch();

gateway.setPreTradeValidator((order) => {
  if (killSwitch.isActive() && !order.reduceOnly) {
    return { allowed: false, reason: `New entry blocked by Kill Switch (${killSwitch.getLevel()})` };
  }
  if (order.reduceOnly) {
    const position = stream.getPositions().find((position) => position.symbol === order.symbol);
    if (!position) return { allowed: false, reason: 'Reduce-only order rejected: no open position exists' };
    const closingSide = position.size > 0 ? 'SELL' : 'BUY';
    if (order.side !== closingSide || order.quantity > Math.abs(position.size)) {
      return { allowed: false, reason: 'Reduce-only order would increase or reverse the position' };
    }
  }
  return { allowed: true };
});

const entry = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000,
});
assert.notEqual(entry.status, 'REJECTED');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(stream.getPosition('BTCUSDT')?.size, 0.001);

killSwitch.trigger('HARD_HALT', 'Risk limit breached');
const exit = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.001, price: 50000, reduceOnly: true,
});
assert.notEqual(exit.status, 'REJECTED');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(stream.getPosition('BTCUSDT')?.size ?? 0, 0);

const reverse = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, reduceOnly: true,
});
assert.equal(reverse.status, 'REJECTED');
assert.match(reverse.errorMessage ?? '', /no open position|increase or reverse/);

const newEntry = gateway.submitOrder({
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000,
});
assert.equal(newEntry.status, 'REJECTED');
assert.match(newEntry.errorMessage ?? '', /Kill Switch \(HARD_HALT\)/);

console.log('reduce-only kill switch integration test passed');
