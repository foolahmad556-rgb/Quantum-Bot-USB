export function getFuturesEndpoints(mode: string) {
  if (!['TESTNET', 'LIVE', 'PAPER'].includes(mode)) throw new Error('Execution mode unavailable');
  return mode === 'TESTNET'
    ? { rest: 'https://testnet.binancefuture.com', websocket: 'wss://fstream.binancefuture.com' }
    : { rest: 'https://fapi.binance.com', websocket: 'wss://fstream.binance.com' };
}

export function readTickerSnapshot(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'tickers' in data && Array.isArray(data.tickers)) return data.tickers;
  return [];
}
