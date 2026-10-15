import assert from 'node:assert/strict';
import { UserDataStream } from '../execution/UserDataStream';
import { Position } from '../domain/types';

const position = (symbol: string, size: number, positionSide?: Position['positionSide']): Position => ({
  symbol, size, positionSide, entryPrice: 100, currentPrice: 101,
  unrealizedPnl: 1, unrealizedPnlPct: 1, realizedPnl: 0,
  marginUsed: 10, liquidationPrice: 0, leverage: 10, updatedAt: Date.now(),
});

const stream = new UserDataStream();
stream.adoptPosition(position('BTC/USDT', 1, 'LONG'));
assert.equal(stream.getPosition('BTC/USDT', 'LONG')?.size, 1);
assert.equal(stream.getPosition('BTC/USDT', 'SHORT'), undefined);
stream.adoptPosition(position('BTC/USDT', -2, 'SHORT'));
assert.equal(stream.getPositions().length, 2);
stream.replaceAccountState({
  totalEquity: 250, availableCash: 200, usedMargin: 50, marginLevel: 5,
  freeMargin: 200, unrealizedPnl: 50, realizedPnl: 0, dailyPnl: 0, dailyPnlPct: 0, currency: 'USDT',
}, [position('ETH/USDT', 1, 'BOTH')]);
assert.equal(stream.getBalance().totalEquity, 250);
assert.equal(stream.getPositions()[0].currentPrice, 101);
console.log('account reconciliation tests passed');
