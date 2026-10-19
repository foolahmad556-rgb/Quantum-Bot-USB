import { parseFetchOptions, runHistoricalFetch } from '../src/backtest/HistoricalDataFetch';

runHistoricalFetch(parseFetchOptions(process.argv.slice(2))).catch((error: unknown) => {
  console.error(`Historical data fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
