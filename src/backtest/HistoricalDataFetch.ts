import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candle } from '../domain/types';
import { binanceRateLimiter } from '../utils/RateLimiter';
import { createDataManifest, validateCandles } from './DataManifest';

const INTERVALS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000, '1M': 2_592_000_000,
};

export interface FetchOptions {
  symbols: string[];
  interval: string;
  startTime: number;
  endTime: number;
  outputDir: string;
}

export function parseBinanceKline(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 6) throw new Error('Invalid Binance kline row');
  const timestamp = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  const quoteVolume = row.length > 7 ? Number(row[7]) : NaN;
  const candle: Candle = {
    timestamp, open, high, low, close, volume,
    vwap: Number.isFinite(quoteVolume) && volume > 0 ? quoteVolume / volume : (open + high + low + close) / 4,
  };
  const values = [timestamp, open, high, low, close, volume, candle.vwap];
  if (!values.every(Number.isFinite) || timestamp <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close)) {
    throw new Error('Invalid numeric or OHLC values in Binance kline');
  }
  return candle;
}

export function parseFetchOptions(args: string[]): FetchOptions {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values[key.slice(2)] = value;
  }
  const interval = values.interval || '1h';
  if (!(interval in INTERVALS)) throw new Error(`Unsupported interval: ${interval}`);
  const symbols = (values.symbols || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim().toUpperCase());
  if (!symbols.length || symbols.some(s => !/^[A-Z0-9]{5,20}$/.test(s))) throw new Error('Invalid --symbols; use comma-separated Binance symbols such as BTCUSDT');
  const parseDate = (raw: string | undefined, fallback: number, label: string): number => {
    if (!raw) return fallback;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00.000Z`) : Date.parse(raw);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid --${label} date`);
    return parsed;
  };
  const endTime = parseDate(values.end, Date.now(), 'end');
  const startTime = parseDate(values.start, endTime - 365 * 86_400_000, 'start');
  if (startTime >= endTime) throw new Error('--start must be earlier than --end');
  const outputDir = values.output || 'data/historical';
  return { symbols, interval, startTime, endTime, outputDir };
}

export async function fetchHistoricalCandles(options: FetchOptions, symbol: string): Promise<Candle[]> {
  const intervalMs = INTERVALS[options.interval];
  if (!intervalMs) throw new Error(`Unsupported interval: ${options.interval}`);
  const candles: Candle[] = [];
  let cursor = options.startTime;
  while (cursor < options.endTime) {
    const url = new URL('https://api.binance.com/api/v3/klines');
    url.search = new URLSearchParams({ symbol, interval: options.interval, startTime: String(cursor), endTime: String(options.endTime - 1), limit: '1000' }).toString();
    const response = await binanceRateLimiter.fetch(url);
    if (!response.ok) throw new Error(`Binance klines request failed (${response.status}) for ${symbol}: ${(await response.text()).slice(0, 300)}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error(`Unexpected Binance response for ${symbol}`);
    if (rows.length === 0) break;
    const page = rows.map(parseBinanceKline);
    const last = page[page.length - 1];
    if (last.timestamp < cursor) throw new Error(`Binance pagination did not advance for ${symbol}`);
    candles.push(...page.filter(c => c.timestamp >= options.startTime && c.timestamp < options.endTime));
    cursor = last.timestamp + intervalMs;
  }
  const unique = new Map<number, Candle>();
  for (const candle of candles) unique.set(candle.timestamp, candle);
  const result = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (result.length === 0) throw new Error(`Binance returned no candles for ${symbol} in requested range`);
  const validation = validateCandles(result, intervalMs);
  if (!validation.valid) throw new Error(`Historical data validation failed for ${symbol}: ${validation.errors.slice(0, 10).join('; ')}`);
  return result;
}

export async function saveHistoricalDataset(options: FetchOptions, symbol: string, candles: Candle[]): Promise<void> {
  const directory = join(options.outputDir, `${symbol}_${options.interval}`);
  await mkdir(directory, { recursive: true });
  const manifest = createDataManifest({ symbol, timeframe: options.interval, candles, source: 'Binance Spot REST API (api.binance.com)' });
  await writeFile(join(directory, 'candles.json'), `${JSON.stringify(candles)}\n`, 'utf8');
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function runHistoricalFetch(options: FetchOptions): Promise<void> {
  for (const symbol of options.symbols) {
    const candles = await fetchHistoricalCandles(options, symbol);
    await saveHistoricalDataset(options, symbol, candles);
    console.log(`${symbol} ${options.interval}: saved ${candles.length} candles (${new Date(candles[0].timestamp).toISOString()} – ${new Date(candles[candles.length - 1].timestamp).toISOString()})`);
  }
}
