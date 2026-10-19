import assert from 'node:assert/strict';
import { buildFuturesCombinedStreamUrl, ExchangeMarketData, getReconnectDelay } from '../market-data/ExchangeMarketData';
import type { AssetSymbol } from '../domain/types';

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

const marketData = new ExchangeMarketData(undefined, ['BTC/USDT', 'ETH/USDT'] as AssetSymbol[]);
const oldFetch = globalThis.fetch;
const requested: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requested.push(url);
  if (url.includes('BTCUSDT')) return new Response('unavailable', { status: 503 });
  return new Response(JSON.stringify([
    [60_000, '10', '12', '9', '11', '4', 119_000, '440', 3, '1', '100', '0']
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
try {
  await marketData.backfillRealCandles(['BTC/USDT', 'ETH/USDT'] as AssetSymbol[]);
} finally {
  globalThis.fetch = oldFetch;
}
assert.equal(requested.length, 2, 'failed symbol must not stop later symbol backfill');
assert.equal(marketData.getCandles('ETH/USDT' as AssetSymbol)[0]?.timestamp, 60_000);
assert.equal(marketData.getCandles('ETH/USDT' as AssetSymbol)[0]?.vwap, 110);
assert.equal(marketData.getLastUpdateTime('BTC/USDT' as AssetSymbol), 0, 'failed backfill must not mark symbol fresh');
assert.deepEqual(marketData.getInsufficientHistory(), ['BTC/USDT', 'ETH/USDT'], 'report symbols below required history');
assert.deepEqual(marketData.getCandles('BTC/USDT' as AssetSymbol), [], 'failure must not create candle data');

console.log('PASS exchange market data safety and backfill');
