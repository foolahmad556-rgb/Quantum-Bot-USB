import assert from 'node:assert/strict';
import { EventJournal } from '../storage/EventJournal';
import { OrderBookBuilder } from '../market-data/OrderBookBuilder';
import { OrderGateway } from '../execution/OrderGateway';
import { UserDataStream } from '../execution/UserDataStream';

process.env.EXECUTION_MODE = 'PAPER';

const journal = new EventJournal(100);
const stream = new UserDataStream(1000);
const bookBuilder = new OrderBookBuilder(5, 1234);
bookBuilder.initialize('BTCUSDT', 50000);

const gateway = new OrderGateway(stream, bookBuilder, {
  executionMode: 'PAPER',
  simulatedLatencyMs: 0,
});
gateway.setPreTradeValidator(() => ({ allowed: true }));

gateway.subscribeOrders((order) => {
  journal.record('INFO', 'ORDER_GATEWAY', `order:${order.status}`, {
    correlationId: order.id,
    orderId: order.id,
    status: order.status,
  });
});
stream.subscribeFills((fill) => {
  journal.record('INFO', 'SYSTEM', 'fill:confirmed', {
    correlationId: fill.orderId,
    orderId: fill.orderId,
    fillId: fill.fillId,
  });
});

const order = gateway.submitOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.001,
  price: 50000,
});

await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(order.status, 'FILLED');
assert.equal(order.filledQuantity, order.quantity);
assert.equal(stream.getFills().length, 1);
assert.equal(stream.getPosition('BTCUSDT')?.size, order.quantity);

const events = journal.getEvents();
assert.equal(events.some((event) => event.source === 'ORDER_GATEWAY'), true);
assert.equal(events.some((event) => event.source === 'SYSTEM'), true);
assert.equal(new Set(events.map((event) => event.details?.correlationId)).size, 1);
assert.equal(events.filter((event) => event.details?.orderId === order.id).length >= 2, true);

const fillCount = stream.getFills().length;
stream.processFill(stream.getFills()[0], order.price);
assert.equal(stream.getFills().length, fillCount + 1);
console.log('order execution integration test passed');

process.env.EXECUTION_MODE = undefined;

// Gateway safety regressions: never increase risk quantity to meet minimum notional.
gateway.setSymbolFilter('BTCUSDT', 0.000001, 0.1, 0.000001, 5);
const undersized = gateway.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.00005, price: 50000 });
assert.equal(undersized.status, 'REJECTED');
assert.match(undersized.errorMessage || '', /Notional value/);
