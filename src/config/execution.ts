// src/config/execution.ts
import { ExecutionMode, getBinanceBaseUrl, getBinanceWsUrl, normalizeExecutionMode } from '../domain/types';

function readExecutionMode(): ExecutionMode {
  return normalizeExecutionMode(process.env.EXECUTION_MODE || process.env.VITE_EXECUTION_MODE);
}

const mode = readExecutionMode();
const isExchangeMode = mode === 'LIVE' || mode === 'TESTNET';

export const EXECUTION = Object.freeze({
  mode,
  restUrl: isExchangeMode ? getBinanceBaseUrl(mode) : '',
  wsUrl: isExchangeMode ? getBinanceWsUrl(mode) : '',
  apiKey: isExchangeMode ? (process.env.EXCHANGE_API_KEY || process.env.BINANCE_API_KEY || '') : '',
  apiSecret: isExchangeMode ? (process.env.EXCHANGE_API_SECRET || process.env.BINANCE_API_SECRET || '') : '',
});

export type { ExecutionMode };
