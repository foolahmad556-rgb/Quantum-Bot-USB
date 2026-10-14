/**
 * Basel Quantum Algorithmic Trading System
 * Unified Multi-Exchange Adapters
 * (Binance, Bybit, Coinbase, Mock Sandbox Engine)
 */

import { AssetSymbol, OrderBook, OrderSide, OrderType } from '../domain/types';

export interface ExchangeAdapter {
  exchangeId: 'BINANCE' | 'BYBIT' | 'COINBASE' | 'SANDBOX_MOCK';
  name: string;
  isTestnet: boolean;
  isConnected: boolean;
  pingMs: number;
  connect(apiKey?: string, secretKey?: string): Promise<boolean>;
  disconnect(): void;
  fetchOrderBook(symbol: AssetSymbol): Promise<Partial<OrderBook>>;
  placeOrder(orderParams: { symbol: AssetSymbol; side: OrderSide; type: OrderType; quantity: number; price?: number }): Promise<{ exchangeOrderId: string; status: string }>;
}

export class MockExchangeAdapter implements ExchangeAdapter {
  public exchangeId: 'BINANCE' | 'BYBIT' | 'COINBASE' | 'SANDBOX_MOCK';
  public name: string;
  public isTestnet: boolean;
  public isConnected: boolean = true;
  public pingMs: number = 18;

  constructor(exchangeId: 'BINANCE' | 'BYBIT' | 'COINBASE' | 'SANDBOX_MOCK' = 'SANDBOX_MOCK', isTestnet: boolean = true) {
      this.exchangeId = exchangeId;
      this.name = exchangeId === 'BINANCE' ? 'Binance Pro API v3' : exchangeId === 'BYBIT' ? 'Bybit Unified v5' : exchangeId === 'COINBASE' ? 'Coinbase Advanced' : 'Basel Ultra-Fast Mock Engine';
      this.isTestnet = isTestnet;
      // Deterministic hash-based ping calculation replacing Math.random()
      // Uses exchange ID and testnet flag as seed for reproducible timing
      const hash = (exchangeId.charCodeAt(0) * 31 + (isTestnet ? 1 : 0)) % 1000;
      this.pingMs = Math.floor((hash % 15) + 12);
    }

  public async connect(apiKey?: string, secretKey?: string): Promise<boolean> {
      this.isConnected = true;
      // Deterministic hash-based ping calculation replacing Math.random()
      // Uses exchange ID and testnet flag as seed for reproducible timing
      const hash = (this.exchangeId.charCodeAt(0) * 31 + (this.isTestnet ? 1 : 0)) % 1000;
      this.pingMs = Math.floor((hash % 12) + 8);
      return true;
    }

  public disconnect(): void {
    this.isConnected = false;
  }

  public async fetchOrderBook(symbol: AssetSymbol): Promise<Partial<OrderBook>> {
    return { symbol, timestamp: Date.now() };
  }

  public async placeOrder(orderParams: { symbol: AssetSymbol; side: OrderSide; type: OrderType; quantity: number; price?: number }): Promise<{ exchangeOrderId: string; status: string }> {
    return {
      exchangeOrderId: `EX_${this.exchangeId}_${Date.now()}`,
      status: 'ACKNOWLEDGED',
    };
  }
}
