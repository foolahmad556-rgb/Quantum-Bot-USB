// src/storage/CloudDatabaseService.ts

import { db as pgDb } from '../db/index.ts';
import { trades, balanceHistory, users } from '../db/schema.ts';
import { eq, desc, and } from 'drizzle-orm';
import { TradeRecord, SignalRecord, BalanceSnapshot, PriceRecord } from './DatabaseService.ts';

// Stub: Firebase not used. Uses PostgreSQL (Drizzle ORM) + local SQLite for auth.

export class CloudDatabaseService {
  private userId: number | null = null;
  private userEmail: string | null = null;

  constructor(userEmail?: string) {
    this.userEmail = userEmail || null;
  }

  public async setUserId(id: number, email?: string) {
    this.userId = id;
    if (email) this.userEmail = email;
  }

  // --- Prices (no persistence in this version) ---
  public async savePrice(symbol: string, price: number) {
    // No-op: prices not persisted
  }

  public async getPriceHistory(symbol: string, limit: number = 100): Promise<PriceRecord[]> {
    return [];
  }

  // --- Trades (Cloud SQL for durability/audit) ---
  public async saveTrade(trade: TradeRecord) {
    if (!this.userId) return;
    await pgDb.insert(trades).values({
      userId: this.userId,
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      status: trade.status,
      strategyId: trade.strategy,
      pnl: trade.pnl ?? null,
      exitPrice: trade.exitPrice ?? null,
      fee: trade.fee ?? null,
      closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
      timestamp: new Date(trade.timestamp)
    });
  }

  public async getOpenTrades(symbol?: string): Promise<TradeRecord[]> {
    if (!this.userId) return [];
    let query = pgDb.select().from(trades).where(
      and(
        eq(trades.userId, this.userId),
        eq(trades.status, 'OPEN')
      )
    );
    
    const results = await query;
    const filtered = symbol ? results.filter(r => r.symbol === symbol) : results;
    
    return filtered.map(r => ({
      id: r.id.toString(),
      timestamp: r.timestamp.getTime(),
      symbol: r.symbol,
      side: r.side as 'BUY' | 'SELL',
      quantity: r.quantity,
      price: r.price,
      strategy: r.strategyId,
      pnl: r.pnl ?? undefined,
      exitPrice: r.exitPrice ?? undefined,
      fee: r.fee ?? undefined,
      closedAt: r.closedAt ? r.closedAt.getTime() : undefined,
      status: r.status as 'OPEN' | 'CLOSED' | 'CANCELLED'
    }));
  }

  public async closeTrade(id: string, pnl: number, exitPrice?: number, fee?: number) {
    if (!this.userId) return;
    await pgDb.update(trades)
      .set({ 
        status: 'CLOSED', 
        pnl,
        exitPrice: exitPrice ?? null,
        fee: fee ?? null,
        closedAt: new Date()
      })
      .where(and(eq(trades.id, parseInt(id)), eq(trades.userId, this.userId)));
  }

  // --- Signals (no persistence in this version) ---
  public async saveSignal(signal: SignalRecord) {
    // No-op: signals not persisted
  }

  // --- Balance Snapshots (Cloud SQL) ---
  public async saveBalanceSnapshot(equity: number, freeMargin: number, unrealizedPnl: number) {
    if (!this.userId) return;
    await pgDb.insert(balanceHistory).values({
      userId: this.userId,
      totalEquity: equity,
      availableCash: freeMargin,
      timestamp: new Date()
    });
  }

  // --- Bot State (no persistence in this version) ---
  public async saveState(key: string, value: any) {
    // No-op: state not persisted
  }

  public async getState<T>(key: string): Promise<T | null> {
    return null;
  }

  // --- Performance Metrics ---
  public async getPerformanceMetrics() {
    if (!this.userId) return null;
    const tradesList = await pgDb.select().from(trades).where(
      and(
        eq(trades.userId, this.userId),
        eq(trades.status, 'CLOSED')
      )
    );
    
    const totalTrades = tradesList.length;
    const winningTrades = (tradesList as any[]).filter(t => (t.pnl ?? 0) > 0).length;
    const totalPnl = (tradesList as any[]).reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    
    return {
      totalTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0, 
      totalPnl
    };
  }
}
