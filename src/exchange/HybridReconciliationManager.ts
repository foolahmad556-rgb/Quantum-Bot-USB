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
      await this.triggerRestFallback();
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
      await this.triggerRestFallback();
    }
  }

  async getReconciliation(): Promise<{
    account: AccountData | null;
    positions: PositionData[];
    source: 'websocket' | 'rest';
  }> {
    // Try WebSocket first (real-time)
    if (this.wsManager.getConnectionStatus()) {
      const account = this.wsManager.getAccount();
      const positions = this.wsManager.getPositions();
      
      if (account && positions.length >= 0) {
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

    // Use cached data if no fresh REST call
    const account = this.wsManager.getAccount();
    const positions = this.wsManager.getPositions();
    return {
      account,
      positions,
      source: this.wsManager.getConnectionStatus() ? 'websocket' : 'rest'
    };
  }

  private async restFallback(): Promise<{
    account: AccountData | null;
    positions: PositionData[];
    source: 'websocket' | 'rest';
  }> {
    try {
      console.log(`🔄 [REST Fallback] Fetching from Binance API...`);
      
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
        fetch(`${this.baseUrl}/fapi/v2/account?${query}`, { headers }),
        fetch(`${this.baseUrl}/fapi/v2/positionRisk?${query}`, { headers })
      ]);

      // Check for rate limit - if hit, don't trigger HARD_HALT yet
      if (accountRes.status === 418 || positionsRes.status === 418) {
        console.warn(`⚠️ [REST] Rate limited (418). Staying on WebSocket.`);
        this.failureCount++;
        if (this.failureCount >= this.maxFailures) {
          throw new Error(`Rate limited 3+ times - IP likely banned`);
        }
        // Return cached WebSocket data
        return {
          account: this.wsManager.getAccount(),
          positions: this.wsManager.getPositions(),
          source: 'websocket'
        };
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
      
      // Return cached data
      return {
        account: this.wsManager.getAccount(),
        positions: this.wsManager.getPositions(),
        source: 'websocket'
      };
    }
  }

  private async triggerRestFallback(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRestFallback > 10000) { // At least 10s since last attempt
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
