import assert from 'node:assert/strict';
import { TradingPipeline } from '../app/TradingPipeline';
import { PartialProfitManager } from '../execution/PartialProfitManager';
const trades = new Map<string, any>();
const partial = new PartialProfitManager({} as any);
const pipeline: any = Object.create(TradingPipeline.prototype);
let alerts = 0;
Object.assign(pipeline, {
  db: {
    getState: async () => null, saveState: async () => {},
    getOpenTrades: async () => [...trades.values()],
    saveTrade: async (trade: any) => { trades.set(trade.id, trade); },
    closeTrade: async () => { throw new Error('Existing exchange position must remain open'); },
  },
  orderGateway: {getApiKey: () => 'test', getApiSecret: () => 'test', getApiBaseUrl: () => 'unused', getExecutionMode: () => 'TESTNET'},
  hybridReconciliationManager: {getReconciliation: async () => ({
    source: 'rest', account: {totalWalletBalance: 1000, totalUnrealizedProfit: 0, availableBalance: 900},
    positions: [{symbol: 'SUNUSDT', positionAmt: -1818, entryPrice: 0.016496, markPrice: 0.0165, positionSide: 'SHORT'}],
  })},
  portfolioSizer: {updateBalance: () => {}},
  userDataStream: {adoptPosition: () => {}},
  partialProfitManager: partial,
  scaleInManager: {registerOriginalPosition: () => {}},
  telegramService: {sendMessage: async () => { alerts++; }},
  killSwitch: {trigger: (_: unknown, reason: string) => { throw new Error(reason); }},
});
await pipeline.reconcileState();
await pipeline.reconcileState();
assert.equal(trades.size, 1);
assert.equal([...trades.values()][0].positionSide, 'SHORT');
assert.equal(partial.getReport().positions[0].remainingQuantity, 1818);
assert.equal(alerts, 1, 'Repeated snapshots must not adopt and notify twice');
console.log('PASS repeated orphan reconciliation preserves authoritative position quantity');
