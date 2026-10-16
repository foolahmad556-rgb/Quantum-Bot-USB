import assert from 'node:assert/strict';
import { simulateExecution } from '../backtest/RealisticExecution';

const buy = simulateExecution({ side: 'BUY', referencePrice: 100, quantity: 20, candleVolume: 100, feeRate: 0.001, slippageBps: 10, spreadBps: 4, maxParticipation: 0.1 });
assert.equal(buy.filledQuantity, 10, 'fill capped by liquidity participation');
assert.equal(buy.remainingQuantity, 10);
assert.ok(buy.executionPrice > 100, 'buy price includes spread and slippage');
assert.ok(buy.fee > 0);

const sell = simulateExecution({ side: 'SELL', referencePrice: 100, quantity: 5, candleVolume: 100, feeRate: 0.001, slippageBps: 10, spreadBps: 4, maxParticipation: 0.1 });
assert.equal(sell.filledQuantity, 5);
assert.ok(sell.executionPrice < 100, 'sell price includes spread and slippage');
assert.ok(sell.fee > 0);

const noLiquidity = simulateExecution({ side: 'BUY', referencePrice: 100, quantity: 1, candleVolume: 0, feeRate: 0, slippageBps: 0, spreadBps: 0, maxParticipation: 0.1 });
assert.equal(noLiquidity.filledQuantity, 0);
assert.equal(noLiquidity.remainingQuantity, 1);
assert.equal(noLiquidity.fee, 0);

assert.throws(() => simulateExecution({ side: 'BUY', referencePrice: 0, quantity: 1, candleVolume: 10, feeRate: 0, slippageBps: 0, spreadBps: 0, maxParticipation: 0.1 }), /positive/);
console.log('realistic execution tests passed');
