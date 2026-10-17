// src/storage/DurableStateManager.ts
// In-memory state manager for hot data (trades, positions, balance)
// Batch archive to D1 once per hour

export interface HotState {
  balance: {
    equity: number;
    freeMargin: number;
    unrealizedPnl: number;
    timestamp: number;
  } | null;
  trades: Array<{
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    status: 'OPEN' | 'CLOSED';
    timestamp: number;
  }>;
  positions: Record<string, {
    symbol: string;
    size: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
  }>;
  signals: Array<{
    id: string;
    symbol: string;
    type: string;
    confidence: number;
    timestamp: number;
  }>;
  killSwitchState: {
    level: string;
    active: boolean;
    reason: string;
    timestamp: number;
  } | null;
  lastArchiveTime: number;
}

export class DurableStateManager {
  private state: HotState = {
    balance: null,
    trades: [],
    positions: {},
    signals: [],
    killSwitchState: null,
    lastArchiveTime: Date.now(),
  };

  private archiveCallback: ((state: HotState) => Promise<void>) | null = null;

  constructor() {
    console.log('🔥 DurableStateManager initialized (HOT storage for live trading)');
  }

  /**
   * Register callback for archiving (called once per hour)
   */
  public onArchive(callback: (state: HotState) => Promise<void>) {
    this.archiveCallback = callback;
  }

  /**
   * Update balance snapshot (real-time)
   * FAST: <1ms, NO D1 QUOTA CONSUMED
   */
  public updateBalance(equity: number, freeMargin: number, unrealizedPnl: number) {
    this.state.balance = {
      equity,
      freeMargin,
      unrealizedPnl,
      timestamp: Date.now(),
    };
  }

  /**
   * Get current balance
   */
  public getBalance() {
    return this.state.balance;
  }

  /**
   * Record new trade (real-time)
   */
  public recordTrade(trade: {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    status: 'OPEN' | 'CLOSED';
    timestamp: number;
  }) {
    this.state.trades.push(trade);
  }

  /**
   * Update trade status (e.g., OPEN → CLOSED)
   */
  public updateTradeStatus(tradeId: string, status: 'OPEN' | 'CLOSED') {
    const trade = this.state.trades.find(t => t.id === tradeId);
    if (trade) {
      trade.status = status;
    }
  }

  /**
   * Get open trades for a symbol
   */
  public getOpenTrades(symbol?: string) {
    const openTrades = this.state.trades.filter(t => t.status === 'OPEN');
    if (symbol) {
      return openTrades.filter(t => t.symbol === symbol);
    }
    return openTrades;
  }

  /**
   * Update position (real-time)
   */
  public updatePosition(symbol: string, position: {
    size: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
  }) {
    this.state.positions[symbol] = {
      symbol,
      ...position,
    };
  }

  /**
   * Get position for symbol
   */
  public getPosition(symbol: string) {
    return this.state.positions[symbol] || null;
  }

  /**
   * Get all open positions
   */
  public getAllPositions() {
    return Object.values(this.state.positions);
  }

  /**
   * Record signal (real-time)
   */
  public recordSignal(signal: {
    id: string;
    symbol: string;
    type: string;
    confidence: number;
    timestamp: number;
  }) {
    this.state.signals.push(signal);
    // Keep last 1000 signals only
    if (this.state.signals.length > 1000) {
      this.state.signals = this.state.signals.slice(-1000);
    }
  }

  /**
   * Get recent signals
   */
  public getRecentSignals(limit: number = 100) {
    return this.state.signals.slice(-limit);
  }

  /**
   * Update KillSwitch state
   */
  public updateKillSwitchState(level: string, active: boolean, reason: string) {
    this.state.killSwitchState = {
      level,
      active,
      reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Get KillSwitch state
   */
  public getKillSwitchState() {
    return this.state.killSwitchState;
  }

  /**
   * Get full state snapshot
   */
  public getState() {
    return { ...this.state };
  }

  /**
   * Archive to D1 (call once per hour)
   * BATCH: 1 write per hour
   */
  public async archiveDaily() {
    const now = Date.now();
    const hourInMs = 3600000;

    // Only archive if 1+ hour has passed since last archive
    if (now - this.state.lastArchiveTime < hourInMs) {
      return;
    }

    console.log('📦 Archiving hot state to D1...');

    if (this.archiveCallback) {
      try {
        await this.archiveCallback(this.state);
        this.state.lastArchiveTime = now;

        // Clear closed trades from memory (keep last 100 for reference)
        const closedTrades = this.state.trades.filter(t => t.status === 'CLOSED');
        if (closedTrades.length > 100) {
          const toKeep = closedTrades.slice(-100);
          this.state.trades = [
            ...this.state.trades.filter(t => t.status === 'OPEN'),
            ...toKeep,
          ];
        }

        console.log('✅ Archive complete');
      } catch (error) {
        console.error('❌ Archive failed:', error);
      }
    }
  }

  /**
   * Clear all hot state (use on restart)
   */
  public clearState() {
    this.state = {
      balance: null,
      trades: [],
      positions: {},
      signals: [],
      killSwitchState: null,
      lastArchiveTime: Date.now(),
    };
  }

  /**
   * Get stats for monitoring
   */
  public getStats() {
    return {
      openTrades: this.state.trades.filter(t => t.status === 'OPEN').length,
      closedTrades: this.state.trades.filter(t => t.status === 'CLOSED').length,
      openPositions: Object.keys(this.state.positions).length,
      recentSignals: this.state.signals.length,
      currentBalance: this.state.balance?.equity ?? 0,
      lastArchive: this.state.lastArchiveTime,
    };
  }
}

// Export singleton instance
export const durableStateManager = new DurableStateManager();
