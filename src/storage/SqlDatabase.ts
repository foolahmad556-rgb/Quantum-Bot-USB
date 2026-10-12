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
      }
    } catch (err) {
      console.error("Error loading persistent database:", err);
      this.data = { trades: {}, audit_logs: [] };
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
    this.save();
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
    const trades = Object.values(this.data.trades);
    const closedTrades = trades.filter(t => t.status === 'CLOSED' || t.status === 'FILLED');
    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0).length;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    return {
      totalTrades: trades.length,
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
