import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HybridReconciliationManager } from '../exchange/HybridReconciliationManager';

function makeHybrid(stub: Partial<{
  connected: boolean;
  account: any;
  positions: any[];
  hasSnapshot: boolean;
}>) {
  const hybrid = new HybridReconciliationManager('unused', 'unused');
  (hybrid as any).wsManager = {
    getConnectionStatus: () => stub.connected ?? false,
    getAccount: () => stub.account ?? null,
    getPositions: () => stub.positions ?? [],
    hasValidPositionSnapshot: () => stub.hasSnapshot ?? false,
  };
  // Exhaust the REST fallback budget so no network call is attempted.
  (hybrid as any).lastRestFallback = Date.now();
  return hybrid;
}

const account = { totalWalletBalance: 1000 };
const position = {
  symbol: 'BTCUSDT', positionAmt: 0.1, entryPrice: 40000,
  markPrice: 40100, unRealizedProfit: 10, positionSide: 'BOTH', timestamp: 1,
};

describe('HybridReconciliationManager fail-closed snapshots', () => {
  it('returns websocket source only with account AND a verified position snapshot', async () => {
    const hybrid = makeHybrid({ connected: true, account, positions: [position], hasSnapshot: true });
    const result = await hybrid.getReconciliation();
    assert.equal(result.source, 'websocket');
    assert.equal(result.positions.length, 1);
  });

  it('fails instead of serving empty/stale positions when snapshot flag is false', async () => {
    const hybrid = makeHybrid({ connected: true, account, positions: [], hasSnapshot: false });
    await assert.rejects(() => hybrid.getReconciliation(), /No valid reconciliation snapshot/);
  });

  it('fails when the socket reports connected but no account data arrived', async () => {
    const hybrid = makeHybrid({ connected: true, account: null, positions: [], hasSnapshot: false });
    await assert.rejects(() => hybrid.getReconciliation(), /No valid reconciliation snapshot/);
  });

  it('fails closed when disconnected and the cached snapshot is unverified', async () => {
    const hybrid = makeHybrid({ connected: false, account, positions: [], hasSnapshot: false });
    await assert.rejects(() => hybrid.getReconciliation(), /No valid reconciliation snapshot/);
  });

  it('requireCachedSnapshot returns verified cache data when available', () => {
    const hybrid = makeHybrid({ connected: true, account, positions: [position], hasSnapshot: true });
    const cached = (hybrid as any).requireCachedSnapshot();
    assert.equal(cached.source, 'websocket');
    assert.equal(cached.positions.length, 1);
    assert.equal(cached.account, account);
  });
});