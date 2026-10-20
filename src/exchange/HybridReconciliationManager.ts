import { binanceRateLimiter } from '../utils/RateLimiter';
import { BinanceWebSocketManager, PositionData, AccountData } from './BinanceWebSocketManager';
import crypto from 'crypto';

export class HybridReconciliationManager {
  private wsManager: BinanceWebSocketManager;
  private lastRestFallback: number = 0;
  private restFallbackInterval = 60000; // 60 seconds
  private failureCount = 0;
  private maxFailures = 3;

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private baseUrl: string = 'https://fapi.binance.com'
  ) {
    this.wsManager = new BinanceWebSocketManager(apiKey, apiSecret, baseUrl);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wsManager.on('connected', () => {
      console.log(`✅ WebSocket connected - using real-time data`);
      this.failureCount = 0;
    });

    this.wsManager.on('error', (error: Error) => {
      console.error(`⚠️ WebSocket error: ${error.message}`);
      this.failureCount++;
    });

    this.wsManager.on('fallback', async () => {
      console.warn(`⚠️ WebSocket unreliable - falling back to REST polling`);
      await this.triggerRestFallback().catch(error => console.warn(`Reconciliation unavailable: ${error.message}`));
    });

    this.wsManager.on('account', (data: AccountData) => {
      console.log(`💰 [WS] Account: $${data.totalWalletBalance.toFixed(2)}`);
    });

    this.wsManager.on('positions', (data: PositionData[]) => {
      console.log(`📊 [WS] Positions: ${data.length} open`);
    });
  }

  async start(): Promise<void> {
    try {
      console.log(`🚀 Starting Hybrid Reconciliation (WebSocket + REST fallback)`);
      await this.wsManager.connect();
    } catch (e: any) {
      console.error(`❌ Hybrid startup failed: ${e.message}`);
      await this.triggerRestFallback().catch(error => console.warn(`Reconciliation unavailable: ${error.message}`));
    }
  }

  async getReconciliation(): Promise<{
    account: AccountData | null;
    positions: PositionData[];
    source: 'websocket' | 'rest';
  }> {
    // Try WebSocket first (real-time). A connected socket alone is not enough: it must also
    // carry an account record AND at least one real position snapshot, otherwise an empty
    // position list could be mistaken for "all trades closed" and wrongly close DB trades.
    if (this.wsManager.getConnectionStatus()) {
      const account = this.wsManager.getAccount();
      const positions = this.wsManager.getPositions();

      if (account && this.wsManager.hasValidPositionSnapshot()) {
        return {
          account,
          positions,
          source: 'websocket'
        };
      }
    }

    // Fallback to REST if needed
    const now = Date.now();
    if (now - this.lastRestFallback > this.restFallbackInterval) {
      return await this.restFallback();
    }

    // No REST budget left: reuse cached WS data only when it is a verified snapshot,
    // otherwise fail closed instead of serving stale/empty state as current.
    return this.requireCachedSnapshot();
  }

  private requireCachedSnapshot(): {
    account: AccountData;
    positions: PositionData[];
    source: 'websocket';
  } {
    const account = this.wsManager.getAccount();
    if (account && this.wsManager.hasValidPositionSnapshot()) {
      return { account, positions: this.wsManager.getPositions(), source: 'websocket' };
    }
    throw new Error('No valid reconciliation snapshot: WebSocket position data missing and REST fallback unavailable');
  }

  private async restFallback(): Promise<{
    account: AccountData | null;
    positions: PositionData[];
    source: 'websocket' | 'rest';
  }> {
    try {
      console.log(`🔄 [REST Fallback] Fetching from Binance API...`);

      this.lastRestFallback = Date.now();
      const timestamp = Date.now();
      const query = new URLSearchParams({
        recvWindow: '5000',
        timestamp: timestamp.toString()
      });

      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(query.toString())
        .digest('hex');

      query.append('signature', signature);

      const headers = { 'X-MBX-APIKEY': this.apiKey };

      // Fetch account & positions
      const [accountRes, positionsRes] = await Promise.all([
        binanceRateLimiter.fetch(`${this.baseUrl}/fapi/v2/account?${query}`, { headers }),
        binanceRateLimiter.fetch(`${this.baseUrl}/fapi/v2/positionRisk?${query}`, { headers })
      ]);

      // Check for rate limit - if hit, don't trigger HARD_HALT yet
      if (accountRes.status === 418 || positionsRes.status === 418) {
        console.warn(`⚠️ [REST] Rate limited (418). Staying on WebSocket.`);
        this.failureCount++;
        if (this.failureCount >= this.maxFailures) {
          throw new Error(`Rate limited 3+ times - IP likely banned`);
        }
        // Cached WS data is only usable when it holds a verified position snapshot.
        return this.requireCachedSnapshot();
      }

      if (!accountRes.ok || !positionsRes.ok) {
        throw new Error(`API error: Account ${accountRes.status}, Positions ${positionsRes.status}`);
      }

      const accountData = await accountRes.json();
      const positionsData = await positionsRes.json();

      const account: AccountData = {
        totalWalletBalance: parseFloat(accountData.totalWalletBalance),
        totalUnrealizedProfit: positionsData.reduce((sum: number, p: any) => sum + parseFloat(p.unrealizedProfit || 0), 0),
        totalInitialMargin: parseFloat(accountData.totalInitialMargin),
        totalMaintMargin: parseFloat(accountData.totalMaintMargin),
        timestamp: Date.now()
      };

      const positions: PositionData[] = positionsData
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unRealizedProfit: parseFloat(p.unrealizedProfit),
          positionSide: p.positionSide,
          timestamp: Date.now()
        }));

      console.log(`✅ [REST] Reconciliation successful: $${account.totalWalletBalance.toFixed(2)}`);
      this.lastRestFallback = Date.now();
      this.failureCount = 0;

      return { account, positions, source: 'rest' };
    } catch (e: any) {
      console.error(`❌ [REST] Fallback failed: ${e.message}`);
      this.failureCount++;

      // Cached WS data only if it is a verified snapshot; otherwise fail closed.
      return this.requireCachedSnapshot();
    }
  }

  private async triggerRestFallback(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRestFallback > this.restFallbackInterval) { // At least 10s since last attempt
      await this.restFallback();
    }
  }

  getStatus(): {
    wsConnected: boolean;
    wsPositions: number;
    wsAccount: AccountData | null;
    lastRestCall: number;
  } {
    return {
      wsConnected: this.wsManager.getConnectionStatus(),
      wsPositions: this.wsManager.getPositions().length,
      wsAccount: this.wsManager.getAccount(),
      lastRestCall: this.lastRestFallback
    };
  }

  async stop(): Promise<void> {
    await this.wsManager.disconnect();
    console.log(`🛑 Hybrid reconciliation stopped`);
  }
}
