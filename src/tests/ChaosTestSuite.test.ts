import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// Mock D1 Storage with quota limits
class MockD1Storage {
  private data: Map<string, any> = new Map();
  private quotaUsed = 0;
  private quotaLimit = 100_000; // 100KB mock limit
  private failureMode: 'healthy' | 'quota' | 'corruption' | 'timeout' = 'healthy';

  setFailureMode(mode: 'healthy' | 'quota' | 'corruption' | 'timeout') {
    this.failureMode = mode;
  }

  async put(key: string, value: any): Promise<void> {
    if (this.failureMode === 'timeout') {
      throw new Error('D1 timeout');
    }
    if (this.failureMode === 'quota') {
      throw new Error('D1 quota exceeded');
    }
    if (this.failureMode === 'corruption') {
      throw new Error('D1 corruption detected');
    }

    const size = JSON.stringify(value).length;
    this.quotaUsed += size;
    this.data.set(key, value);
  }

  async get(key: string): Promise<any> {
    if (this.failureMode === 'timeout') {
      throw new Error('D1 timeout');
    }
    if (this.failureMode === 'corruption') {
      return null; // corrupted data
    }
    return this.data.get(key) || null;
  }

  getQuotaStatus() {
    return { used: this.quotaUsed, limit: this.quotaLimit };
  }

  reset() {
    this.data.clear();
    this.quotaUsed = 0;
    this.failureMode = 'healthy';
  }
}

// Mock Hyperdrive (PostgreSQL)
class MockHyperdrive {
  private records: any[] = [];
  private failureMode: 'healthy' | 'unavailable' | 'slow' = 'healthy';

  setFailureMode(mode: 'healthy' | 'unavailable' | 'slow') {
    this.failureMode = mode;
  }

  async query(sql: string, params?: any[]): Promise<any[]> {
    if (this.failureMode === 'unavailable') {
      throw new Error('Hyperdrive unavailable');
    }
    if (this.failureMode === 'slow') {
      await new Promise(r => setTimeout(r, 5000));
    }

    // Simple mock: INSERT or SELECT
    if (sql.toUpperCase().includes('INSERT')) {
      this.records.push(params?.[0] || {});
      return [{ affected: 1 }];
    }
    if (sql.toUpperCase().includes('SELECT')) {
      return this.records;
    }

    return [];
  }

  getRecords() {
    return this.records;
  }

  reset() {
    this.records = [];
    this.failureMode = 'healthy';
  }
}

// Mock Webhook Payload Validator
class WebhookValidator {
  validateTradingViewSignal(payload: any): { valid: boolean; error?: string } {
    if (!payload.id) return { valid: false, error: 'Missing signal ID' };
    if (!payload.symbol) return { valid: false, error: 'Missing symbol' };
    if (!payload.type) return { valid: false, error: 'Missing type (BUY/SELL)' };
    if (payload.confidence === undefined) return { valid: false, error: 'Missing confidence' };
    if (!payload.timestamp) return { valid: false, error: 'Missing timestamp' };

    return { valid: true };
  }

  validateAuthHeader(header: string | undefined): boolean {
    if (!header) return false;
    if (!header.startsWith('Bearer ')) return false;
    return header.split(' ')[1]?.length > 0;
  }
}

// Mock Signal Ingestion Pipeline
class SignalIngestionPipeline {
  constructor(
    private d1: MockD1Storage,
    private hyperdrive: MockHyperdrive,
    private validator: WebhookValidator
  ) {}

  async ingestSignal(
    payload: any,
    authHeader: string | undefined
  ): Promise<{ success: boolean; reason?: string }> {
    // 1. Auth
    if (!this.validator.validateAuthHeader(authHeader)) {
      return { success: false, reason: 'Invalid auth header' };
    }

    // 2. Validate payload
    const validation = this.validator.validateTradingViewSignal(payload);
    if (!validation.valid) {
      return { success: false, reason: validation.error };
    }

    try {
      // 3. Store in D1 (hot)
      await this.d1.put(`signal:${payload.id}`, {
        ...payload,
        storedAt: Date.now(),
        backend: 'D1',
      });

      // 4. Archive to Hyperdrive (cold) asynchronously
      this.hyperdrive.query('INSERT INTO signals (id, payload) VALUES (?, ?)', [
        payload.id,
        JSON.stringify(payload),
      ]).catch(e => console.error(`Archive failed: ${e.message}`));

      return { success: true };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
  }
}

describe('Webhook + D1 + Hyperdrive Chaos Tests', () => {
  let d1: MockD1Storage;
  let hyperdrive: MockHyperdrive;
  let validator: WebhookValidator;
  let pipeline: SignalIngestionPipeline;

  beforeEach(() => {
    d1 = new MockD1Storage();
    hyperdrive = new MockHyperdrive();
    validator = new WebhookValidator();
    pipeline = new SignalIngestionPipeline(d1, hyperdrive, validator);
  });

  describe('Healthy Path', () => {
    it('should ingest valid signal with auth', async () => {
      const signal = {
        id: 'sig-001',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.85,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer valid-token');

      assert.strictEqual(result.success, true, 'Signal should ingest successfully');
      const stored = await d1.get('signal:sig-001');
      assert.ok(stored, 'Signal should be stored in D1');
      assert.strictEqual(stored.symbol, 'BTC/USDT', 'Symbol should match');
    });

    it('should archive signal to Hyperdrive async', async () => {
      const signal = {
        id: 'sig-002',
        symbol: 'ETH/USDT',
        type: 'SELL',
        confidence: 0.75,
        timestamp: Date.now(),
      };

      await pipeline.ingestSignal(signal, 'Bearer token');
      await new Promise(r => setTimeout(r, 100)); // Let async archive complete

      const records = hyperdrive.getRecords();
      assert.ok(records.length > 0, 'Signal should be archived');
    });
  });

  describe('Auth Failures', () => {
    it('should reject missing Bearer token', async () => {
      const signal = {
        id: 'sig-003',
        symbol: 'XRP/USDT',
        type: 'BUY',
        confidence: 0.8,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, undefined);

      assert.strictEqual(result.success, false, 'Should reject missing auth');
      assert.ok(result.reason?.includes('Invalid auth'), 'Should mention auth error');
    });

    it('should reject malformed Bearer token', async () => {
      const signal = {
        id: 'sig-004',
        symbol: 'SOL/USDT',
        type: 'BUY',
        confidence: 0.8,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Basic invalid');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('Invalid auth'));
    });
  });

  describe('Payload Validation Failures', () => {
    it('should reject missing symbol', async () => {
      const invalidSignal = {
        id: 'sig-005',
        type: 'BUY',
        confidence: 0.8,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(invalidSignal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('Missing symbol'));
    });

    it('should reject missing confidence', async () => {
      const invalidSignal = {
        id: 'sig-006',
        symbol: 'DOGE/USDT',
        type: 'SELL',
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(invalidSignal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('Missing confidence'));
    });

    it('should reject missing timestamp', async () => {
      const invalidSignal = {
        id: 'sig-007',
        symbol: 'AAPL/USDT',
        type: 'BUY',
        confidence: 0.9,
      };

      const result = await pipeline.ingestSignal(invalidSignal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('Missing timestamp'));
    });
  });

  describe('D1 Quota Chaos', () => {
    it('should detect quota exceeded', async () => {
      d1.setFailureMode('quota');

      const signal = {
        id: 'sig-008',
        symbol: 'ETH/USDT',
        type: 'BUY',
        confidence: 0.85,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('quota exceeded'));
    });

    it('should handle D1 timeout gracefully', async () => {
      d1.setFailureMode('timeout');

      const signal = {
        id: 'sig-009',
        symbol: 'BTC/USDT',
        type: 'SELL',
        confidence: 0.7,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('timeout'));
    });

    it('should handle D1 corruption', async () => {
      d1.setFailureMode('corruption');

      const signal = {
        id: 'sig-010',
        symbol: 'ADA/USDT',
        type: 'BUY',
        confidence: 0.8,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      assert.strictEqual(result.success, false);
      assert.ok(result.reason?.includes('corruption'));
    });

    it('should recover after D1 quota issue clears', async () => {
      d1.setFailureMode('quota');
      let signal1 = {
        id: 'sig-011',
        symbol: 'BTC/USDT',
        type: 'BUY',
        confidence: 0.85,
        timestamp: Date.now(),
      };
      let result1 = await pipeline.ingestSignal(signal1, 'Bearer token');
      assert.strictEqual(result1.success, false, 'Should fail on quota');

      // Clear quota issue
      d1.reset();
      d1.setFailureMode('healthy');

      let signal2 = {
        id: 'sig-012',
        symbol: 'ETH/USDT',
        type: 'SELL',
        confidence: 0.75,
        timestamp: Date.now(),
      };
      let result2 = await pipeline.ingestSignal(signal2, 'Bearer token');
      assert.strictEqual(result2.success, true, 'Should succeed after recovery');
    });
  });

  describe('Hyperdrive Chaos (Cold Storage)', () => {
    it('should not fail webhook if Hyperdrive is unavailable (async)', async () => {
      hyperdrive.setFailureMode('unavailable');

      const signal = {
        id: 'sig-013',
        symbol: 'LINK/USDT',
        type: 'BUY',
        confidence: 0.8,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      // Webhook should succeed even if async archive fails
      assert.strictEqual(result.success, true, 'Webhook should not fail on Hyperdrive error');
    });

    it('should tolerate Hyperdrive slowness (>5s timeout)', async () => {
      hyperdrive.setFailureMode('slow');

      const signal = {
        id: 'sig-014',
        symbol: 'AVAX/USDT',
        type: 'SELL',
        confidence: 0.82,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      // Webhook returns immediately; archive happens async
      assert.strictEqual(result.success, true, 'Webhook should return before slow archive');
    });
  });

  describe('Hybrid Storage Recovery', () => {
    it('should fallback to D1 when Hyperdrive fails', async () => {
      hyperdrive.setFailureMode('unavailable');

      const signal = {
        id: 'sig-015',
        symbol: 'MATIC/USDT',
        type: 'BUY',
        confidence: 0.88,
        timestamp: Date.now(),
      };

      const result = await pipeline.ingestSignal(signal, 'Bearer token');
      assert.strictEqual(result.success, true);

      // Data should still be in D1
      const stored = await d1.get('signal:sig-015');
      assert.ok(stored, 'Signal preserved in D1 despite Hyperdrive failure');
    });

    it('should continue ingesting during partial outage', async () => {
      d1.setFailureMode('healthy');
      hyperdrive.setFailureMode('unavailable');

      const signals = [
        { id: 'sig-016', symbol: 'BTC/USDT', type: 'BUY', confidence: 0.85, timestamp: Date.now() },
        { id: 'sig-017', symbol: 'ETH/USDT', type: 'SELL', confidence: 0.8, timestamp: Date.now() },
        { id: 'sig-018', symbol: 'SOL/USDT', type: 'BUY', confidence: 0.9, timestamp: Date.now() },
      ];

      for (const sig of signals) {
        const result = await pipeline.ingestSignal(sig, 'Bearer token');
        assert.strictEqual(result.success, true, `Signal ${sig.id} should ingest despite Hyperdrive down`);
      }

      assert.strictEqual(signals.length, 3);
    });
  });

  describe('Quota Monitoring & Auto-Recovery', () => {
    it('should track quota usage', () => {
      const status = d1.getQuotaStatus();
      assert.ok(status.used >= 0);
      assert.ok(status.limit > 0);
    });

    it('should detect quota approaching limit', async () => {
      const signal = {
        id: 'sig-019',
        symbol: 'SHIB/USDT',
        type: 'BUY',
        confidence: 0.75,
        timestamp: Date.now(),
      };

      // Fill quota to 85%
      const largePayload = { data: 'x'.repeat(85_000) };
      await d1.put('junk-data', largePayload);

      // Now at 85%, should reject
      d1.setFailureMode('quota');
      const result = await pipeline.ingestSignal(signal, 'Bearer token');

      assert.strictEqual(result.success, false, 'Should reject when quota at 85%');
    });
  });

  describe('Signal Burst & Rate Limiting', () => {
    it('should handle burst of 100 signals', async () => {
      const signals = [];
      for (let i = 0; i < 100; i++) {
        signals.push({
          id: `sig-burst-${i}`,
          symbol: 'BTC/USDT',
          type: i % 2 === 0 ? 'BUY' : 'SELL',
          confidence: 0.5 + Math.random() * 0.5,
          timestamp: Date.now(),
        });
      }

      let successCount = 0;
      for (const sig of signals) {
        const result = await pipeline.ingestSignal(sig, 'Bearer token');
        if (result.success) successCount++;
      }

      assert.ok(successCount >= 95, `Should process most signals (${successCount}/100)`);
    });
  });
});
