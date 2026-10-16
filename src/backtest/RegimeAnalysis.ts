export type Regime = 'TRENDING' | 'RANGING' | 'VOLATILE';

export interface RegimeTrade { regime: Regime; returnPct: number }
export interface RegimeStats { trades: number; wins: number; winRate: number; totalReturnPct: number; averageReturnPct: number }
export interface RegimeAnalysisResult { totalTrades: number; byRegime: Record<Regime, RegimeStats>; bestRegime: Regime | null }

export function classifyRegime(prices: number[]): Regime {
  if (prices.length < 2) throw new Error('prices must contain at least two values');
  const mean = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const variance = prices.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prices.length;
  const volatility = Math.sqrt(variance) / Math.max(Math.abs(mean), Number.EPSILON);
  const change = Math.abs(prices[prices.length - 1] - prices[0]) / Math.max(Math.abs(prices[0]), Number.EPSILON);
  if (volatility > 0.08) return 'VOLATILE';
  if (change > 0.05) return 'TRENDING';
  return 'RANGING';
}

export function analyzeRegimes(trades: RegimeTrade[]): RegimeAnalysisResult {
  const regimes: Regime[] = ['TRENDING', 'RANGING', 'VOLATILE'];
  const byRegime = Object.fromEntries(regimes.map((regime) => [regime, { trades: 0, wins: 0, winRate: 0, totalReturnPct: 0, averageReturnPct: 0 }])) as Record<Regime, RegimeStats>;
  for (const trade of trades) {
    const stats = byRegime[trade.regime];
    stats.trades += 1;
    stats.wins += trade.returnPct > 0 ? 1 : 0;
    stats.totalReturnPct += trade.returnPct;
  }
  for (const regime of regimes) {
    const stats = byRegime[regime];
    stats.winRate = stats.trades ? stats.wins / stats.trades : 0;
    stats.averageReturnPct = stats.trades ? stats.totalReturnPct / stats.trades : 0;
  }
  const active = regimes.filter((regime) => byRegime[regime].trades > 0);
  const bestRegime = active.length ? active.reduce((best, regime) => byRegime[regime].totalReturnPct > byRegime[best].totalReturnPct ? regime : best, active[0]) : null;
  return { totalTrades: trades.length, byRegime, bestRegime };
}
