import assert from 'node:assert/strict';
import { StrategyManager } from '../strategies/StrategyManager';
import { computeStrategyMetrics } from '../strategies/strategyStats';

const mgr = new StrategyManager();
for (const s of mgr.getStrategies()) {
  assert.equal(s.metrics.totalTrades, 0, `${s.id} must start with no invented trades`);
  assert.equal(s.metrics.realizedPnl, 0);
  assert.equal(s.metrics.winRatePct, 0);
  assert.equal(s.allocatedCapital, 0);
}

const now = Date.now();
const t = (strategy: string, pnl: number, i: number) => ({ strategy, status: 'CLOSED', pnl, timestamp: now - (10 - i) * 60000, closedAt: now - (10 - i) * 60000 + 30000 });
const trades = [t('ou-mean-reversion', 10, 0), t('ou-mean-reversion', -5, 1), t('ou-mean-reversion', 15, 2), { strategy: 'ou-mean-reversion', status: 'OPEN', pnl: 99, timestamp: now }];
const m = computeStrategyMetrics(trades, now);
assert.equal(m.totalTrades, 3);
assert.equal(m.winningTrades, 2);
assert.equal(m.losingTrades, 1);
assert.equal(m.winRatePct, 66.7);
assert.equal(m.realizedPnl, 20);
assert.equal(m.profitFactor, 5);
assert.equal(m.avgHoldMinutes, 0.5);

mgr.refreshMetricsFromTrades(trades);
assert.equal(mgr.getStrategy('ou-mean-reversion')!.metrics.totalTrades, 3);
assert.equal(mgr.getStrategy('multi-agent-quant-alpha')!.metrics.totalTrades, 0);
console.log('PASS strategy stats come only from real closed trades');
