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
assert.match(source, /testnet\.binancefuture\.com/);
assert.match(source, /\$\{baseUrl\}\/fapi\/v1\/ticker\/price/);
assert.match(source, /\$\{baseUrl\}\/fapi\/v1\/klines/);
assert.doesNotMatch(source, /api\.binance\.com\/api\/v3\/ticker\/price/);
assert.doesNotMatch(source, /https:\/\/fapi\.binance\.com\/fapi\/v1\/ticker\/price/);

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
assert.equal(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).kline, 0, 'historical candles must not count as live kline freshness');
assert.equal(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).aggTrade, 0, 'historical candles must not count as live trade freshness');
assert.equal(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).depth, 0, 'historical candles must not count as live depth freshness');

const bookBeforeDepth = marketData.getOrderBookBuilder().getBook('ETH/USDT' as AssetSymbol);
assert.equal(bookBeforeDepth, undefined, 'historical candle backfill must not fabricate an order book');
(marketData as any).handleWebSocketMessage({
  stream: 'ethusdt@depth10@100ms',
  data: { s: 'ETHUSDT', b: [['10', '2']], a: [['11', '3']] }
});
assert.ok(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).depth > 0, 'depth receipt must refresh depth source only');
assert.equal(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).aggTrade, 0, 'depth receipt must not refresh aggTrade');
assert.equal(marketData.getSourceFreshness('ETH/USDT' as AssetSymbol).kline, 0, 'depth receipt must not refresh kline');
assert.equal(marketData.getLastUpdateTime('ETH/USDT' as AssetSymbol), 0, 'depth receipt must not refresh price freshness');
assert.equal(marketData.isEntryMarketDataFresh('ETH/USDT' as AssetSymbol), false, 'depth alone must not permit entry');
(marketData as any).handleWebSocketMessage({
  stream: 'ethusdt@aggTrade',
  data: { s: 'ETHUSDT', p: '10.5', q: '1', m: false, T: Date.now(), a: 1 }
});
assert.ok(marketData.isEntryMarketDataFresh('ETH/USDT' as AssetSymbol), 'live trade plus live depth permits entry');
assert.ok(marketData.getOrderBookBuilder().getBook('ETH/USDT' as AssetSymbol), 'live depth creates real order book');
marketData.stopStreaming();

const pipelineSource = await (await import('node:fs/promises')).readFile(new URL('../app/TradingPipeline.ts', import.meta.url), 'utf8');
assert.doesNotMatch(pipelineSource, /this\.killSwitch\.trigger\(\s*'HARD_HALT',[\s\S]{0,160}market data stale/i, 'one stale symbol must not globally halt or cancel healthy-symbol activity');
assert.match(pipelineSource, /isEntryMarketDataFresh\(order\.symbol\)/, 'entry gate must enforce per-symbol real-feed and depth freshness');
assert.match(pipelineSource, /getFreshOrderBook\(order\.symbol\)/, 'entry validation must require fresh real order book');
assert.match(pipelineSource, /stale market data.*symbol/i, 'stale symbol recovery must be logged with symbol and reason');

assert.deepEqual(marketData.getInsufficientHistory(), ['BTC/USDT', 'ETH/USDT'], 'report symbols below required history');
assert.deepEqual(marketData.getCandles('BTC/USDT' as AssetSymbol), [], 'failure must not create candle data');

console.log('PASS exchange market data safety and backfill');
