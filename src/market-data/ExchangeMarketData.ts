import { binanceRateLimiter } from '../utils/RateLimiter';
/**
 * Basel Quantum Algorithmic Trading System
 * Exchange Market Data Stream & Synthetic/Live Data Bridge
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { AssetSymbol, Candle, ExecutionMode, Tick, getBinanceWsUrl, normalizeExecutionMode } from '../domain/types';
import { OrderBookBuilder } from './OrderBookBuilder';
import { mulberry32 } from '../utils/seededRng';


export function buildFuturesCombinedStreamUrl(symbols: AssetSymbol[]): string {
  const streams = symbols.filter(s => s.endsWith('/USDT')).map(s => `${s.replace('/', '').toLowerCase()}@aggTrade`).join('/');
  return `wss://fstream.binance.com/stream?streams=${streams}`;
}

export function getReconnectDelay(attempt: number): number {
  return Math.min(60_000, 5_000 * (2 ** Math.max(0, attempt)));
}

export interface SymbolConfig {
  symbol: AssetSymbol;
  tickSize: number;
  lotSize: number;
}

export const DEFAULT_SYMBOLS: Record<AssetSymbol, SymbolConfig> = {
  'BTC/USDT': {
    symbol: 'BTC/USDT',

    tickSize: 0.1,
    lotSize: 0.001,
  },
  'ETH/USDT': {
    symbol: 'ETH/USDT',

    tickSize: 0.01,
    lotSize: 0.01,
  },
  'SOL/USDT': {
    symbol: 'SOL/USDT',

    tickSize: 0.01,
    lotSize: 0.1,
  },
  'XRP/USDT': {
    symbol: 'XRP/USDT' as AssetSymbol,

    tickSize: 0.0001,
    lotSize: 1,
  },
  'AVAX/USDT': {
    symbol: 'AVAX/USDT' as AssetSymbol,

    tickSize: 0.01,
    lotSize: 0.1,
  },
  'ADA/USDT': {
    symbol: 'ADA/USDT' as AssetSymbol,
    tickSize: 0.0001,
    lotSize: 1,
  },
  'BNB/USDT': {
    symbol: 'BNB/USDT' as AssetSymbol,
    tickSize: 0.01,
    lotSize: 0.01,
  },
  'DOGE/USDT': {
    symbol: 'DOGE/USDT' as AssetSymbol,
    tickSize: 0.0001,
    lotSize: 1,
  },
  'QNT/USDT': {
    symbol: 'QNT/USDT',
    tickSize: 0.01,
    lotSize: 0.1,
  },
  'NVDA/USD': {
    symbol: 'NVDA/USD',
    tickSize: 0.01,
    lotSize: 1,
  },
  'AAPL/USD': {
    symbol: 'AAPL/USD',
    tickSize: 0.01,
    lotSize: 1,
  },
  'PEPE/USDT': {
    symbol: 'PEPE/USDT',
    tickSize: 0.00000001,
    lotSize: 1000,
  },
  'SUI/USDT': {
    symbol: 'SUI/USDT',
    tickSize: 0.0001,
    lotSize: 1,
  },
  'NEAR/USDT': {
    symbol: 'NEAR/USDT',
    tickSize: 0.001,
    lotSize: 0.1,
  },
  'RENDER/USDT': {
    symbol: 'RENDER/USDT',
    tickSize: 0.001,
    lotSize: 0.1,
  },
};

export class ExchangeMarketData extends EventEmitter {
  private currentPrices: Map<AssetSymbol, number> = new Map();
  private lastUpdateTimes: Map<AssetSymbol, number> = new Map();
  private hawkesIntensity: Map<AssetSymbol, number> = new Map();
  private candleHistory: Map<AssetSymbol, Candle[]> = new Map();
  private orderBookBuilder: OrderBookBuilder;
  private tickListeners: Set<(tick: Tick) => void> = new Set();

  // Health heartbeat only; never creates market data.
  private intervalId: any = null;
  private isRunning: boolean = false;
  private tradeCounter: number = 0;
  private rng: () => number = mulberry32(0x7ade);

  // Live WebSocket variables
  private marketWs: WebSocket | null = null;
  private depthWs: WebSocket | null = null;
  private executionMode: string;
  private activeCryptoSymbols: AssetSymbol[] = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'AVAX/USDT',
    'ADA/USDT',
    'BNB/USDT',
    'DOGE/USDT',
    'QNT/USDT',
    'PEPE/USDT',
    'SUI/USDT',
    'NEAR/USDT',
    'RENDER/USDT',
  ];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private livePollTimer: NodeJS.Timeout | null = null;

  constructor(orderBookBuilder?: OrderBookBuilder, activeSymbols?: AssetSymbol[]) {
    super();
    this.orderBookBuilder = orderBookBuilder || new OrderBookBuilder(10);
    const hasApiKey = !!process.env.EXCHANGE_API_KEY;
    this.executionMode = normalizeExecutionMode(process.env.EXECUTION_MODE, hasApiKey);
    if (activeSymbols && activeSymbols.length > 0) {
      this.activeCryptoSymbols = activeSymbols.filter(s => s.endsWith('/USDT'));
    }
    this.initializeState();
  }

  private initializeState() {
    for (const [symbol, config] of Object.entries(DEFAULT_SYMBOLS) as [AssetSymbol, SymbolConfig][]) {
      this.hawkesIntensity.set(symbol, 1.0);
      // No synthetic price/order book initialization. Binance data must arrive first.
      // Candle history populated exclusively via Binance REST/WebSocket.
      this.candleHistory.set(symbol, []);
    }
  }

  public getOrderBookBuilder(): OrderBookBuilder {
    return this.orderBookBuilder;
  }

  public getPrice(symbol: AssetSymbol): number {
    const price = this.currentPrices.get(symbol);
    if (!price || !Number.isFinite(price)) throw new Error(`No live Binance price available for ${symbol}`);
    return price;
  }

  public getLastUpdateTime(symbol: AssetSymbol): number {
    return this.lastUpdateTimes.get(symbol) || 0;
  }

  public getAllPrices(): Record<AssetSymbol, number> {
    const res: Partial<Record<AssetSymbol, number>> = {};
    for (const [sym, price] of this.currentPrices.entries()) {
      res[sym] = price;
    }
    return res as Record<AssetSymbol, number>;
  }

  public getCandles(symbol: AssetSymbol): Candle[] {
    return this.candleHistory.get(symbol) || [];
  }

  public getInsufficientHistory(minimumCandles: number = 100): AssetSymbol[] {
    return this.activeCryptoSymbols.filter(symbol => (this.candleHistory.get(symbol)?.length || 0) < minimumCandles);
  }

  public subscribeTicks(listener: (tick: Tick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  public async backfillRealCandles(symbols?: AssetSymbol[]): Promise<void> {
    const targetSymbols = (symbols && symbols.length > 0 ? symbols : this.activeCryptoSymbols)
      .filter(s => s.endsWith('/USDT'));
    const baseUrl = this.executionMode === 'TESTNET' ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';

    const primarySymbols = targetSymbols;
    console.log(`📥 ExchangeMarketData: Backfilling real historical candles for ${primarySymbols.length} pairs (${primarySymbols.slice(0, 6).join(', ')}...)...`);

    for (const sym of primarySymbols) {
      const binanceSym = sym.replace('/', '').toUpperCase();
      try {
        const res = await binanceRateLimiter.fetch(`${baseUrl}/fapi/v1/klines?symbol=${binanceSym}&interval=1m&limit=100`);
        if (!res.ok) {
          console.warn(`⚠️ ExchangeMarketData: Could not fetch candles for ${sym}: HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const candles: Candle[] = data.map((k: any) => ({
            timestamp: Number(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            vwap: parseFloat(k[7]) > 0 && parseFloat(k[5]) > 0 ? parseFloat(k[7]) / parseFloat(k[5]) : parseFloat(k[4])
          }));
          this.candleHistory.set(sym, candles);
          const latestPrice = candles[candles.length - 1].close;
          this.currentPrices.set(sym, latestPrice);
          this.lastUpdateTimes.set(sym, Date.now());
          this.orderBookBuilder.initialize(sym, latestPrice);
          this.emit('market_update', sym);
          console.log(`✅ ExchangeMarketData: Loaded ${candles.length} real candles for ${sym} (Latest Price: $${latestPrice})`);
        }
      } catch (err: any) {
        console.warn(`⚠️ ExchangeMarketData: Failed to backfill candles for ${sym}:`, err.message);
      }
    }
  }

  public startStreaming(tickRateMs: number = 300, activeSymbols?: AssetSymbol[]) {
    if (activeSymbols && activeSymbols.length > 0) {
      const nextSymbols = activeSymbols.filter(s => s.endsWith('/USDT'));
      if (this.isRunning && nextSymbols.join('|') !== this.activeCryptoSymbols.join('|')) {
        this.stopStreaming();
      }
      this.activeCryptoSymbols = nextSymbols;
    }
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`🌐 ExchangeMarketData: Starting live Binance real-time data engine for ${this.activeCryptoSymbols.join(', ')}...`);


    // Historical candles are backfilled by TradingPipeline before streaming starts.
    // Avoid repeating REST klines requests every time the WebSocket reconnects.

    // Start WebSocket real-time streams
    this.startWebSocketStreaming();

    // 5. Fallback heartbeat timer: keeps system health metrics alive
    this.intervalId = setInterval(() => {
      const now = Date.now();
      let hasLiveFeed = false;
      for (const sym of this.activeCryptoSymbols) {
        const lastUp = this.lastUpdateTimes.get(sym) || 0;
        if (now - lastUp < 10000) {
          hasLiveFeed = true;
          break;
        }
      }
      if (!hasLiveFeed) {
        this.emit('market_stale');
      }
    }, Math.max(tickRateMs, 1000));
  }

  public async fetchLiveRestPrices(): Promise<void> {
    const urls = [
      'https://fapi.binance.com/fapi/v1/ticker/price',
      'https://api.binance.com/api/v3/ticker/price'
    ];

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await binanceRateLimiter.fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data)) continue;

        const priceMap = new Map<string, number>();
        for (const item of data) {
          if (item.symbol && item.price) {
            priceMap.set(item.symbol.toUpperCase(), parseFloat(item.price));
          }
        }

        const now = Date.now();
        for (const sym of this.activeCryptoSymbols) {
          const rawBinance = sym.replace('/', '').toUpperCase();
          const p = priceMap.get(rawBinance);
          if (p && p > 0) {
            const oldPrice = this.currentPrices.get(sym) || p;
            this.currentPrices.set(sym, p);
            this.lastUpdateTimes.set(sym, now);


            const book = this.orderBookBuilder.getBook(sym);
            // REST ticker is price-only. Do not fabricate trade size, side, or order-book depth.
            if (!book || book.bids.length === 0) continue;
            this.emit('market_update', sym);
          }
        }

        // Successfully updated from real exchange
        return;
      } catch (err) {
        // Try next URL fallback
      }
    }
  }

  public async fetchOrderBookSnapshots(): Promise<void> {
    const symbolsToFetch = this.activeCryptoSymbols.slice(0, 4);
    for (const sym of symbolsToFetch) {
      const rawBinance = sym.replace('/', '').toUpperCase();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await binanceRateLimiter.fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${rawBinance}&limit=10`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) continue;
        const data = await res.json();
        if (data.bids && data.asks) {
          this.orderBookBuilder.update(sym, data.bids, data.asks);
          this.emit('market_update', sym);
        }
      } catch {
        // Non-blocking
      }
    }
  }

  public stopStreaming() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.marketWs) {
      this.marketWs.close();
      this.marketWs = null;
    }
    if (this.depthWs) {
      this.depthWs.close();
      this.depthWs = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    console.log('🔴 ExchangeMarketData: Stopped.');
  }

  // --- Binance Live Multi-Stream Integration ---
  private startWebSocketStreaming() {
    const rawPairs = this.activeCryptoSymbols.map(s => s.replace('/', '').toLowerCase());
    if (rawPairs.length === 0) return;

    const baseWsHost = this.executionMode === 'TESTNET' ? 'wss://fstream.binancefuture.com' : 'wss://fstream.binance.com';

    // 1. Regular market data streams: aggTrade & kline_1m
    const marketStreams = rawPairs.flatMap(symbol => [
      `${symbol}@aggTrade`,
      `${symbol}@kline_1m`
    ]).join('/');
    const marketUrl = `${baseWsHost}/stream?streams=${marketStreams}`;

    // 2. High-frequency OrderBook depth stream: depth10@100ms
    const depthStreams = rawPairs.map(symbol => `${symbol}@depth10@100ms`).join('/');
    const depthUrl = `${baseWsHost}/stream?streams=${depthStreams}`;

    this.connectMarketWs(marketUrl);
    this.connectDepthWs(depthUrl);

  }


  private connectMarketWs(url: string) {
    if (this.marketWs) {
      try { this.marketWs.close(); } catch (e) {}
    }

    try {
      this.marketWs = new WebSocket(url);

      this.marketWs.on('open', () => {
        this.reconnectAttempt = 0;
        console.log(`✅ ExchangeMarketData: Connected to Binance Futures live trade & kline stream`);
      });

      this.marketWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('❌ ExchangeMarketData: Error parsing market message', e);
        }
      });

      this.marketWs.on('close', () => {
        if (this.isRunning) {
          console.log(`⚠️ ExchangeMarketData: Market WebSocket closed. Reconnecting in ${getReconnectDelay(this.reconnectAttempt)}ms...`);
          this.scheduleReconnect();
        }
      });

      this.marketWs.on('error', (err) => {
        console.warn('⚠️ ExchangeMarketData: Market WebSocket warning:', err.message);
      });
    } catch (err: any) {
      console.warn('⚠️ ExchangeMarketData: Could not open market WS:', err.message);
    }
  }

  private connectDepthWs(url: string) {
    if (this.depthWs) {
      try { this.depthWs.close(); } catch (e) {}
    }

    try {
      this.depthWs = new WebSocket(url);

      this.depthWs.on('open', () => {
        console.log(`✅ ExchangeMarketData: Connected to Binance Futures live L2 depth stream`);
      });

      this.depthWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('❌ ExchangeMarketData: Error parsing depth message', e);
        }
      });

      this.depthWs.on('close', () => {
        if (this.isRunning) {
          this.scheduleReconnect();
        }
      });

      this.depthWs.on('error', (err) => {
        console.warn('⚠️ ExchangeMarketData: Depth WebSocket warning:', err.message);
      });
    } catch (err: any) {
      console.warn('⚠️ ExchangeMarketData: Could not open depth WS:', err.message);
    }
  }

  private handleWebSocketMessage(msg: any) {
    const stream = msg.stream;
    const data = msg.data;

    if (!stream || !data) return;

    // Convert raw Binance symbol (e.g. BTCUSDT) to System Symbol (BTC/USDT)
    const rawSym = data.s || (data.k && data.k.s);
    if (!rawSym) return;
    const symbol = this.toSystemSymbol(rawSym);

    // 1. OrderBook L2 Depth Update
    if (stream.includes('@depth')) {
      const bids = data.b || data.bids;
      const asks = data.a || data.asks;
      if (bids && asks) {
        this.orderBookBuilder.update(symbol, bids, asks);
        this.emit('market_update', symbol);
      }
    }

    // 2. Candlestick Kline Update
    if (stream.includes('@kline') && data.k) {
      const candle: Candle = {
        timestamp: data.k.t,
        open: parseFloat(data.k.o),
        high: parseFloat(data.k.h),
        low: parseFloat(data.k.l),
        close: parseFloat(data.k.c),
        volume: parseFloat(data.k.v),
        vwap: parseFloat(data.k.V) > 0 && parseFloat(data.k.v) > 0
          ? parseFloat(data.k.V) / parseFloat(data.k.v)
          : parseFloat(data.k.c)
      };

      if (!this.candleHistory.has(symbol)) {
        this.candleHistory.set(symbol, []);
      }
      const candlesArr = this.candleHistory.get(symbol)!;
      const lastCandle = candlesArr[candlesArr.length - 1];

      if (lastCandle && lastCandle.timestamp === candle.timestamp) {
        candlesArr[candlesArr.length - 1] = candle;
      } else {
        candlesArr.push(candle);
        if (candlesArr.length > 120) candlesArr.shift();
      }

      this.currentPrices.set(symbol, candle.close);
      this.lastUpdateTimes.set(symbol, Date.now());

      this.emit('market_update', symbol);
      if (data.k.x) {
        this.emit('candle_close', symbol, candle);
      }
    }

    // 3. Trade Ticks Update
    if (stream.includes('@aggTrade')) {
      const tickPrice = parseFloat(data.p);
      const tickSize = parseFloat(data.q);
      const side = data.m ? 'sell' : 'buy';

      this.currentPrices.set(symbol, tickPrice);
      this.lastUpdateTimes.set(symbol, Date.now());

      const tick: Tick = {
        symbol,
        price: tickPrice,
        size: tickSize,
        side,
        timestamp: data.T,
        tradeId: data.a ? data.a.toString() : `TICK-${Date.now()}`
      };

      // Trigger listeners
      this.tickListeners.forEach((fn) => fn(tick));

      this.emit('market_update', symbol);
    }
  }

  private toSystemSymbol(binanceSymbol: string): AssetSymbol {
    const upper = binanceSymbol.toUpperCase();
    if (upper.endsWith('USDT')) {
      return `${upper.slice(0, -4)}/USDT` as AssetSymbol;
    }
    if (upper.endsWith('BUSD')) {
      return `${upper.slice(0, -4)}/BUSD` as AssetSymbol;
    }
    if (upper.endsWith('USD')) {
      return `${upper.slice(0, -3)}/USD` as AssetSymbol;
    }
    return upper as AssetSymbol;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        this.startWebSocketStreaming();
      }
    }, getReconnectDelay(this.reconnectAttempt++));
  }

}
