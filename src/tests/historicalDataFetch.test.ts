import assert from 'node:assert/strict';
import { parseBinanceKline, parseFetchOptions } from '../backtest/HistoricalDataFetch';

const candle = parseBinanceKline([1700000000000, '10', '12', '9', '11', '5', 1700003599999, '50', 7, '2', '20', '0']);
assert.deepEqual(candle, { timestamp: 1700000000000, open: 10, high: 12, low: 9, close: 11, volume: 5, vwap: 10 });
assert.throws(() => parseBinanceKline([1, 'x', '12', '9', '11', '5']), /invalid/i);
assert.throws(() => parseBinanceKline([1, '10', '8', '9', '11', '5']), /invalid/i);
const options = parseFetchOptions(['--symbols', 'BTCUSDT,ETHUSDT', '--interval', '1h', '--start', '2024-01-01', '--end', '2024-02-01', '--output', 'data/historical']);
assert.deepEqual(options.symbols, ['BTCUSDT', 'ETHUSDT']);
assert.equal(options.interval, '1h');
assert.equal(options.startTime, Date.parse('2024-01-01T00:00:00.000Z'));
assert.equal(options.endTime, Date.parse('2024-02-01T00:00:00.000Z'));
assert.equal(options.outputDir, 'data/historical');
assert.throws(() => parseFetchOptions(['--interval', '7m']), /interval/i);
console.log('historical data fetch tests passed');
