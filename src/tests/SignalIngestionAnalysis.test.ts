import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

/**
 * Signal Ingestion Analysis: Trace signal lifecycle from webhook → D1 → Hyperdrive
 * No Cloudflare deps. Pure local simulation of signal routing & persistence.
 */

class SignalLifecycleTracer {
  private events: Array<{ ts: number; stage: string; signal: string; status: string }> = [];

  async traceSignal(signalId: string, payload: any): Promise<void> {
    // Stage 1: Webhook arrival
    this.events.push({
      ts: Date.now(),
      stage: 'WEBHOOK_RECEIVED',
      signal: signalId,
      status: 'OK',
    });

    // Stage 2: Validation
    if (!payload.symbol || !payload.type) {
      this.events.push({
        ts: Date.now(),
        stage: 'VALIDATION_FAILED',
        signal: signalId,
        status: 'INVALID_PAYLOAD',
      });
      throw new Error('Invalid payload');
    }

    this.events.push({
      ts: Date.now(),
      stage: 'VALIDATION_PASSED',
      signal: signalId,
      status: 'OK',
    });

    // Stage 3: D1 Hot Storage
    this.events.push({
      ts: Date.now(),
      stage: 'D1_STORE_START',
      signal: signalId,
      status: 'PENDING',
    });

    await new Promise(r => setTimeout(r, 5)); // simulate D1 latency

    this.events.push({
      ts: Date.now(),
      stage: 'D1_STORE_COMPLETE',
      signal: signalId,
      status: 'OK',
    });

    // Stage 4: Hyperdrive Archive (async, fire-and-forget)
    setImmediate(async () => {
      this.events.push({
        ts: Date.now(),
        stage: 'HYPERDRIVE_ARCHIVE_START',
        signal: signalId,
        status: 'PENDING',
      });

      await new Promise(r => setTimeout(r, 10)); // simulate Hyperdrive latency

      this.events.push({
        ts: Date.now(),
        stage: 'HYPERDRIVE_ARCHIVE_COMPLETE',
        signal: signalId,
        status: 'OK',
      });
    });
  }

  getLifecycle(signalId: string) {
    return this.events.filter(e => e.signal === signalId);
  }

  getAllEvents() {
    return this.events;
  }
}

class SignalRoutingAnalyzer {
  private routed: Map<string, any> = new Map();

  routeSignal(signalId: string, payload: any): { route: string; destination: string } {
    // Route based on confidence & symbol
    const high_confidence = payload.confidence > 0.8;
    const btc_correlated = ['BTC', 'ETH', 'LINK'].some(sym => payload.symbol?.includes(sym));

    let route: string;
    let destination: string;

    if (high_confidence && btc_correlated) {
      route = 'PRIORITY_HOT_PATH';
      destination = 'D1_CACHE + HYPERDRIVE_ARCHIVE';
    } else if (high_confidence) {
      route = 'HOT_PATH';
      destination = 'D1_CACHE';
    } else {
      route = 'COLD_PATH';
      destination = 'HYPERDRIVE_ONLY';
    }

    this.routed.set(signalId, {
      route,
      destination,
      payload,
      timestamp: Date.now(),
    });

    return { route, destination };
  }

  getRoutingStats() {
    const stats = { PRIORITY_HOT_PATH: 0, HOT_PATH: 0, COLD_PATH: 0 };
    for (const [, entry] of this.routed) {
      stats[entry.route as keyof typeof stats]++;
    }
    return stats;
  }
}

class SignalPersistenceValidator {
  private d1Records: Map<string, any> = new Map();
  private hyperdriveRecords: any[] = [];

  async storeD1(signalId: string, payload: any): Promise<void> {
    this.d1Records.set(signalId, {
      ...payload,
      backend: 'D1',
      storedAt: Date.now(),
    });
  }

  async archiveHyperdrive(signalId: string, payload: any): Promise<void> {
    this.hyperdriveRecords.push({
      id: signalId,
      ...payload,
      backend: 'HYPERDRIVE',
      archivedAt: Date.now(),
    });
  }

  validateD1Persistence(signalId: string): boolean {
    return this.d1Records.has(signalId);
  }

  validateHyperdrivePersistence(signalId: string): boolean {
    return this.hyperdriveRecords.some(r => r.id === signalId);
  }

  validateCrossPersistence(signalId: string): boolean {
    return this.validateD1Persistence(signalId) && this.validateHyperdrivePersistence(signalId);
  }

  getD1Records() {
    return Array.from(this.d1Records.values());
  }

  getHyperdriveRecords() {
    return this.hyperdriveRecords;
  }
}

describe('Signal Ingestion Analysis', () => {
  let tracer: SignalLifecycleTracer;
  let router: SignalRoutingAnalyzer;
  let validator: SignalPersistenceValidator;

  beforeEach(() => {
    tracer = new SignalLifecycleTracer();
    router = new SignalRoutingAnalyzer();
    validator = new SignalPersistenceValidator();
  });

  describe('Signal Lifecycle Tracing', () => {
    it('should trace complete signal lifecycle', async () => {
      const signal = {
        id: 'trace-001',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.85,
        timestamp: Date.now(),
      };

      await tracer.traceSignal(signal.id, signal);
      const lifecycle = tracer.getLifecycle(signal.id);

      assert.ok(
        lifecycle.some(e => e.stage === 'WEBHOOK_RECEIVED'),
        'Should record webhook receipt'
      );
      assert.ok(
        lifecycle.some(e => e.stage === 'VALIDATION_PASSED'),
        'Should record validation'
      );
      assert.ok(
        lifecycle.some(e => e.stage === 'D1_STORE_COMPLETE'),
        'Should record D1 storage'
      );
    });

    it('should fail on invalid signal payload', async () => {
      const invalidSignal = {
        id: 'trace-002',
        // missing symbol
        type: 'BUY',
        confidence: 0.85,
      };

      try {
        await tracer.traceSignal(invalidSignal.id, invalidSignal);
        assert.fail('Should throw on invalid payload');
      } catch (e: any) {
        const lifecycle = tracer.getLifecycle(invalidSignal.id);
        assert.ok(
          lifecycle.some(e => e.stage === 'VALIDATION_FAILED'),
          'Should record validation failure'
        );
      }
    });

    it('should measure signal latency (webhook → D1 store)', async () => {
      const signal = {
        id: 'trace-003',
        symbol: 'ETH/USDT',
        type: 'SELL',
        confidence: 0.75,
        timestamp: Date.now(),
      };

      await tracer.traceSignal(signal.id, signal);
      const lifecycle = tracer.getLifecycle(signal.id);

      const webhookEvent = lifecycle.find(e => e.stage === 'WEBHOOK_RECEIVED');
      const d1CompleteEvent = lifecycle.find(e => e.stage === 'D1_STORE_COMPLETE');

      assert.ok(webhookEvent && d1CompleteEvent, 'Should have both events');

      const latency = d1CompleteEvent!.ts - webhookEvent!.ts;
      assert.ok(latency >= 5 && latency < 100, `Latency should be ~5ms, got ${latency}ms`);
    });
  });

  describe('Signal Routing Analysis', () => {
    it('should route high-confidence BTC-correlated signals to PRIORITY_HOT_PATH', () => {
      const signal = {
        id: 'route-001',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.95,
      };

      const { route, destination } = router.routeSignal(signal.id, signal);

      assert.strictEqual(route, 'PRIORITY_HOT_PATH');
      assert.ok(destination.includes('D1_CACHE'));
      assert.ok(destination.includes('HYPERDRIVE'));
    });

    it('should route high-confidence non-correlated signals to HOT_PATH', () => {
      const signal = {
        id: 'route-002',
        symbol: 'SHIB/USDT',
        type: 'BUY',
        confidence: 0.85,
      };

      const { route, destination } = router.routeSignal(signal.id, signal);

      assert.strictEqual(route, 'HOT_PATH');
      assert.strictEqual(destination, 'D1_CACHE');
    });

    it('should route low-confidence signals to COLD_PATH', () => {
      const signal = {
        id: 'route-003',
        symbol: 'DOGE/USDT',
        type: 'BUY',
        confidence: 0.55,
      };

      const { route, destination } = router.routeSignal(signal.id, signal);

      assert.strictEqual(route, 'COLD_PATH');
      assert.strictEqual(destination, 'HYPERDRIVE_ONLY');
    });

    it('should track routing distribution', () => {
      const signals = [
        { id: 's1', symbol: 'BTC/USDT', confidence: 0.95 },
        { id: 's2', symbol: 'ETH/USDT', confidence: 0.88 },
        { id: 's3', symbol: 'LINK/USDT', confidence: 0.92 },
        { id: 's4', symbol: 'SHIB/USDT', confidence: 0.85 }, // high-confidence non-correlated → HOT_PATH
        { id: 's5', symbol: 'DOGE/USDT', confidence: 0.45 },
      ];

      for (const sig of signals) {
        router.routeSignal(sig.id, sig);
      }

      const stats = router.getRoutingStats();
      assert.strictEqual(stats.PRIORITY_HOT_PATH, 3);
      assert.strictEqual(stats.HOT_PATH, 1);
      assert.strictEqual(stats.COLD_PATH, 1);
    });
  });

  describe('Signal Persistence Validation', () => {
    it('should validate D1 persistence', async () => {
      const signal = {
        id: 'persist-001',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.85,
      };

      await validator.storeD1(signal.id, signal);

      assert.ok(
        validator.validateD1Persistence(signal.id),
        'Signal should persist in D1'
      );
    });

    it('should validate Hyperdrive persistence', async () => {
      const signal = {
        id: 'persist-002',
        symbol: 'ETH/USDT',
        type: 'SELL',
        confidence: 0.75,
      };

      await validator.archiveHyperdrive(signal.id, signal);

      assert.ok(
        validator.validateHyperdrivePersistence(signal.id),
        'Signal should persist in Hyperdrive'
      );
    });

    it('should validate cross-persistence (D1 + Hyperdrive)', async () => {
      const signal = {
        id: 'persist-003',
        symbol: 'SOL/USDT',
        type: 'BUY',
        confidence: 0.8,
      };

      await validator.storeD1(signal.id, signal);
      await validator.archiveHyperdrive(signal.id, signal);

      assert.ok(
        validator.validateCrossPersistence(signal.id),
        'Signal should persist in both D1 and Hyperdrive'
      );
    });

    it('should recover signal from D1 after Hyperdrive failure', async () => {
      const signal = {
        id: 'persist-004',
        symbol: 'AVAX/USDT',
        type: 'BUY',
        confidence: 0.82,
      };

      await validator.storeD1(signal.id, signal);
      // Hyperdrive fails — no archive

      assert.ok(
        validator.validateD1Persistence(signal.id),
        'Signal should still be available in D1'
      );
      assert.strictEqual(
        validator.validateHyperdrivePersistence(signal.id),
        false,
        'Signal should not be in Hyperdrive'
      );
    });

    it('should batch archive multiple signals to Hyperdrive', async () => {
      const signals = [
        { id: 'batch-1', symbol: 'BTC/USDT', type: 'BUY', confidence: 0.9 },
        { id: 'batch-2', symbol: 'ETH/USDT', type: 'SELL', confidence: 0.85 },
        { id: 'batch-3', symbol: 'SOL/USDT', type: 'BUY', confidence: 0.88 },
      ];

      for (const sig of signals) {
        await validator.storeD1(sig.id, sig);
        await validator.archiveHyperdrive(sig.id, sig);
      }

      const hyperdriveRecords = validator.getHyperdriveRecords();
      assert.strictEqual(hyperdriveRecords.length, 3, 'Should archive 3 signals');

      for (const sig of signals) {
        assert.ok(
          validator.validateCrossPersistence(sig.id),
          `Signal ${sig.id} should be in both backends`
        );
      }
    });
  });

  describe('End-to-End Signal Flow', () => {
    it('should complete end-to-end signal flow', async () => {
      const signal = {
        id: 'e2e-001',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.92,
      };

      // 1. Route signal
      const { route } = router.routeSignal(signal.id, signal);
      assert.strictEqual(route, 'PRIORITY_HOT_PATH');

      // 2. Trace lifecycle
      await tracer.traceSignal(signal.id, signal);
      const lifecycle = tracer.getLifecycle(signal.id);
      assert.ok(
        lifecycle.some(e => e.stage === 'D1_STORE_COMPLETE'),
        'Should complete D1 storage'
      );

      // 3. Validate persistence
      await validator.storeD1(signal.id, signal);
      await new Promise(r => setTimeout(r, 50)); // wait for async archive
      await validator.archiveHyperdrive(signal.id, signal);

      assert.ok(
        validator.validateCrossPersistence(signal.id),
        'Signal should persist in both backends'
      );
    });

    it('should handle concurrent signals', async () => {
      const signals = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-${i}`,
        symbol: ['BTC', 'ETH', 'SOL'][i % 3] + '/USDT',
        type: i % 2 === 0 ? 'BUY' : 'SELL',
        confidence: 0.7 + Math.random() * 0.3,
      }));

      const traces = signals.map(sig => tracer.traceSignal(sig.id, sig));
      await Promise.all(traces);
      await new Promise(r => setTimeout(r, 50)); // wait for async archive events

      let totalEvents = 0;
      for (const sig of signals) {
        const lifecycle = tracer.getLifecycle(sig.id);
        totalEvents += lifecycle.length;
        assert.ok(lifecycle.length > 0, `Signal ${sig.id} should have events`);
      }

      assert.ok(totalEvents >= 40, `Should have >=40 total events, got ${totalEvents}`);
    });
  });
});
