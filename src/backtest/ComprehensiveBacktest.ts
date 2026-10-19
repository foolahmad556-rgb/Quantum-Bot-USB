import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Candle } from '../domain/types';
import { BacktestEngine } from './BacktestEngine';
import { validateCandles, validateDataManifest, type DataManifest } from './DataManifest';

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000, '1M': 2_592_000_000,
};

export interface ComprehensiveBacktestOptions {
  symbols: string[];
  timeframe: string;
  dataDir: string;
  initialCapital: number;
  outputDir: string;
}

export function parseBacktestArgs(args: string[]): ComprehensiveBacktestOptions {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values[key.slice(2)] = value;
  }
  const timeframe = values.timeframe || '1h';
  if (!(timeframe in TIMEFRAME_MS)) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const symbols = (values.symbols || 'BTCUSDT').split(',').map(s => s.trim().toUpperCase());
  if (symbols.some(s => !/^[A-Z0-9]{5,20}$/.test(s))) throw new Error('Invalid --symbols');
  const initialCapital = Number(values.capital ?? 10_000);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error('Invalid --capital: must be positive');
  return {
    symbols,
    timeframe,
    dataDir: values['data-dir'] || 'data/historical',
    initialCapital,
    outputDir: values['output-dir'] || 'data/backtest-runs',
  };
}

async function loadDataset(options: ComprehensiveBacktestOptions, symbol: string): Promise<Candle[]> {
  const directory = join(options.dataDir, `${symbol}_${options.timeframe}`);
  const [rawCandles, rawManifest] = await Promise.all([
    readFile(join(directory, 'candles.json'), 'utf8'),
    readFile(join(directory, 'manifest.json'), 'utf8'),
  ]);
  const candles: Candle[] = JSON.parse(rawCandles);
  const manifest: DataManifest = JSON.parse(rawManifest);
  if (!Array.isArray(candles) || candles.length === 0) throw new Error(`Empty/invalid dataset: ${symbol}`);
  const manifestCheck = validateDataManifest(manifest, candles);
  if (!manifestCheck.valid) throw new Error(`Manifest mismatch for ${symbol}: ${manifestCheck.errors.join('; ')}`);
  const candleCheck = validateCandles(candles, TIMEFRAME_MS[options.timeframe]);
  if (!candleCheck.valid) throw new Error(`Candle validation failed for ${symbol}: ${candleCheck.errors.slice(0, 10).join('; ')}`);
  if (manifest.symbol !== symbol || manifest.timeframe !== options.timeframe || !manifest.source.includes('Binance')) {
    throw new Error(`Manifest identity/source mismatch for ${symbol}`);
  }
  return candles;
}

export interface WalkForwardWindow {
  trainStart: number;
  testStart: number;
  testEnd: number;
}

/** Build non-overlapping rolling windows; return none when history cannot support full train + test periods. */
export function generateWalkForwardWindows(
  firstTimestamp: number,
  lastTimestamp: number,
  intervalMs: number,
  trainDays = 365,
  testDays = 90,
): WalkForwardWindow[] {
  if (![firstTimestamp, lastTimestamp, intervalMs, trainDays, testDays].every(Number.isFinite)
    || intervalMs <= 0 || trainDays <= 0 || testDays <= 0 || lastTimestamp < firstTimestamp) {
    throw new Error('Invalid walk-forward range or durations');
  }
  const trainMs = trainDays * 86_400_000;
  const testMs = testDays * 86_400_000;
  const endExclusive = lastTimestamp + intervalMs;
  const windows: WalkForwardWindow[] = [];
  for (let testStart = firstTimestamp + trainMs; testStart + testMs <= endExclusive; testStart += testMs) {
    windows.push({ trainStart: testStart - trainMs, testStart, testEnd: testStart + testMs });
  }
  return windows;
}

export async function runComprehensiveBacktest(options: ComprehensiveBacktestOptions): Promise<Record<string, unknown>> {
  const datasets = new Map<string, Candle[]>();
  const manifestHashes: Record<string, string> = {};
  for (const symbol of options.symbols) {
    const candles = await loadDataset(options, symbol);
    datasets.set(`${symbol.slice(0, -4)}/${symbol.slice(-4)}`, candles);
    const manifest = JSON.parse(await readFile(join(options.dataDir, `${symbol}_${options.timeframe}`, 'manifest.json'), 'utf8')) as DataManifest;
    manifestHashes[symbol] = manifest.sha256;
  }
  const reference = datasets.values().next().value as Candle[] | undefined;
  if (!reference?.length) throw new Error('No datasets loaded');
  const timelineBySymbol = new Map(
    [...datasets].map(([symbol, candles]) => [symbol, new Set(candles.map(c => c.timestamp))] as const),
  );
  const allTimestamps = [...new Set([...timelineBySymbol.values()].flatMap(timestamps => [...timestamps]))].sort((a, b) => a - b);
  const alignedTimestamps = allTimestamps.filter((timestamp, index) =>
    index === 0 || timestamp - allTimestamps[index - 1] === TIMEFRAME_MS[options.timeframe],
  ).filter(timestamp => [...timelineBySymbol.values()].every(timestamps => timestamps.has(timestamp)));
  if (alignedTimestamps.length < 2) throw new Error('Insufficient overlapping timestamps across loaded symbols');
  for (const [symbol, candles] of datasets) {
    const byTimestamp = new Map(candles.map(candle => [candle.timestamp, candle]));
    datasets.set(symbol, alignedTimestamps.map(timestamp => byTimestamp.get(timestamp)!).filter(Boolean));
  }
  const timestamps = [alignedTimestamps[0], alignedTimestamps[alignedTimestamps.length - 1]];
  const startDate = new Date(Math.min(...timestamps)).toISOString();
  const endDate = new Date(Math.max(...timestamps)).toISOString();
  const config = { symbols: [...datasets.keys()], startDate, endDate, initialCapital: options.initialCapital, commission: 0.0005, takerFeeBps: 5, slippage: 0.0005, candleIntervalMs: TIMEFRAME_MS[options.timeframe], timeframe: options.timeframe, solver: 'CLASSICAL_MARKOWITZ' as const, rebalanceFrequency: options.timeframe.toUpperCase() as '1H' };
  const engine = new BacktestEngine(config);
  const result = engine.runSync(datasets);
  const intervalMs = TIMEFRAME_MS[options.timeframe];
  const firstTimestamp = Math.min(...timestamps);
  const lastTimestamp = Math.max(...timestamps);
  const candidates = [{ entryZ: 1.2, maxHalfLife: 15 }, { entryZ: 1.5, maxHalfLife: 25 }, { entryZ: 1.8, maxHalfLife: 40 }, { entryZ: 2.2, maxHalfLife: 40 }];
  const walkForward: Array<Record<string, unknown>> = [];
  const windows = generateWalkForwardWindows(firstTimestamp, lastTimestamp, intervalMs);
  for (const { trainStart, testStart, testEnd } of windows) {
    const slice = (from: number, to: number) => new Map([...datasets].map(([symbol, candles]) => [symbol, candles.filter(c => c.timestamp >= from && c.timestamp < to)]));
    const train = slice(trainStart, testStart);
    const outSample = slice(testStart, testEnd);
    if ([...train.values()].some(c => c.length < 100) || [...outSample.values()].some(c => c.length < 100)) continue;
    let selected = candidates[0];
    let bestFitness = -Infinity;
    for (const candidate of candidates) {
      const trainResult = engine.runSync(train, candidate);
      const fitness = trainResult.sharpeRatio - Math.abs(trainResult.maxDrawdownPct) * 0.05;
      if (Number.isFinite(fitness) && fitness > bestFitness) { bestFitness = fitness; selected = candidate; }
    }
    const oos = engine.runSync(outSample, selected);
    walkForward.push({ trainStart: new Date(trainStart).toISOString(), trainEnd: new Date(testStart - intervalMs).toISOString(), testStart: new Date(testStart).toISOString(), testEnd: new Date(testEnd - intervalMs).toISOString(), parameters: selected, inSampleFitness: bestFitness, outOfSample: { totalReturnPct: oos.totalReturnPct, benchmarkReturnPct: oos.benchmarkReturnPct, maxDrawdownPct: oos.maxDrawdownPct, sharpeRatio: oos.sharpeRatio, trades: oos.totalTrades, fees: oos.totalFeesPaid } });
  }
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const wfoHash = createHash('sha256').update(JSON.stringify(walkForward)).digest('hex');
  
  let gitCommit = 'unknown';
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* report unknown outside a git checkout */ }
  const runIdentity = {
    runId: createHash('sha256').update(JSON.stringify({ configHash, manifestHashes, gitCommit })).digest('hex'),
    gitCommit,
    engine: 'BacktestEngine.runSync',
    configHash,
    dataHashes: manifestHashes,
    wfoHash,
    symbols: options.symbols,
    timeframe: options.timeframe,
    startDate,
    endDate,
    createdAt: new Date().toISOString(),
  };
  const report = { status: walkForward.length ? 'REVIEW_REQUIRED' : 'DRAFT', runIdentity, config, metrics: {
    totalReturnPct: result.totalReturnPct,
    annualizedReturnPct: result.annualizedReturnPct,
    benchmarkReturnPct: result.benchmarkReturnPct,
    maxDrawdownPct: result.maxDrawdownPct,
    sharpeRatio: result.sharpeRatio,
    sortinoRatio: result.sortinoRatio,
    winRatePct: result.winRatePct,
    profitFactor: result.profitFactor,
    totalTrades: result.totalTrades,
    totalFeesPaid: result.totalFeesPaid,
  }, datasetStats: Object.fromEntries([...datasets].map(([symbol, candles]) => [symbol, { count: candles.length, firstTimestamp: candles[0].timestamp, lastTimestamp: candles.at(-1)!.timestamp }])), walkForward, result, councilSummary: result.councilSummary || [] };
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = join(options.outputDir, `${runIdentity.runId}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Run ${runIdentity.runId} [${report.status}]`);
  console.log(`Data ${options.timeframe} | ${startDate} to ${endDate} | ${JSON.stringify(report.datasetStats)}`);
  console.log(`Return ${result.totalReturnPct.toFixed(4)}% | benchmark ${result.benchmarkReturnPct.toFixed(4)}% | max DD ${result.maxDrawdownPct.toFixed(4)}% | Sharpe ${result.sharpeRatio.toFixed(4)} | trades ${result.totalTrades} | fees ${result.totalFeesPaid.toFixed(4)}`);
  console.log(`Walk-forward: ${walkForward.length} non-overlapping 365d train / 90d test windows; status ${report.status}`);
  for (const [index, window] of walkForward.entries()) console.log(`OOS ${index + 1}: ${(window.outOfSample as Record<string, number>).totalReturnPct.toFixed(4)}% return, ${(window.outOfSample as Record<string, number>).benchmarkReturnPct.toFixed(4)}% benchmark, DD ${(window.outOfSample as Record<string, number>).maxDrawdownPct.toFixed(4)}%, Sharpe ${(window.outOfSample as Record<string, number>).sharpeRatio.toFixed(4)}, trades ${(window.outOfSample as Record<string, number>).trades}`);
  console.log(`Saved ${outputPath}`);
  return report;
}
