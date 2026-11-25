import type { StrategyMetrics } from '../domain/types';

export interface ClosedTradeLike {
  strategy: string;
  status: string;
  pnl?: number;
  timestamp: number;
  closedAt?: number;
}

export function emptyStrategyMetrics(): StrategyMetrics {
  return {
    winRatePct: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    dailyPnl: 0,
    dailyPnlPct: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    maxDrawdownPct: 0,
    avgHoldMinutes: 0,
    lastSignalTime: 0,
  };
}

const round = (v: number, d = 2) => Number(v.toFixed(d));

/** Performance numbers computed only from real closed trades (net pnl). */
export function computeStrategyMetrics(trades: ClosedTradeLike[], now: number = Date.now()): StrategyMetrics {
  const m = emptyStrategyMetrics();
  const closed = trades
    .filter((t) => t.status === 'CLOSED' && Number.isFinite(t.pnl))
    .sort((a, b) => (a.closedAt ?? a.timestamp) - (b.closedAt ?? b.timestamp));
  if (closed.length === 0) return m;

  let grossWin = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let holdMs = 0;
  let holdCount = 0;
  const dayStart = now - 24 * 60 * 60 * 1000;
  for (const t of closed) {
    const pnl = t.pnl as number;
    m.totalTrades += 1;
    if (pnl > 0) { m.winningTrades += 1; grossWin += pnl; }
    else if (pnl < 0) { m.losingTrades += 1; grossLoss += -pnl; }
    m.realizedPnl += pnl;
    if ((t.closedAt ?? t.timestamp) >= dayStart) m.dailyPnl += pnl;
    equity += pnl;
    peak = Math.max(peak, equity);
    // drawdown as % of peak realized pnl (0 until there is a peak above zero)
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
    if (t.closedAt && t.closedAt > t.timestamp) { holdMs += t.closedAt - t.timestamp; holdCount += 1; }
  }
  m.winRatePct = round((m.winningTrades / m.totalTrades) * 100, 1);
  m.realizedPnl = round(m.realizedPnl);
  m.dailyPnl = round(m.dailyPnl);
  m.profitFactor = grossLoss > 0 ? round(grossWin / grossLoss) : (grossWin > 0 ? 999 : 0);
  m.maxDrawdownPct = round(maxDd);
  m.avgHoldMinutes = holdCount > 0 ? round(holdMs / holdCount / 60000, 1) : 0;
  // Per-trade Sharpe (not annualised): mean / stdev of trade pnl. Needs >= 5 trades to mean anything.
  if (closed.length >= 5) {
    const pnls = closed.map((t) => t.pnl as number);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const sd = Math.sqrt(pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (pnls.length - 1));
    m.sharpeRatio = sd > 0 ? round(mean / sd) : 0;
  }
  return m;
}
