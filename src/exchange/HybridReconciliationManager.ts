import { binanceRateLimiter } from '../utils/RateLimiter';
import { BinanceWebSocketManager, PositionData, AccountData } from './BinanceWebSocketManager';
import crypto from 'crypto';

type RestHealth = 'healthy' | 'rate_limited' | 'ip_quarantined' | 'unavailable';

type ReconciliationSnapshot = {
  account: AccountData;
  positions: PositionData[];
  source: 'websocket' | 'rest';
};

export class HybridReconciliationManager {
  private wsManager: BinanceWebSocketManager;
  private lastRestFallback = 0;
  private lastRestAttempt = 0;
  private restFallbackInterval = 60_000;
  private restRetryInterval = 15_000;
  private failureCount = 0;
  private maxFailures = 3;
  private restHealth: RestHealth = 'healthy';
  private restBlockedUntil = 0;
  private restInFlight: Promise<ReconciliationSnapshot> | null = null;

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private baseUrl: string = 'https://fapi.binance.com',
  ) {
    this.wsManager = new BinanceWebSocketManager(apiKey, apiSecret, baseUrl);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wsManager.on('connected', () => {
      console.log('✅ WebSocket connected - using real-time data');
      this.failureCount = 0;
    });
    this.wsManager.on('error', (error: Error) => {
      console.error(`⚠️ WebSocket error: ${error.message}`);
      this.failureCount++;
    });
    this.wsManager.on('fallback', async () => {
      console.warn('⚠️ WebSocket unreliable - falling back to REST polling');
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
      console.log('🚀 Starting Hybrid Reconciliation (WebSocket + REST fallback)');
      await this.wsManager.connect();
    } catch (e: any) {
      console.error(`❌ Hybrid startup failed: ${e.message}`);
      await this.triggerRestFallback().catch(error => console.warn(`Reconciliation unavailable: ${error.message}`));
    }
  }

  async getReconciliation(): Promise<ReconciliationSnapshot> {
    if (this.wsManager.getConnectionStatus()) {
      const account = this.wsManager.getAccount();
      if (account && this.wsManager.hasValidPositionSnapshot()) {
        return { account, positions: this.wsManager.getPositions(), source: 'websocket' };
      }
    }

    // Join an already-running REST reconciliation before applying cooldown gates;
    // otherwise concurrent callers would fail closed instead of sharing one snapshot.
    if (this.restInFlight) return this.restInFlight;

    const now = Date.now();
    const snapshotExpired = now - this.lastRestFallback >= this.restFallbackInterval;
    const retryAllowed = now - this.lastRestAttempt >= this.restRetryInterval;
    const quarantineActive = this.isRestQuarantined();

    if (snapshotExpired && retryAllowed && !quarantineActive) {
      return this.getRestSnapshotSingleFlight();
    }

    return this.requireCachedSnapshot();
  }

  private getRestSnapshotSingleFlight(): Promise<ReconciliationSnapshot> {
    if (this.restInFlight) return this.restInFlight;
    this.restInFlight = this.restFallback().finally(() => {
      this.restInFlight = null;
    });
    return this.restInFlight;
  }

  private requireCachedSnapshot(): ReconciliationSnapshot {
    const account = this.wsManager.getAccount();
    if (account && this.wsManager.hasValidPositionSnapshot()) {
      return { account, positions: this.wsManager.getPositions(), source: 'websocket' };
    }
    throw new Error('No valid reconciliation snapshot: WebSocket position data missing and REST fallback unavailable');
  }

  private isRestQuarantined(): boolean {
    const limiterStatus = binanceRateLimiter.getQuarantineStatus();
    return Math.max(this.restBlockedUntil, limiterStatus.until) > Date.now();
  }

  private applyRestQuarantine(status: 418 | 429, response?: Response): void {
    const retryAfter = Number(response?.headers.get('retry-after') || 0);
    const fallback = status === 418 ? 15 * 60_000 : 60_000;
    const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallback) +
      Math.floor(Math.random() * (status === 418 ? 10_000 : 1_000));
    this.restBlockedUntil = Math.max(this.restBlockedUntil, Date.now() + wait);
    this.restHealth = status === 418 ? 'ip_quarantined' : 'rate_limited';
    console.warn(`🛑 [REST] HTTP ${status}; reconciliation REST quarantine active for ${wait}ms`);
  }

  private async restFallback(): Promise<ReconciliationSnapshot> {
    if (this.isRestQuarantined()) return this.requireCachedSnapshot();
    this.lastRestAttempt = Date.now();

    try {
      console.log('🔄 [REST Fallback] Fetching from Binance API (single-flight, serialized)...');
      const timestamp = Date.now();
      const unsignedQuery = new URLSearchParams({ recvWindow: '5000', timestamp: timestamp.toString() });
      const signature = crypto.createHmac('sha256', this.apiSecret).update(unsignedQuery.toString()).digest('hex');
      const query = `${unsignedQuery.toString()}&signature=${signature}`;
      const headers = { 'X-MBX-APIKEY': this.apiKey };

      // Keep these calls inside the shared BinanceRestGate. They are deliberately sequential:
      // account and positionRisk must not race with another reconciliation cycle.
      const accountRes = await binanceRateLimiter.fetch(
        `${this.baseUrl}/fapi/v2/account?${query}`,
        { headers },
        20,
        'account',
      );
      if (accountRes.status === 418 || accountRes.status === 429) {
        this.applyRestQuarantine(accountRes.status, accountRes);
        this.failureCount++;
        return this.requireCachedSnapshot();
      }
      const positionsRes = await binanceRateLimiter.fetch(
        `${this.baseUrl}/fapi/v2/positionRisk?${query}`,
        { headers },
        10,
        'account',
      );

      if (accountRes.status === 418 || positionsRes.status === 418) {
        const response = accountRes.status === 418 ? accountRes : positionsRes;
        this.applyRestQuarantine(418, response);
        this.failureCount++;
        return this.requireCachedSnapshot();
      }
      if (accountRes.status === 429 || positionsRes.status === 429) {
        const response = accountRes.status === 429 ? accountRes : positionsRes;
        this.applyRestQuarantine(429, response);
        this.failureCount++;
        return this.requireCachedSnapshot();
      }
      if (!accountRes.ok || !positionsRes.ok) {
        throw new Error(`API error: Account ${accountRes.status}, Positions ${positionsRes.status}`);
      }

      const accountData = await accountRes.json();
      const positionsData = await positionsRes.json();
      const account: AccountData = {
        totalWalletBalance: parseFloat(accountData.totalWalletBalance),
        availableBalance: parseFloat(accountData.availableBalance),
        totalUnrealizedProfit: parseFloat(accountData.totalUnrealizedProfit),
        totalInitialMargin: parseFloat(accountData.totalInitialMargin),
        totalMaintMargin: parseFloat(accountData.totalMaintMargin),
        timestamp: Date.now(),
      };
      const positions: PositionData[] = positionsData
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unRealizedProfit: parseFloat(p.unRealizedProfit ?? p.unrealizedProfit),
          positionSide: p.positionSide,
          timestamp: Date.now(),
        }));

      this.lastRestFallback = Date.now();
      this.failureCount = 0;
      this.restHealth = 'healthy';
      this.restBlockedUntil = 0;
      console.log(`✅ [REST] Reconciliation successful: $${account.totalWalletBalance.toFixed(2)}`);
      return { account, positions, source: 'rest' };
    } catch (e: any) {
      this.failureCount++;
      const limiterQuarantine = binanceRateLimiter.getQuarantineStatus();
      if (limiterQuarantine.active) {
        this.restBlockedUntil = Math.max(this.restBlockedUntil, limiterQuarantine.until);
        this.restHealth = limiterQuarantine.reason === '418' ? 'ip_quarantined' : 'rate_limited';
      }
      if (/quarantine|HTTP 418|HTTP 429/i.test(String(e?.message))) {
        this.restHealth = /418/.test(String(e?.message)) ? 'ip_quarantined' : 'rate_limited';
      } else {
        this.restHealth = 'unavailable';
      }
      console.error(`❌ [REST] Fallback failed: ${e.message}`);
      return this.requireCachedSnapshot();
    }
  }

  private async triggerRestFallback(): Promise<void> {
    if (this.isRestQuarantined()) {
      console.warn('⏸️ [REST] Fallback skipped while Binance quarantine is active; waiting for WebSocket snapshot.');
      return;
    }
    const now = Date.now();
    if (now - this.lastRestFallback >= this.restFallbackInterval &&
        now - this.lastRestAttempt >= this.restRetryInterval) {
      await this.getRestSnapshotSingleFlight();
    }
  }

  getStatus(): {
    wsConnected: boolean;
    wsPositions: number;
    wsAccount: AccountData | null;
    lastRestCall: number;
    restHealth: RestHealth;
    restQuarantineUntil: number;
    restRequestInFlight: boolean;
  } {
    const limiterStatus = binanceRateLimiter.getQuarantineStatus();
    return {
      wsConnected: this.wsManager.getConnectionStatus(),
      wsPositions: this.wsManager.getPositions().length,
      wsAccount: this.wsManager.getAccount(),
      lastRestCall: this.lastRestFallback,
      restHealth: this.restHealth,
      restQuarantineUntil: Math.max(this.restBlockedUntil, limiterStatus.until),
      restRequestInFlight: this.restInFlight !== null,
    };
  }

  async stop(): Promise<void> {
    await this.wsManager.disconnect();
    console.log('🛑 Hybrid reconciliation stopped');
  }
}
