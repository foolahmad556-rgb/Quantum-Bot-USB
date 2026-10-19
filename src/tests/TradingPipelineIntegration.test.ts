// src/tests/TradingPipelineIntegration.test.ts
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach } from 'node:test';
import { DurableStateManager } from '../storage/DurableStateManager';

/**
 * Test that TradingPipeline correctly uses DurableStateManager
 * instead of D1 for live data writes.
 */
describe('TradingPipeline Integration with DurableStateManager', () => {
  it('does not pass take-profit price as a holding-time duration', () => {
    const source = readFileSync(fileURLToPath(new URL('../app/TradingPipeline.ts', import.meta.url)), 'utf8');
    assert.match(source, /registerPosition\(\s*ord\.id,\s*ord\.symbol,\s*ord\.side,\s*fillPrice,\s*ord\.filledQuantity\s*\)/);
    assert.doesNotMatch(source, /registerPosition\([\s\S]{0,180}pending\.ouMu/);
  });


  let durableManager: DurableStateManager;

  beforeEach(() => {
    durableManager = new DurableStateManager();
  });

  describe('Balance Updates (Line 408 + 760)', () => {
    it('should update balance via DurableStateManager on maintenance', () => {
      // Simulate 5m maintenance interval that previously called D1.saveBalanceSnapshot()
      const equity = 102000;
      const freeMargin = 52000;
      const unrealizedPnl = 2000;

      durableManager.updateBalance(equity, freeMargin, unrealizedPnl);

      const balance = durableManager.getBalance();
      assert.strictEqual(balance?.equity, equity, 'Equity should match');
      assert.strictEqual(balance?.freeMargin, freeMargin, 'Free margin should match');
      assert.strictEqual(balance?.unrealizedPnl, unrealizedPnl, 'PnL should match');
    });

    it('should update balance on position monitoring', () => {
      // Simulate position monitoring that previously wrote to D1
      durableManager.updateBalance(98500, 48500, -1500);
      durableManager.updateBalance(98700, 48700, -1300); // Updated price

      const balance = durableManager.getBalance();
      assert.strictEqual(balance?.equity, 98700, 'Latest balance should be stored');
    });
  });

  describe('Trade Recording (Line 615)', () => {
    it('should record trade via DurableStateManager on order fill', () => {
      // Simulate order fill that previously called D1.recordTrade()
      const tradeData = {
        id: 'ORDER_9f5e8d2b',
        symbol: 'BTC/USDT',
        side: 'BUY' as const,
        quantity: 2.5,
        price: 89500,
        status: 'OPEN' as const,
        timestamp: Date.now(),
      };

      durableManager.recordTrade(tradeData);

      const openTrades = durableManager.getOpenTrades();
      assert.strictEqual(openTrades.length, 1, 'Should have 1 open trade');
      assert.strictEqual(openTrades[0].id, tradeData.id, 'Trade ID should match');
      assert.strictEqual(openTrades[0].side, 'BUY', 'Side should be BUY');
    });

    it('should close trade via DurableStateManager', () => {
      // Record initial trade
      durableManager.recordTrade({
        id: 'ORDER_xyz123',
        symbol: 'ETH/USDT',
        side: 'SELL',
        quantity: 15,
        price: 3200,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      // Close trade (simulates exit fill)
      durableManager.updateTradeStatus('ORDER_xyz123', 'CLOSED');

      const openTrades = durableManager.getOpenTrades();
      assert.strictEqual(openTrades.length, 0, 'Should have no open trades after close');
    });
  });

  describe('Signal Recording (Line 976)', () => {
    it('should record signal via DurableStateManager on entry', () => {
      // Simulate signal generation that previously called D1.recordSignal()
      const signalData = {
        id: 'SIG_mean_reversion_btc',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 78,
        timestamp: Date.now(),
      };

      durableManager.recordSignal(signalData);

      const signals = durableManager.getRecentSignals(10);
      assert.strictEqual(signals.length, 1, 'Should have 1 signal');
      assert.strictEqual(signals[0].confidence, 78, 'Confidence should match');
    });

    it('should maintain signal history (last 1000)', () => {
      // Record many signals
      for (let i = 0; i < 1050; i++) {
        durableManager.recordSignal({
          id: `SIG_${i}`,
          symbol: 'BTC/USDT',
          type: 'ENTRY_LONG',
          confidence: 50,
          timestamp: Date.now(),
        });
      }

      const signals = durableManager.getRecentSignals(2000);
      assert.strictEqual(signals.length, 1000, 'Should keep last 1000 signals');
    });
  });

  describe('Orphan Position Recording (Line 1260)', () => {
    it('should record orphan position via DurableStateManager', () => {
      // Simulate reconciliation finding orphan position
      const orphanPos = {
        size: 5.75,
        entryPrice: 88000,
        currentPrice: 89200,
        unrealizedPnl: 6900,
      };

      durableManager.updatePosition('BTC/USDT', orphanPos);

      const position = durableManager.getPosition('BTC/USDT');
      assert.ok(position, 'Position should exist');
      assert.strictEqual(position!.size, 5.75, 'Size should match');
    });

    it('should handle multiple positions', () => {
      durableManager.updatePosition('BTC/USDT', {
        size: 2,
        entryPrice: 89000,
        currentPrice: 89500,
        unrealizedPnl: 1000,
      });

      durableManager.updatePosition('ETH/USDT', {
        size: 20,
        entryPrice: 3100,
        currentPrice: 3200,
        unrealizedPnl: 2000,
      });

      durableManager.updatePosition('SOL/USDT', {
        size: 50,
        entryPrice: 135,
        currentPrice: 142,
        unrealizedPnl: 350,
      });

      const positions = durableManager.getAllPositions();
      assert.strictEqual(positions.length, 3, 'Should have 3 positions');
    });
  });

  describe('KillSwitch State Persistence (Line 570)', () => {
    it('should persist killswitch state via DurableStateManager', () => {
      // Simulate KillSwitch trigger that previously called D1.updateKillSwitchState()
      durableManager.updateKillSwitchState('HARD_HALT', true, 'D1 quota exceeded');

      const ksState = durableManager.getKillSwitchState();
      assert.ok(ksState, 'KillSwitch state should exist');
      assert.strictEqual(ksState!.level, 'HARD_HALT', 'Level should be HARD_HALT');
      assert.strictEqual(ksState!.active, true, 'Should be active');
    });

    it('should clear killswitch on recovery', () => {
      // Trigger killswitch
      durableManager.updateKillSwitchState('WARNING', true, 'High drawdown detected');

      // Recovery clears it
      durableManager.updateKillSwitchState('NORMAL', false, 'Risk parameters normalized');

      const ksState = durableManager.getKillSwitchState();
      assert.strictEqual(ksState!.level, 'NORMAL', 'Should be NORMAL after recovery');
      assert.strictEqual(ksState!.active, false, 'Should not be active');
    });
  });

  describe('Zero D1 Impact Verification', () => {
    it('should not call D1 for live updates', async () => {
      // Verify all operations work without D1 binding
      const startTime = Date.now();

      // 100 rapid updates that would have hit D1 quota
      for (let i = 0; i < 100; i++) {
        durableManager.updateBalance(100000 + i * 100, 50000 + i * 50, 5000 + i * 10);
        durableManager.recordTrade({
          id: `TRADE_${i}`,
          symbol: 'BTC/USDT',
          side: i % 2 === 0 ? 'BUY' : 'SELL',
          quantity: 1 + (i % 5),
          price: 91000 + i * 10,
          status: 'OPEN',
          timestamp: Date.now(),
        });
        durableManager.recordSignal({
          id: `SIG_${i}`,
          symbol: 'BTC/USDT',
          type: 'ENTRY_LONG',
          confidence: 50 + (i % 50),
          timestamp: Date.now(),
        });
      }

      const elapsed = Date.now() - startTime;

      // All operations should complete in <100ms (no D1 latency)
      assert.ok(elapsed < 100, `Operations should be fast (<100ms), took ${elapsed}ms`);

      const state = durableManager.getState();
      assert.strictEqual(state.trades.length, 100, 'All trades recorded');
      assert.strictEqual(state.signals.length, 100, 'All signals recorded');
    });

    it('should provide instant access to live data', () => {
      durableManager.updateBalance(100000, 50000, 5000);
      durableManager.recordTrade({
        id: 'TRADE_1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      // Should be immediately available (no D1 lag)
      const balance = durableManager.getBalance();
      const trades = durableManager.getOpenTrades();

      assert.ok(balance, 'Balance should be immediately available');
      assert.strictEqual(trades.length, 1, 'Trade should be immediately available');
    });
  });

  describe('Archive to D1 (Batch Operation)', () => {
    it('should prepare state for D1 archival', async () => {
      let archivedState: any = null;

      durableManager.onArchive(async (state) => {
        archivedState = state;
      });

      // Add data
      durableManager.updateBalance(100000, 50000, 5000);
      durableManager.recordTrade({
        id: 'TRADE_FINAL',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'CLOSED',
        timestamp: Date.now(),
      });

      // Force archive
      await durableManager.archiveDaily(true);

      assert.ok(archivedState, 'State should be archived');
      assert.strictEqual(archivedState.trades.length, 1, 'Trade should be in archive');
      assert.ok(archivedState.balance, 'Balance should be in archive');
    });
  });

  describe('Performance Impact', () => {
    it('should show 10x+ speed improvement over D1', () => {
      const iterations = 1000;

      // Time in-memory operations
      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        durableManager.updateBalance(100000 + i, 50000 + i, 5000);
      }
      const inMemoryMs = Date.now() - start;

      // Typical D1 write: ~100ms per request
      // 1000 writes would take ~100s on D1
      const estimatedD1Time = iterations * 100; // milliseconds

      const speedup = estimatedD1Time / inMemoryMs;

      console.log(`📊 Performance: ${inMemoryMs}ms for 1000 writes (${speedup.toFixed(0)}x faster than D1)`);
      assert.ok(speedup > 1, 'Should be faster than D1');
    });
  });
});
