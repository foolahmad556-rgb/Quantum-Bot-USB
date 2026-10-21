import { binanceRateLimiter } from '../utils/RateLimiter';
import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface PositionData {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unRealizedProfit: number;
  positionSide: string;
  timestamp: number;
}

export interface AccountData {
  availableBalance?: number;
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  totalInitialMargin: number;
  totalMaintMargin: number;
  timestamp: number;
}

export class BinanceWebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;

  private lastPositionUpdate: PositionData[] = [];
  private hasPositionSnapshot = false;
  private lastAccountUpdate: AccountData | null = null;
  private isConnected = false;

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private baseUrl: string = 'https://fapi.binance.com'
  ) {
    super();
  }

  async connect(): Promise<void> {
    try {
      // 1. Get listen key from Binance
      this.listenKey = await this.getListenKey();
      console.log(`✅ WebSocket Listen Key obtained`);

      // 2. Connect to WebSocket stream
      const wsBaseUrl = this.baseUrl.includes('testnet.binancefuture.com')
        ? 'wss://stream.binancefuture.com/ws'
        : 'wss://fstream.binance.com/ws';
      const wsUrl = `${wsBaseUrl}/${this.listenKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log(`🟢 WebSocket connected`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connected');
      });

      this.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (e) {
          console.error(`❌ WebSocket parse error: ${e}`);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error(`❌ WebSocket error: ${error.message}`);
        this.emit('error', error);
      });

      this.ws.on('close', () => {
        console.warn(`⚠️ WebSocket disconnected`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.attemptReconnect();
      });

    } catch (e: any) {
      console.error(`❌ WebSocket connection failed: ${e.message}`);
      this.attemptReconnect();
    }
  }

  private handleMessage(message: any): void {
    // Account Update
    if (message.e === 'ACCOUNT_UPDATE') {
      const { a } = message;
      this.lastAccountUpdate = {
        totalWalletBalance: parseFloat(a.B?.[0]?.wb || '0'),
        totalUnrealizedProfit: parseFloat(a.P?.reduce((sum: number, p: any) => sum + parseFloat(p.up || 0), 0) || '0'),
        totalInitialMargin: parseFloat(a.M || '0'),
        totalMaintMargin: parseFloat(a.m || '0'),
        timestamp: Date.now()
      };
      this.emit('account', this.lastAccountUpdate);
      console.log(`💰 Account updated: $${this.lastAccountUpdate.totalWalletBalance.toFixed(2)}`);
    }

    // ACCOUNT_UPDATE carries futures position data in a.P. Binance pushes ONLY the symbols
    // changed by this event ("Position information of other symbols will no longer be pushed"),
    // so merge per symbol+side instead of replacing the cache; an empty P means no position
    // change at all (balance-only event) and must not wipe open positions.
    if (message.e === 'ACCOUNT_UPDATE') {
      const rawPositions = message.a?.P;
      if (!Array.isArray(rawPositions) || rawPositions.length === 0) return;
      const timestamp = Date.now();
      const merged = new Map<string, PositionData>();
      for (const p of this.lastPositionUpdate) merged.set(`${p.symbol}:${p.positionSide}`, p);
      for (const p of rawPositions) {
        if (typeof p?.s !== 'string' || !p.s || typeof p?.ps !== 'string') return;
        const positionAmt = Number(p.pa);
        const entryPrice = Number(p.ep);
        const unRealizedProfit = Number(p.up);
        if (!Number.isFinite(positionAmt) || !Number.isFinite(entryPrice) || !Number.isFinite(unRealizedProfit)) return;
        const key = `${p.s}:${p.ps}`;
        if (positionAmt === 0) {
          merged.delete(key);
        } else {
          merged.set(key, {
            symbol: p.s, positionAmt, entryPrice,
            markPrice: Number.isFinite(Number(p.mp)) ? Number(p.mp) : 0,
            unRealizedProfit, positionSide: p.ps, timestamp
          });
        }
      }
      this.lastPositionUpdate = [...merged.values()];
      this.hasPositionSnapshot = true;
      this.emit('positions', this.lastPositionUpdate);
      console.log(`📊 Positions updated: ${this.lastPositionUpdate.length} open`);
    }

    // Order Update
    if (message.e === 'ORDER_TRADE_UPDATE') {
      this.emit('order', message);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.renewListenKey();
      } catch (e) {
        console.error(`⚠️ Heartbeat failed: ${e}`);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async getListenKey(): Promise<string> {
    const res = await binanceRateLimiter.fetch(`${this.baseUrl}/fapi/v1/listenKey`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey }
    });
    const data = await res.json();
    return data.listenKey;
  }

  private async renewListenKey(): Promise<void> {
    if (!this.listenKey) return;
    const res = await binanceRateLimiter.fetch(`${this.baseUrl}/fapi/v1/listenKey`, {
      method: 'PUT',
      headers: { 'X-MBX-APIKEY': this.apiKey }
    });
    if (!res.ok) {
      throw new Error(`Failed to renew listen key: ${res.status}`);
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.error(`❌ Max reconnect attempts reached. Falling back to REST polling.`);
      this.emit('fallback');
    }
  }

  getPositions(): PositionData[] {
    return this.lastPositionUpdate;
  }

  getAccount(): AccountData | null {
    return this.lastAccountUpdate;
  }

  hasValidPositionSnapshot(): boolean {
    return this.hasPositionSnapshot;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.listenKey) {
      await binanceRateLimiter.fetch(`${this.baseUrl}/fapi/v1/listenKey`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': this.apiKey }
      }).catch(e => console.error(`Failed to delete listen key: ${e}`));
    }
  }
}
