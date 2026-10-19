import { parseBacktestArgs, runComprehensiveBacktest } from '../src/backtest/ComprehensiveBacktest';

try {
  await runComprehensiveBacktest(parseBacktestArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`Backtest failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
