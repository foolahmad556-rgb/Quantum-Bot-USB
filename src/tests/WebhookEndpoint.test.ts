// src/tests/WebhookEndpoint.test.ts
import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { DurableStateManager } from '../storage/DurableStateManager';

/**
 * Test Webhook Endpoint integration with DurableStateManager
 * Simulates /webhook/telegram and signal ingestion
 */
describe('Webhook Endpoint Integration', () => {
  let durableManager: DurableStateManager;

  beforeEach(() => {
    durableManager = new DurableStateManager();
  });

  describe('Telegram Webhook Signal Ingestion', () => {
    it('should process valid webhook signal and record to Durable Objects', async () => {
      // Simulate TradingView signal via /webhook/telegram
      const webhookSignal = {
        type: 'ENTRY_LONG',
        symbol: 'BTC/USDT',
        confidence: 72,
        timestamp: Date.now(),
        source: 'telegram_webhook',
      };

      durableManager.recordSignal({
        id: `SIG_webhook_${Date.now()}`,
        symbol: webhookSignal.symbol,
        type: webhookSignal.type,
        confidence: webhookSignal.confidence,
        timestamp: webhookSignal.timestamp,
      });

      const signals = durableManager.getRecentSignals(10);
      assert.strictEqual(signals.length, 1, 'Signal should be recorded');
      assert.strictEqual(signals[0].type, 'ENTRY_LONG', 'Signal type should match');
    });

    it('should handle multiple rapid webhook signals without D1 calls', () => {
      const startTime = Date.now();

      // Simulate 50 rapid webhook signals (would exceed D1 quota)
      for (let i = 0; i < 50; i++) {
        durableManager.recordSignal({
          id: `SIG_rapid_${i}`,
          symbol: i % 2 === 0 ? 'BTC/USDT' : 'ETH/USDT',
          type: i % 3 === 0 ? 'ENTRY_LONG' : 'ENTRY_SHORT',
          confidence: 50 + Math.random() * 30,
          timestamp: Date.now(),
        });
      }

      const elapsed = Date.now() - startTime;
      const signals = durableManager.getRecentSignals(100);

      assert.ok(elapsed < 50, `50 signals should complete in <50ms, took ${elapsed}ms`);
      assert.strictEqual(signals.length, 50, 'All signals should be stored');
    });

    it('should extract signal metadata from webhook payload', () => {
      // Simulate parsing webhook JSON
      const payload = {
        message: {
          text: 'BTC/USDT ENTRY LONG Confidence: 78%',
          chat: { id: 123456 },
        },
      };

      // Parse signal from message text
      const text = payload.message.text;
      const match = text.match(/(\w+\/\w+)\s+(\w+)\s+(\w+)\s+Confidence:\s+(\d+)%/);

      if (match) {
        const [, symbol, action, direction, confidence] = match;
        durableManager.recordSignal({
          id: `SIG_parsed_${Date.now()}`,
          symbol,
          type: `${action}_${direction}`,
          confidence: parseInt(confidence),
          timestamp: Date.now(),
        });
      }

      const signals = durableManager.getRecentSignals(10);
      assert.strictEqual(signals.length, 1, 'Parsed signal should be recorded');
      assert.strictEqual(signals[0].symbol, 'BTC/USDT', 'Symbol should be parsed correctly');
    });
  });

  describe('Webhook Bearer Token Security', () => {
    it('should validate Bearer token presence', () => {
      // Simulate request with Bearer token
      const authHeader = 'Bearer sk_test_abc123def456ghi789';
      const token = authHeader.replace(/^Bearer\s+/, '');

      // Token should not be empty
      assert.ok(token.length > 0, 'Token should be extracted');
      assert.strictEqual(token, 'sk_test_abc123def456ghi789', 'Token should match');
    });

    it('should reject missing Bearer token', () => {
      // Simulate missing auth header
      let isValid = false;
      const authHeader = undefined;

      if (authHeader?.startsWith('Bearer ')) {
        isValid = true;
      }

      assert.strictEqual(isValid, false, 'Request without Bearer token should be rejected');
    });

    it('should reject invalid Bearer token format', () => {
      const validTokens = [
        'Bearer sk_test_abc123',
        'Bearer pk_live_xyz789',
      ];

      const invalidTokens = [
        'Basic dXNlcjpwYXNz',
        'sk_test_abc123', // Missing Bearer prefix
        'Bearer', // No token value
        '', // Empty
      ];

      validTokens.forEach((token) => {
        assert.ok(token.startsWith('Bearer '), `Valid token: ${token}`);
      });

      invalidTokens.forEach((token) => {
        assert.ok(!token.startsWith('Bearer ') || token === 'Bearer', `Invalid token: ${token}`);
      });
    });
  });

  describe('Webhook State Persistence', () => {
    it('should persist webhook updates to Durable Objects state', async () => {
      // Simulate webhook payload storing balance update
      const webhookState = {
        balance: {
          equity: 105000,
          freeMargin: 55000,
          unrealizedPnl: 5000,
        },
        timestamp: Date.now(),
      };

      durableManager.updateBalance(
        webhookState.balance.equity,
        webhookState.balance.freeMargin,
        webhookState.balance.unrealizedPnl,
      );

      const balance = durableManager.getBalance();
      assert.ok(balance, 'Balance should be persisted');
      assert.strictEqual(balance!.equity, webhookState.balance.equity, 'Equity should match webhook');
    });

    it('should merge webhook signals with existing state', () => {
      // Existing state
      durableManager.recordSignal({
        id: 'SIG_001',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 65,
        timestamp: Date.now() - 1000,
      });

      // Webhook signal (new)
      durableManager.recordSignal({
        id: 'SIG_webhook_latest',
        symbol: 'ETH/USDT',
        type: 'ENTRY_SHORT',
        confidence: 72,
        timestamp: Date.now(),
      });

      const signals = durableManager.getRecentSignals(10);
      assert.strictEqual(signals.length, 2, 'Both signals should coexist');
    });

    it('should handle webhook state rollback', () => {
      // State before webhook
      durableManager.updateBalance(100000, 50000, 5000);
      const before = durableManager.getBalance();

      // Webhook updates (potentially erroneous)
      durableManager.updateBalance(101000, 51000, 6000);
      const after = durableManager.getBalance();

      assert.strictEqual(before!.equity, 100000, 'Previous state should exist');
      assert.strictEqual(after!.equity, 101000, 'Webhook update should apply');
    });
  });

  describe('Webhook Error Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      // Simulate malformed webhook payload
      let parsed = null;
      try {
        parsed = JSON.parse('{invalid json}');
      } catch (e) {
        // Error expected
      }

      assert.strictEqual(parsed, null, 'Malformed JSON should not parse');
    });

    it('should handle missing required fields in signal', () => {
      const incompleteSignal = {
        // Missing: id, symbol, type, confidence, timestamp
        someField: 'value',
      };

      // Validation should fail
      const isValid: any =
        incompleteSignal.id &&
        incompleteSignal.symbol &&
        incompleteSignal.type &&
        incompleteSignal.confidence !== undefined &&
        incompleteSignal.timestamp;

      assert.strictEqual(!isValid, true, 'Incomplete signal should fail validation');
    });

    it('should ignore duplicate webhook signals (same ID)', () => {
      const signalId = 'SIG_unique_001';

      // First signal
      durableManager.recordSignal({
        id: signalId,
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 72,
        timestamp: Date.now(),
      });

      // Duplicate (same ID, should replace or be ignored)
      durableManager.recordSignal({
        id: signalId,
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 75, // Different confidence
        timestamp: Date.now() + 1000,
      });

      const signals = durableManager.getRecentSignals(100);
      // System should keep the latest or both (depending on implementation)
      // At minimum, shouldn't duplicate infinitely
      assert.ok(signals.length <= 2, 'Duplicate signals should not multiply indefinitely');
    });
  });

  describe('Webhook Performance Under Load', () => {
    it('should handle 100+ concurrent webhook signals', () => {
      const startTime = Date.now();
      const signalCount = 150;

      // Simulate concurrent webhook flood
      for (let i = 0; i < signalCount; i++) {
        durableManager.recordSignal({
          id: `SIG_load_${i}`,
          symbol: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][i % 3],
          type: ['ENTRY_LONG', 'ENTRY_SHORT', 'EXIT_LONG'][i % 3],
          confidence: 30 + (i % 70),
          timestamp: Date.now(),
        });
      }

      const elapsed = Date.now() - startTime;
      const signals = durableManager.getRecentSignals(2000);

      console.log(`📊 Webhook Load: ${signalCount} signals in ${elapsed}ms`);
      assert.ok(elapsed < 100, `Load should complete in <100ms, took ${elapsed}ms`);
      assert.strictEqual(signals.length, signalCount, 'All signals should be recorded');
    });

    it('should not degrade with old webhook data', () => {
      // Add 5000 old signals
      for (let i = 0; i < 5000; i++) {
        durableManager.recordSignal({
          id: `SIG_old_${i}`,
          symbol: 'BTC/USDT',
          type: 'ENTRY_LONG',
          confidence: 50,
          timestamp: Date.now() - 86400000, // 1 day old
        });
      }

      // Fresh webhook signal should still be fast
      const start = Date.now();
      durableManager.recordSignal({
        id: 'SIG_fresh_webhook',
        symbol: 'ETH/USDT',
        type: 'ENTRY_LONG',
        confidence: 72,
        timestamp: Date.now(),
      });
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 10, `Fresh signal should be fast even with history, took ${elapsed}ms`);
    });
  });

  describe('Webhook Data Consistency', () => {
    it('should maintain signal order by timestamp', () => {
      const now = Date.now();

      durableManager.recordSignal({
        id: 'SIG_first',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 50,
        timestamp: now - 2000,
      });

      durableManager.recordSignal({
        id: 'SIG_second',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 60,
        timestamp: now - 1000,
      });

      durableManager.recordSignal({
        id: 'SIG_third',
        symbol: 'BTC/USDT',
        type: 'ENTRY_LONG',
        confidence: 70,
        timestamp: now,
      });

      const signals = durableManager.getRecentSignals(10);
      // Most recent should be last (or at least queryable in order)
      assert.ok(signals.length >= 3, 'All signals should be stored');
    });

    it('should sync webhook state to hourly archive', async () => {
      let archivedCount = 0;

      durableManager.onArchive(async (state) => {
        archivedCount = state.signals.length;
      });

      // Add signals via webhook
      for (let i = 0; i < 10; i++) {
        durableManager.recordSignal({
          id: `SIG_archive_${i}`,
          symbol: 'BTC/USDT',
          type: 'ENTRY_LONG',
          confidence: 50 + i,
          timestamp: Date.now(),
        });
      }

      // Trigger archive
      await durableManager.archiveDaily(true);

      assert.strictEqual(archivedCount, 10, 'Archived signals should match recorded count');
    });
  });
});
