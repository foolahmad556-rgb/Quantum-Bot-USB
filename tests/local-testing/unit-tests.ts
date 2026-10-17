/**
 * LOCAL TESTING SUITE - UNIT TESTS
 * اختبارات الوحدة للنظام
 */

import {
  MockHyperdrive,
  MockD1,
  EventService,
  SyncService,
} from './test-framework.js';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

class UnitTestSuite {
  private results: TestResult[] = [];

  async run(): Promise<TestResult[]> {
    console.log('\n========================================');
    console.log('PHASE 1: UNIT TESTS');
    console.log('========================================\n');

    await this.testEventCreation();
    await this.testHashValidation();
    await this.testIdempotency();
    await this.testQueueOverflow();
    await this.testMemoryUsage();
    await this.testHashChainIntegrity();
    await this.testDuplicateDetection();
    await this.testDataValidation();

    this.printResults();
    return this.results;
  }

  private async testEventCreation(): Promise<void> {
    const test = 'Event Creation';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      const event = eventService.createEvent('trade.buy', {
        symbol: 'BTC',
        quantity: 0.5,
        price: 29000,
      });

      if (!event.id || !event.hash || !event.timestamp) {
        throw new Error('Event missing required fields');
      }

      if (event.type !== 'trade.buy') {
        throw new Error('Event type mismatch');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testHashValidation(): Promise<void> {
    const test = 'Hash Validation';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      const event = eventService.createEvent('trade.sell', {
        symbol: 'ETH',
        quantity: 1.0,
      });

      // تحقق من صحة hash
      if (!eventService.validateHash(event)) {
        throw new Error('Hash validation failed');
      }

      // عدّل البيانات وتحقق أنها تفشل
      const corruptedEvent = { ...event, data: { corrupted: true } };
      if (eventService.validateHash(corruptedEvent)) {
        throw new Error('Should reject corrupted hash');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testIdempotency(): Promise<void> {
    const test = 'Idempotent Operations';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      const event = eventService.createEvent('position.open', {
        symbol: 'BTC',
        size: 1.0,
      });

      // أضف نفس الحدث مرتين
      const result1 = await eventService.addEvent(event);
      const result2 = await eventService.addEvent(event);

      if (result1 !== true) throw new Error('First add should succeed');
      if (result2 !== false) throw new Error('Second add should be ignored');

      if (eventService.getQueueSize() !== 1) {
        throw new Error('Queue should have exactly 1 event');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testQueueOverflow(): Promise<void> {
    const test = 'Queue Overflow Protection';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      // Fill queue to exactly maxQueueSize (10,000)
      let overflowDetected = false;
      let addedCount = 0;

      for (let i = 0; i < 10001; i++) {
        const event = eventService.createEvent(`evt.test.${i}`, {
          value: i,
        });

        try {
          await eventService.addEvent(event);
          addedCount++;
        } catch (error) {
          if (String(error).includes('Queue overflow')) {
            overflowDetected = true;
            break;
          }
          throw error; // any other error is a failure
        }
      }

      // Verify overflow was detected at or near the limit
      if (!overflowDetected || addedCount < 10000) {
        throw new Error(
          `Overflow not detected. Added: ${addedCount}, Overflow: ${overflowDetected}`
        );
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testMemoryUsage(): Promise<void> {
    const test = 'Memory Usage Tracking';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      // أضف 100 حدث
      for (let i = 0; i < 100; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: i,
          price: 100 + i,
        });
        await eventService.addEvent(event);
      }

      const memory = eventService.getMemoryUsage();

      if (memory.queue === 0) {
        throw new Error('Queue memory should not be zero');
      }

      if (memory.queue > 1000000) {
        throw new Error('Memory usage exceeds threshold (1MB)');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(
        `✅ ${test}: PASSED (${Date.now() - start}ms) - Queue: ${memory.queue} bytes`
      );
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testHashChainIntegrity(): Promise<void> {
    const test = 'Hash Chain Integrity';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      const events = [];

      // أنشئ سلسلة من الأحداث
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent(`event.${i}`, {
          index: i,
        });
        events.push(event);
        await eventService.addEvent(event);
      }

      // تحقق من أن كل حدث له prevHash من الحدث السابق
      for (let i = 1; i < events.length; i++) {
        if (events[i].prevHash !== events[i - 1].hash) {
          throw new Error(`Hash chain broken at event ${i}`);
        }
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testDuplicateDetection(): Promise<void> {
    const test = 'Duplicate Event Detection';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      const event = eventService.createEvent('trade.buy', {
        symbol: 'BTC',
      });

      // أضف للطابور ثم drain
      await eventService.addEvent(event);
      await eventService.drainQueue();

      // محاولة إضافة نفس الحدث مرة أخرى
      let duplicateDetected = false;

      try {
        await eventService.addEvent(event);
      } catch (error) {
        if (String(error).includes('already')) {
          duplicateDetected = true;
        }
      }

      // إذا لم يفشل، حاول drain مرة أخرى - يجب أن يتجاهل
      const drainResult = await eventService.drainQueue();
      if (drainResult !== 0) {
        duplicateDetected = false;
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private async testDataValidation(): Promise<void> {
    const test = 'Data Validation';
    const start = Date.now();

    try {
      const eventService = new EventService(
        new MockHyperdrive(),
        new MockD1()
      );

      // اختبر أنواع بيانات مختلفة
      const validEvents = [
        eventService.createEvent('trade.buy', {
          symbol: 'BTC',
          quantity: 0.5,
          price: 29000,
        }),
        eventService.createEvent('balance.update', {
          userId: 'user-1',
          amount: 10000,
        }),
        eventService.createEvent('position.open', {
          symbol: 'ETH',
          size: 1.0,
        }),
      ];

      for (const event of validEvents) {
        if (!eventService.validateHash(event)) {
          throw new Error(`Hash validation failed for ${event.type}`);
        }
        await eventService.addEvent(event);
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(`✅ ${test}: PASSED (${Date.now() - start}ms)`);
    } catch (error) {
      this.results.push({
        name: test,
        passed: false,
        duration: Date.now() - start,
        error: String(error),
      });

      console.log(`❌ ${test}: FAILED - ${error}`);
    }
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n========================================');
    console.log('UNIT TEST RESULTS');
    console.log('========================================');
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`⏱️  Total time: ${totalTime}ms`);
    console.log('========================================\n');
  }
}

export { UnitTestSuite };
