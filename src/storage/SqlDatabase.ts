/**
 * Basel Quantum Algorithmic Trading System
 * High-Performance Durable JSON/SQL Persistent Storage Engine (Node.js & Bun Compatible)
 */

import path from "path";
import fs from "fs";

interface StoredTrade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  pnl?: number;
  exitPrice?: number;
  fee?: number;
  timestamp: number;
  status: string;
}

interface StoredLog {
  id: string;
  timestamp: number;
  severity: string;
  source: string;
  message: string;
  details?: any;
}

export class SqlDatabaseStore {
  private filePath: string;
  private data: {
    trades: Record<string, StoredTrade>;
    audit_logs: StoredLog[];
  };
  // Indexes for O(1) lookups by userId and status (avoid full Object.values scans)
  private tradesByUserId: Map<string, Set<string>> = new Map();
  private tradesByStatus: Map<string, Set<string>> = new Map();

  constructor(dbPath: string = "./data/baselbot_db.json") {
    this.filePath = dbPath;
    this.data = { trades: {}, audit_logs: [] };
    this.load();
    console.log(`🗄️ Durable Persistent Storage Engine initialized at ${this.filePath}`);
  }

  private load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.data = JSON.parse(raw);
        if (!this.data.trades) this.data.trades = {};
        if (!this.data.audit_logs) this.data.audit_logs = [];

        // Exclude legacy ghost trades with 0 PnL and no exit price
        const sanitized: Record<string, StoredTrade> = {};
        for (const [id, t] of Object.entries(this.data.trades)) {
          if (t.status === 'OPEN' || ((t as any).pnl !== undefined && Math.abs((t as any).pnl) > 0.0001)) {
            sanitized[id] = t;
          }
        }
        this.data.trades = sanitized;
        // Rebuild indexes after load
        this.rebuildIndexes();
      }
    } catch (err) {
      console.error("Error loading persistent database:", err);
      this.data = { trades: {}, audit_logs: [] };
    }
  }

  private rebuildIndexes() {
    this.tradesByUserId.clear();
    this.tradesByStatus.clear();
    for (const [id, trade] of Object.entries(this.data.trades)) {
      this.updateIndexes(trade);
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("Error saving persistent database:", err);
    }
  }

  public saveTrade(trade: StoredTrade) {
    this.data.trades[trade.id] = trade;
    this.updateIndexes(trade);
    this.save();
  }

  private updateIndexes(trade: StoredTrade) {
    // Index by userId (assuming trade has userId, or use a default)
    const userId = (trade as any).userId || 'default';
    if (!this.tradesByUserId.has(userId)) {
      this.tradesByUserId.set(userId, new Set());
    }
    this.tradesByUserId.get(userId)!.add(trade.id);

    // Index by status
    if (!this.tradesByStatus.has(trade.status)) {
      this.tradesByStatus.set(trade.status, new Set());
    }
    this.tradesByStatus.get(trade.status)!.add(trade.id);
  }

  private removeFromIndexes(trade: StoredTrade) {
    const userId = (trade as any).userId || 'default';
    this.tradesByUserId.get(userId)?.delete(trade.id);
    this.tradesByStatus.get(trade.status)?.delete(trade.id);
  }

  public getTrades(limit: number = 100): StoredTrade[] {
    const list = Object.values(this.data.trades);
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list.slice(0, limit);
  }

  public logEvent(event: StoredLog) {
    this.data.audit_logs.unshift(event);
    if (this.data.audit_logs.length > 1000) {
      this.data.audit_logs.pop();
    }
    this.save();
  }

  public getPerformanceMetrics() {
    // Use index for CLOSED/FILLED status lookups instead of full scan
    const closedIds = this.tradesByStatus.get('CLOSED') || new Set();
    const filledIds = this.tradesByStatus.get('FILLED') || new Set();
    const allClosedIds = new Set([...closedIds, ...filledIds]);

    const closedTrades: StoredTrade[] = [];
    allClosedIds.forEach(id => {
      const trade = this.data.trades[id];
      if (trade) closedTrades.push(trade);
    });

    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0).length;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    return {
      totalTrades: Object.keys(this.data.trades).length,
      closedTrades,
      winningTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      totalPnl
    };
  }

  public getAuditLogs(limit: number = 100): StoredLog[] {
    return this.data.audit_logs.slice(0, limit);
  }
}
