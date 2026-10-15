import assert from 'node:assert/strict';
import { UserDataStream } from '../execution/UserDataStream';
import { ReconciliationService } from '../execution/ReconciliationService';
import { Position } from '../domain/types';

const position = (symbol: string, size: number): Position => ({
  symbol, size, positionSide: 'BOTH', entryPrice: 100, currentPrice: 100,
  unrealizedPnl: 0, unrealizedPnlPct: 0, realizedPnl: 0, marginUsed: 10,
  liquidationPrice: 0, leverage: 1, updatedAt: Date.now(),
});

const stream = new UserDataStream();
stream.adoptPosition(position('BTC/USDT', 1));
const reconciliation = new ReconciliationService(stream);
const report = reconciliation.runReconciliation(new Map([
  ['BTC/USDT', 1],
  ['ETH/USDT', 2],
]));

assert.equal(report.isBalanced, false);
assert.deepEqual(report.discrepancies.find((item) => item.symbol === 'ETH/USDT'), {
  symbol: 'ETH/USDT',
  internalSize: 0,
  exchangeSize: 2,
  drift: -2,
  actionTaken: 'MANUAL_ALERT',
});
console.log('reconciliation orphan integration test passed');
