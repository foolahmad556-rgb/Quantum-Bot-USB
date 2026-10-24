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

export interface MarketDataSourceFreshness {
  aggTrade: number;
  kline: number;
  depth: number;
}

const ENTRY_MARKET_DATA_MAX_AGE_MS = 15_000;
const MAX_BINANCE_STREAMS_PER_CONNECTION = 1024;
const MARKET_STREAMS_PER_SYMBOL = 2; // aggTrade + kline_1m
const MAX_MARKET_SYMBOLS_PER_CONNECTION = Math.floor(
  MAX_BINANCE_STREAMS_PER_CONNECTION / MARKET_STREAMS_PER_SYMBOL
);
const MAX_DEPTH_SYMBOLS_PER_CONNECTION = MAX_BINANCE_STREAMS_PER_CONNECTION;
const BINANCE_CONNECTION_ROTATION_MS = 23 * 60 * 60 * 1000 + 55 * 60 * 1000;

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
  private sourceFreshness: Map<AssetSymbol, MarketDataSourceFreshness> = new Map();
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
  private marketWs: WebSocket[] = [];
  private depthWs: WebSocket[] = [];
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
  private connectionRotationTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private reconnectInFlight = false;
  private livePollTimer: NodeJS.Timeout | null = null;
  private backfillInFlight = 0;
  private readonly pendingWarmupSymbols = new Set<AssetSymbol>();

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

  public getFreshPrice(symbol: AssetSymbol, maxAgeMs = 30_000): number | undefined {
    const price = this.currentPrices.get(symbol);
    const updatedAt = this.lastUpdateTimes.get(symbol);
    return price && Number.isFinite(price) && updatedAt && Date.now() - updatedAt <= maxAgeMs ? price : undefined;
  }

  public ensureSymbols(symbols: AssetSymbol[]): void {
    const combined = [...new Set([...this.activeCryptoSymbols, ...symbols])];
    const changed = this.syncSubscriptions(combined);
    if (changed && !this.isRunning) this.startStreaming(300, combined);
  }

  /**
   * Keep the live Binance subscriptions aligned with the pipeline's current universe.
   * The comparison is set-based so screener ordering changes do not reconnect streams.
   */
  public syncSubscriptions(symbols: AssetSymbol[]): boolean {
    const next = [...new Set(symbols.filter(s => s.endsWith('/USDT')))];
    const current = new Set(this.activeCryptoSymbols);
    const changed = next.length !== current.size || next.some(symbol => !current.has(symbol));
    if (!changed || next.length === 0) return false;
    if (!this.isRunning) {
      this.activeCryptoSymbols = next;
      return true;
    }
    if (this.reconnectInFlight) {
      this.activeCryptoSymbols = next;
      return true;
    }
    this.startStreaming(300, next);
    return true;
  }

  /**
   * Update live subscriptions and warm up symbols newly admitted by the screener.
   * Pending symbols remain ineligible for entries until their historical candles load.
   */
  public async syncSubscriptionsWithBackfill(symbols: AssetSymbol[]): Promise<boolean> {
    const next = [...new Set(symbols.filter(s => s.endsWith('/USDT')))];
    const current = new Set(this.activeCryptoSymbols);
    const added = next.filter(symbol => !current.has(symbol));
    const retry = [...this.pendingWarmupSymbols].filter(symbol => next.includes(symbol));
    for (const symbol of [...added, ...retry]) this.pendingWarmupSymbols.add(symbol);

    const changed = this.syncSubscriptions(next);
    const warmupTargets = [...new Set([...added, ...retry])];
    if (warmupTargets.length === 0) return changed;

    await this.backfillRealCandles(warmupTargets);
    let loaded = 0;
    for (const symbol of warmupTargets) {
      if ((this.candleHistory.get(symbol)?.length || 0) >= 100) {
        this.pendingWarmupSymbols.delete(symbol);
        loaded++;
      }
    }
    if (loaded < warmupTargets.length) {
      console.warn(`⚠️ ExchangeMarketData: ${warmupTargets.length - loaded} symbol warmups remain pending; entries stay blocked`);
    }
    return changed;
  }

  public getLastUpdateTime(symbol: AssetSymbol): number {
    return this.lastUpdateTimes.get(symbol) || 0;
  }

  public getSourceFreshness(symbol: AssetSymbol): MarketDataSourceFreshness {
    return { ...(this.sourceFreshness.get(symbol) || { aggTrade: 0, kline: 0, depth: 0 }) };
  }

  public isEntryMarketDataFresh(symbol: AssetSymbol, now: number = Date.now()): boolean {
    if (this.pendingWarmupSymbols.has(symbol)) return false;
    const freshness = this.getSourceFreshness(symbol);
    const book = this.orderBookBuilder.getBook(symbol);
    const tradeAge = now - freshness.aggTrade;
    const depthAge = now - freshness.depth;
    return freshness.aggTrade > 0 && freshness.depth > 0
      && tradeAge >= 0 && tradeAge <= ENTRY_MARKET_DATA_MAX_AGE_MS
      && depthAge >= 0 && depthAge <= ENTRY_MARKET_DATA_MAX_AGE_MS
      && !!book && now - book.timestamp >= 0 && now - book.timestamp <= ENTRY_MARKET_DATA_MAX_AGE_MS
      && Number.isFinite(book.bids?.[0]?.price) && book.bids[0].price > 0
      && Number.isFinite(book.asks?.[0]?.price) && book.asks[0].price > 0
      && book.asks[0].price > book.bids[0].price;
  }

  public getFreshOrderBook(symbol: AssetSymbol, now: number = Date.now()) {
    if (!this.isEntryMarketDataFresh(symbol, now)) return undefined;
    return this.orderBookBuilder.getBook(symbol);
  }

  private markSourceFresh(symbol: AssetSymbol, source: keyof MarketDataSourceFreshness, now: number): void {
    const freshness = this.sourceFreshness.get(symbol) || { aggTrade: 0, kline: 0, depth: 0 };
    freshness[source] = now;
    this.sourceFreshness.set(symbol, freshness);
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

    this.backfillInFlight++;
    try {
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
            this.emit('market_update', sym);
            console.log(`✅ ExchangeMarketData: Loaded ${candles.length} real candles for ${sym} (Latest Price: $${latestPrice})`);
          }
        } catch (err: any) {
          console.warn(`⚠️ ExchangeMarketData: Failed to backfill candles for ${sym}:`, err.message);
        }
      }
    } finally {
      this.backfillInFlight = Math.max(0, this.backfillInFlight - 1);
    }
  }

  public startStreaming(tickRateMs: number = 300, activeSymbols?: AssetSymbol[]) {
    if (activeSymbols && activeSymbols.length > 0) {
      const nextSymbols = activeSymbols.filter(s => s.endsWith('/USDT'));
      if (this.isRunning && this.reconnectInFlight) {
        this.activeCryptoSymbols = nextSymbols;
        return;
      }
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
    this.scheduleConnectionRotation();

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
        if (this.backfillInFlight > 0) return;
        this.emit('market_stale');
      }
    }, Math.max(tickRateMs, 1000));
  }

  public async fetchLiveRestPrices(): Promise<void> {
    const baseUrl = this.executionMode === 'TESTNET' ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
    const urls = [`${baseUrl}/fapi/v1/ticker/price`];
    // Futures price feed only: never fall back to Spot market.

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

  public getLatestFeedUpdate(): number {
    if (this.backfillInFlight > 0) return Date.now();
    return Math.max(0, ...this.activeCryptoSymbols.map(symbol => this.getLastUpdateTime(symbol)));
  }

  public reconnectStalledFeed(): void {
    if (!this.isRunning || this.backfillInFlight > 0 || this.reconnectInFlight) return;
    this.reconnectInFlight = true;
    this.stopStreaming();
    this.startStreaming();
  }

  private scheduleConnectionRotation(): void {
    if (this.connectionRotationTimer) clearTimeout(this.connectionRotationTimer);
    this.connectionRotationTimer = setTimeout(() => {
      this.connectionRotationTimer = null;
      if (!this.isRunning) return;
      console.log('🔄 ExchangeMarketData: Rotating Binance WebSocket connections before the 24-hour limit.');
      this.reconnectStalledFeed();
    }, BINANCE_CONNECTION_ROTATION_MS);
  }

  public stopStreaming() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const ws of this.marketWs) {
      try { ws.removeAllListeners('close'); ws.terminate(); } catch (e) {}
    }
    for (const ws of this.depthWs) {
      try { ws.removeAllListeners('close'); ws.terminate(); } catch (e) {}
    }
    this.marketWs = [];
    this.depthWs = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionRotationTimer) {
      clearTimeout(this.connectionRotationTimer);
      this.connectionRotationTimer = null;
    }
    console.log('🔴 ExchangeMarketData: Stopped.');
  }

  // --- Binance Live Multi-Stream Integration ---
  private startWebSocketStreaming() {
    const rawPairs = this.activeCryptoSymbols.map(s => s.replace('/', '').toLowerCase());
    if (rawPairs.length === 0) return;

    const baseWsHost = this.executionMode === 'TESTNET' ? 'wss://fstream.binancefuture.com' : 'wss://fstream.binance.com';

    const chunk = (items: string[], size: number): string[][] => {
      const groups: string[][] = [];
      for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
      return groups;
    };

    // Binance allows 1024 streams per connection: two market streams per symbol.
    const marketGroups = chunk(rawPairs, MAX_MARKET_SYMBOLS_PER_CONNECTION);
    marketGroups.forEach((group, index) => {
      const streams = group.flatMap(symbol => [`${symbol}@aggTrade`, `${symbol}@kline_1m`]).join('/');
      this.connectMarketWs(`${baseWsHost}/stream?streams=${streams}`, index);
    });

    // Depth uses one stream per symbol, so it has the full 1024-symbol capacity.
    const depthGroups = chunk(rawPairs, MAX_DEPTH_SYMBOLS_PER_CONNECTION);
    depthGroups.forEach((group, index) => {
      const streams = group.map(symbol => `${symbol}@depth10@100ms`).join('/');
      this.connectDepthWs(`${baseWsHost}/stream?streams=${streams}`, index);
    });

  }


  private connectMarketWs(url: string, index: number) {
    if (this.marketWs[index]) {
      try { this.marketWs[index].removeAllListeners('close'); this.marketWs[index].terminate(); } catch (e) {}
    }

    try {
      const ws = new WebSocket(url);
      this.marketWs[index] = ws;

      ws.on('open', () => {
        this.reconnectAttempt = 0;
        console.log(`✅ ExchangeMarketData: Connected to Binance Futures live trade & kline stream (group ${index + 1})`);
      });

      ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.reconnectInFlight = false;
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('❌ ExchangeMarketData: Error parsing market message', e);
        }
      });

      ws.on('close', () => {
        if (this.isRunning) {
          this.reconnectInFlight = false;
          console.log(`⚠️ ExchangeMarketData: Market WebSocket group ${index + 1} closed. Reconnecting in ${getReconnectDelay(this.reconnectAttempt)}ms...`);
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        console.warn(`⚠️ ExchangeMarketData: Market WebSocket group ${index + 1} warning:`, err.message);
      });
    } catch (err: any) {
      console.warn(`⚠️ ExchangeMarketData: Could not open market WS group ${index + 1}:`, err.message);
    }
  }

  private connectDepthWs(url: string, index: number) {
    if (this.depthWs[index]) {
      try { this.depthWs[index].removeAllListeners('close'); this.depthWs[index].terminate(); } catch (e) {}
    }

    try {
      const ws = new WebSocket(url);
      this.depthWs[index] = ws;

      ws.on('open', () => {
        console.log(`✅ ExchangeMarketData: Connected to Binance Futures live L2 depth stream (group ${index + 1})`);
      });

      ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.reconnectInFlight = false;
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('❌ ExchangeMarketData: Error parsing depth message', e);
        }
      });

      ws.on('close', () => {
        if (this.isRunning) {
          this.reconnectInFlight = false;
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        console.warn(`⚠️ ExchangeMarketData: Depth WebSocket group ${index + 1} warning:`, err.message);
      });
    } catch (err: any) {
      console.warn(`⚠️ ExchangeMarketData: Could not open depth WS group ${index + 1}:`, err.message);
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
        this.markSourceFresh(symbol, 'depth', Date.now());
        this.orderBookBuilder.update(symbol, bids, asks);
        this.emit('market_update', symbol);
      }
    }

    // 2. Candlestick Kline Update
    if (stream.includes('@kline') && data.k) {
      const receivedAt = Date.now();
      this.markSourceFresh(symbol, 'kline', receivedAt);
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
      this.lastUpdateTimes.set(symbol, receivedAt);

      this.emit('market_update', symbol);
      if (data.k.x) {
        this.emit('candle_close', symbol, candle);
      }
    }

    // 3. Trade Ticks Update
    if (stream.includes('@aggTrade')) {
      const receivedAt = Date.now();
      const tickPrice = parseFloat(data.p);
      const tickSize = parseFloat(data.q);
      const side = data.m ? 'sell' : 'buy';

      if (!Number.isFinite(tickPrice) || tickPrice <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) return;
      this.markSourceFresh(symbol, 'aggTrade', receivedAt);

      this.currentPrices.set(symbol, tickPrice);
      this.lastUpdateTimes.set(symbol, receivedAt);

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
      if (this.isRunning && !this.backfillInFlight && !this.reconnectInFlight) {
        this.reconnectInFlight = true;
        this.startWebSocketStreaming();
      }
    }, getReconnectDelay(this.reconnectAttempt++));
  }

}
