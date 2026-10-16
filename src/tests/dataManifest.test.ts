import assert from 'node:assert/strict';
import { createDataManifest, validateDataManifest, validateCandles } from '../backtest/DataManifest';
import type { Candle } from '../domain/types';

const candles: Candle[] = [
  { timestamp: 1_700_000_000_000, open: 100, high: 105, low: 95, close: 102, volume: 10, vwap: 101 },
  { timestamp: 1_700_003_600_000, open: 102, high: 106, low: 99, close: 104, volume: 12, vwap: 103 },
];

const manifest = createDataManifest({ symbol: 'BTC/USDT', timeframe: '1h', candles, source: 'fixture' });
assert.equal(manifest.symbol, 'BTC/USDT');
assert.equal(manifest.timeframe, '1h');
assert.equal(manifest.candleCount, 2);
assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(validateCandles(candles, 3_600_000), { valid: true, errors: [] });
assert.deepEqual(validateDataManifest(manifest, candles), { valid: true, errors: [] });

const changed = [...candles, { ...candles[1], timestamp: 1_700_007_200_000 }];
assert.equal(validateDataManifest(manifest, changed).valid, false);
assert.match(validateDataManifest(manifest, changed).errors.join(' '), /hash|count/i);
assert.equal(validateCandles([candles[0], { ...candles[1], timestamp: candles[0].timestamp }], 3_600_000).valid, false);
assert.equal(validateCandles([{ ...candles[0], high: 90 }, candles[1]], 3_600_000).valid, false);
assert.equal(validateCandles([{ ...candles[0], volume: -1 }, candles[1]], 3_600_000).valid, false);
assert.equal(validateCandles([candles[0], { ...candles[1], timestamp: candles[1].timestamp + 7_200_000 }], 3_600_000).valid, false);

console.log('data manifest tests passed');
