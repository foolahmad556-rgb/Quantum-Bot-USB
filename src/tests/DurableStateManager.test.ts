// src/tests/DurableStateManager.test.ts
import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { DurableStateManager } from '../storage/DurableStateManager';

describe('DurableStateManager', () => {
  let manager: DurableStateManager;

  beforeEach(() => {
    manager = new DurableStateManager();
  });

  describe('Balance Management', () => {
    it('should update and retrieve balance', () => {
      manager.updateBalance(100000, 50000, 5000);
      const balance = manager.getBalance();

      assert.ok(balance !== null, 'Balance should not be null');
      assert.strictEqual(balance!.equity, 100000, 'Equity should be 100000');
      assert.strictEqual(balance!.freeMargin, 50000, 'Free margin should be 50000');
      assert.strictEqual(balance!.unrealizedPnl, 5000, 'Unrealized PnL should be 5000');
    });

    it('should timestamp balance updates', () => {
      const before = Date.now();
      manager.updateBalance(100000, 50000, 5000);
      const after = Date.now();
      const balance = manager.getBalance();

      assert.ok(balance!.timestamp >= before && balance!.timestamp <= after, 'Timestamp should be current');
    });
  });

  describe('Trade Recording', () => {
    it('should record new trade', () => {
      manager.recordTrade({
        id: 'TRADE_001',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1.5,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      const openTrades = manager.getOpenTrades();
      assert.strictEqual(openTrades.length, 1, 'Should have 1 open trade');
      assert.strictEqual(openTrades[0].id, 'TRADE_001', 'Trade ID should match');
    });

    it('should update trade status', () => {
      manager.recordTrade({
        id: 'TRADE_002',
        symbol: 'ETH/USDT',
        side: 'SELL',
        quantity: 10,
        price: 3500,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      manager.updateTradeStatus('TRADE_002', 'CLOSED');
      const openTrades = manager.getOpenTrades();

      assert.strictEqual(openTrades.length, 0, 'Should have no open trades');
    });

    it('should filter open trades by symbol', () => {
      manager.recordTrade({
        id: 'TRADE_A',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      manager.recordTrade({
        id: 'TRADE_B',
        symbol: 'ETH/USDT',
        side: 'BUY',
        quantity: 10,
        price: 3500,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      const btcTrades = manager.getOpenTrades('BTC/USDT');
      assert.strictEqual(btcTrades.length, 1, 'Should have 1 BTC trade');
      assert.strictEqual(btcTrades[0].id, 'TRADE_A', 'BTC trade ID should be TRADE_A');
    });
  });

  describe('Position Management', () => {
    it('should update and retrieve position', () => {
      manager.updatePosition('BTC/USDT', {
        size: 2.5,
        entryPrice: 90000,
        currentPrice: 91000,
        unrealizedPnl: 2500,
      });

      const position = manager.getPosition('BTC/USDT');
      assert.ok(position !== null, 'Position should exist');
      assert.strictEqual(position!.size, 2.5, 'Position size should be 2.5');
      assert.strictEqual(position!.currentPrice, 91000, 'Current price should be 91000');
    });

    it('should get all open positions', () => {
      manager.updatePosition('BTC/USDT', {
        size: 1,
        entryPrice: 91000,
        currentPrice: 91000,
        unrealizedPnl: 0,
      });

      manager.updatePosition('ETH/USDT', {
        size: 10,
        entryPrice: 3500,
        currentPrice: 3500,
        unrealizedPnl: 0,
      });

      const positions = manager.getAllPositions();
      assert.strictEqual(positions.length, 2, 'Should have 2 positions');
    });
  });

  describe('Signal Recording', () => {
    it('should record signals', () => {
      manager.recordSignal({
        id: 'SIG_001',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 75,
        timestamp: Date.now(),
      });

      const signals = manager.getRecentSignals(10);
      assert.strictEqual(signals.length, 1, 'Should have 1 signal');
      assert.strictEqual(signals[0].confidence, 75, 'Signal confidence should be 75');
    });

    it('should limit signals to last 1000', () => {
      for (let i = 0; i < 1050; i++) {
        manager.recordSignal({
          id: `SIG_${i}`,
          symbol: 'BTC/USDT',
          type: 'ENTRY_LONG',
          confidence: 50,
          timestamp: Date.now(),
        });
      }

      const signals = manager.getRecentSignals(2000);
      assert.strictEqual(signals.length, 1000, 'Should keep only last 1000 signals');
    });
  });

  describe('KillSwitch State', () => {
    it('should update killswitch state', () => {
      manager.updateKillSwitchState('HARD_HALT', true, 'D1 quota exceeded');
      const state = manager.getKillSwitchState();

      assert.ok(state !== null, 'KillSwitch state should exist');
      assert.strictEqual(state!.level, 'HARD_HALT', 'Level should be HARD_HALT');
      assert.strictEqual(state!.active, true, 'Should be active');
      assert.strictEqual(state!.reason, 'D1 quota exceeded', 'Reason should match');
    });

    it('should clear previous killswitch state on new update', () => {
      manager.updateKillSwitchState('WARNING', true, 'High drawdown');
      manager.updateKillSwitchState('NORMAL', false, 'Risk cleared');

      const state = manager.getKillSwitchState();
      assert.strictEqual(state!.level, 'NORMAL', 'Level should be NORMAL');
      assert.strictEqual(state!.active, false, 'Should not be active');
    });
  });

  describe('State Snapshot', () => {
    it('should return full state snapshot', () => {
      manager.updateBalance(100000, 50000, 5000);
      manager.recordTrade({
        id: 'TRADE_001',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      const state = manager.getState();

      assert.ok(state.balance !== null, 'Balance should exist');
      assert.strictEqual(state.trades.length, 1, 'Should have 1 trade');
      assert.ok(state.lastArchiveTime > 0, 'Archive time should be set');
    });
  });

  describe('Stats', () => {
    it('should return correct stats', () => {
      manager.recordTrade({
        id: 'TRADE_001',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      manager.recordTrade({
        id: 'TRADE_002',
        symbol: 'ETH/USDT',
        side: 'SELL',
        quantity: 10,
        price: 3500,
        status: 'CLOSED',
        timestamp: Date.now(),
      });

      manager.updateBalance(100000, 50000, 5000);

      const stats = manager.getStats();

      assert.strictEqual(stats.openTrades, 1, 'Should have 1 open trade');
      assert.strictEqual(stats.closedTrades, 1, 'Should have 1 closed trade');
      assert.strictEqual(stats.currentBalance, 100000, 'Balance should be 100000');
    });
  });

  describe('Archive Callback', () => {
    it('should call archive callback when registered', async () => {
      let archiveCalled = false;
      let archivedState: any = null;

      manager.onArchive(async (state) => {
        archiveCalled = true;
        archivedState = state;
      });

      manager.updateBalance(100000, 50000, 5000);
      await manager.archiveDaily(true); // forceArchive=true to skip hour check in test

      assert.strictEqual(archiveCalled, true, 'Archive callback should be called');
      assert.ok(archivedState !== null, 'State should be archived');
    });
  });

  describe('State Clearing', () => {
    it('should clear all state', () => {
      manager.recordTrade({
        id: 'TRADE_001',
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 1,
        price: 91000,
        status: 'OPEN',
        timestamp: Date.now(),
      });

      manager.updateBalance(100000, 50000, 5000);

      manager.clearState();
      const state = manager.getState();

      assert.strictEqual(state.trades.length, 0, 'Trades should be cleared');
      assert.strictEqual(state.balance, null, 'Balance should be null');
    });
  });
});
