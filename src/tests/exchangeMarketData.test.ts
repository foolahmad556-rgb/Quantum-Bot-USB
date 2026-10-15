import assert from 'node:assert/strict';
import { buildFuturesCombinedStreamUrl, getReconnectDelay } from '../market-data/ExchangeMarketData';

assert.equal(
  buildFuturesCombinedStreamUrl(['BTC/USDT', 'ETH/USDT']),
  'wss://fstream.binance.com/stream?streams=btcusdt@aggTrade/ethusdt@aggTrade'
);
assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(getReconnectDelay), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
assert.equal(getReconnectDelay(20), 60000);

const source = await (await import('node:fs/promises')).readFile(new URL('../market-data/ExchangeMarketData.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /fetchOrderBookSnapshots\(\)\.catch/);
assert.doesNotMatch(source, /setInterval\(\(\) => \{\s*this\.fetchOrderBookSnapshots/);
assert.doesNotMatch(source, /connectSpotWs\(/);
assert.match(source, /fstream\.binancefuture\.com/);

console.log('PASS exchange market data safety helpers');
