// src/config/execution.ts
export type ExecutionMode = 'LIVE' | 'TESTNET';

function readExecutionMode(): ExecutionMode {
  const envMode = process.env.EXECUTION_MODE?.toUpperCase() || process.env.VITE_EXECUTION_MODE?.toUpperCase();
  if (envMode === 'LIVE' || envMode === 'PRODUCTION') return 'LIVE';
  return 'TESTNET';
}

const mode = readExecutionMode();

export const EXECUTION = Object.freeze({
  apiKey: process.env.EXCHANGE_API_KEY || '',
  apiSecret: process.env.EXCHANGE_API_SECRET || '',
  mode,
  restUrl: mode === 'LIVE' ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com',
  wsUrl: mode === 'LIVE' ? 'wss://fstream.binance.com/private/ws' : 'wss://fstream.binancefuture.com/private/ws',
});
