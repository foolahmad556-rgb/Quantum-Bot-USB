import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import worker from '../../api/d1-worker.js';
import { sqliteD1 } from '../testing/sqliteD1';
const DB = await sqliteD1(), secret = randomBytes(32).toString('hex');
const call = (path: string, method = 'GET', data?: any, authenticated = true, headers: any = {}) => worker.fetch(new Request(`http://worker.invalid${path}`, {
  method, headers: { ...(authenticated ? { Authorization: `Bearer ${secret}` } : {}), ...headers },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
}), { DB, D1_API_SECRET: secret });
try {
  assert.equal((await call('/d1/health', 'GET', undefined, false)).status, 401);
  assert.equal((await call('/d1/health')).status, 200);
  assert.equal((await call('/d1/trades', 'POST', { symbol: 'BTC/USDT' })).status, 400);
  assert.equal((await call('/d1/trades', 'POST', { id: 'trade/a', symbol: 'BTC/USDT', status: 'OPEN' })).status, 200);
  assert.equal((await (await call('/d1/trades/open')).json()).items.length, 1);
  assert.equal((await call('/d1/trades/trade%2Fa', 'PATCH', { pnl: 2, exitPrice: 102 })).status, 200);
  assert.equal((await (await call('/d1/trades/open')).json()).items.length, 0);
  await call('/d1/state/test', 'PUT', { value: { stopped: true } });
  assert.deepEqual((await (await call('/d1/state/test')).json()).value, { stopped: true });
  await call('/d1/prices', 'POST', { symbol: 'BTC/USDT', price: 100 });
  await call('/d1/prices', 'POST', { symbol: 'BTC/USDT', price: 101 });
  const prices = await (await call('/d1/prices/BTC%2FUSDT?limit=1')).json();
  assert.equal(prices.items[0].price, 101);
  assert.equal((await call('/d1/query', 'POST', { sql: 'DROP TABLE trades' })).status, 404);
  const claims = await Promise.all([1,2].map(() => call('/d1/orders/claim', 'POST', { id: 'order-1', requestHash: 'hash-1' }).then(r => r.json())));
  assert.equal(claims.filter(x => x.claimed).length, 1);
  await call('/d1/orders/order-1', 'PUT', { id: 'order-1', status: 'FILLED' });
  const orders = await (await call('/d1/orders')).json();
  assert.equal(orders.items[0].requestHash, 'hash-1');
  assert.equal(orders.items[0].status, 'FILLED');
  assert.equal((await call('/d1/leases/account', 'PUT', { owner: 'a' })).status, 200);
  assert.equal((await call('/d1/leases/account', 'PUT', { owner: 'b' })).status, 409);
  await call('/d1/leases/account', 'DELETE', undefined, true, { 'X-Lease-Owner': 'b' });
  assert.equal((await call('/d1/leases/account', 'PUT', { owner: 'b' })).status, 409);
  await call('/d1/leases/account', 'DELETE', undefined, true, { 'X-Lease-Owner': 'a' });
  assert.equal((await call('/d1/leases/account', 'PUT', { owner: 'b' })).status, 200);
  console.log('PASS Worker authentication, migrations, trades, prices, state, idempotent orders and owner lease SQL');
} finally { await DB.close(); }
