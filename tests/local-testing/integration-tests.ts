/**
 * LOCAL TESTING SUITE - INTEGRATION TESTS
 * اختبارات التكامل للتدفق الكامل
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

class IntegrationTestSuite {
  private results: TestResult[] = [];

  async run(): Promise<TestResult[]> {
    console.log('\n========================================');
    console.log('PHASE 2: INTEGRATION TESTS');
    console.log('========================================\n');

    await this.testFullEventPipeline();
    await this.testQueueDrain();
    await this.testSyncToD1();
    await this.testDataConsistency();
    await this.testCheckpointRecovery();
    await this.testErrorRecovery();
    await this.testConcurrentEvents();
    await this.testMemoryLeaks();

    this.printResults();
    return this.results;
  }

  private async testFullEventPipeline(): Promise<void> {
    const test = 'Full Event Pipeline';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);

      // 1. إنشاء حدث
      const event = eventService.createEvent('trade.buy', {
        symbol: 'BTC',
        quantity: 0.5,
        price: 29000,
      });

      // 2. إضافة للطابور
      const added = await eventService.addEvent(event);
      if (!added) throw new Error('Failed to add event');

      // 3. Drain إلى Hyperdrive
      const drained = await eventService.drainQueue();
      if (drained !== 1) throw new Error('Failed to drain');

      // 4. التحقق من أن الحدث في Hyperdrive
      const events = await hyperdrive.getAllEvents();
      if (events.length !== 1) throw new Error('Event not in Hyperdrive');

      // 5. Sync إلى D1
      const syncService = new SyncService(hyperdrive, d1);
      const synced = await syncService.syncToD1();
      if (synced !== 1) throw new Error('Failed to sync to D1');

      // 6. التحقق من البيانات في D1
      const trades = await d1.getTrades();
      if (trades.length !== 1) throw new Error('Event not synced to D1');

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

  private async testQueueDrain(): Promise<void> {
    const test = 'Queue Drain (Batch Processing)';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // أضف 250 حدث
      for (let i = 0; i < 250; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: i,
          price: 100 + i,
        });
        await eventService.addEvent(event);
      }

      if (eventService.getQueueSize() !== 250) {
        throw new Error('Queue size mismatch');
      }

      // Drain بشكل متكرر (كل batch = 100)
      let totalDrained = 0;
      while (eventService.getQueueSize() > 0) {
        const drained = await eventService.drainQueue();
        totalDrained += drained;
      }

      if (totalDrained !== 250) {
        throw new Error(`Expected 250 drained, got ${totalDrained}`);
      }

      // تحقق أن الكل في Hyperdrive
      const events = await hyperdrive.getAllEvents();
      if (events.length !== 250) {
        throw new Error('Not all events in Hyperdrive');
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

  private async testSyncToD1(): Promise<void> {
    const test = 'Sync to D1 (Materialized Views)';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);
      const syncService = new SyncService(hyperdrive, d1);

      // 1. أضف أحداث متعددة الأنواع
      const events = [
        eventService.createEvent('balance.update', {
          userId: 'user-1',
          amount: 10000,
        }),
        eventService.createEvent('position.open', {
          userId: 'user-1',
          symbol: 'BTC',
          size: 1.0,
        }),
        eventService.createEvent('trade.buy', {
          userId: 'user-1',
          symbol: 'BTC',
          quantity: 0.5,
          price: 29000,
        }),
      ];

      for (const event of events) {
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();

      // 2. Sync إلى D1
      const synced = await syncService.syncToD1();
      if (synced !== 3) throw new Error('Not all events synced');

      // 3. تحقق من البيانات في D1
      const balance = await d1.getBalance('user-1');
      if (balance !== 10000) throw new Error('Balance not synced');

      const positions = await d1.getPositions('user-1');
      if (positions.length !== 1) throw new Error('Position not synced');

      const trades = await d1.getTrades();
      if (trades.length !== 1) throw new Error('Trade not synced');

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

  private async testDataConsistency(): Promise<void> {
    const test = 'Data Consistency (Checksums)';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);
      const syncService = new SyncService(hyperdrive, d1);

      // أضف أحداث فريدة
      for (let i = 0; i < 50; i++) {
        const event = eventService.createEvent(`trade.buy.${i}`, {
          symbol: 'BTC',
          amount: 100 + i,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();
      const synced = await syncService.syncToD1();

      // تحقق من أن البيانات تمت مزامنتها
      if (synced === 0) {
        throw new Error('No events were synced to D1');
      }

      // تحقق من التطابق
      const isConsistent = await syncService.verifyConsistency();
      if (!isConsistent) {
        throw new Error('Data inconsistency detected');
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

  private async testCheckpointRecovery(): Promise<void> {
    const test = 'Checkpoint Recovery';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);
      const syncService = new SyncService(hyperdrive, d1);

      // 1. أضف الدفعة الأولى من الأحداث
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `batch1-${i}`,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();
      await syncService.syncToD1();

      // 2. احفظ checkpoint
      const checkpoint = {
        id: 'sync-1',
        eventId: 'batch1-9',
        sequenceNumber: 10,
        lastProcessedId: 'batch1-9',
        timestamp: Date.now(),
      };

      await hyperdrive.saveCheckpoint(checkpoint);

      // 3. أضف الدفعة الثانية
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `batch2-${i}`,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();

      // 4. استرجع checkpoint وتحقق
      const savedCheckpoint = await hyperdrive.getCheckpoint('sync-1');
      if (
        !savedCheckpoint ||
        savedCheckpoint.sequenceNumber !== 10
      ) {
        throw new Error('Checkpoint not saved correctly');
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

  private async testErrorRecovery(): Promise<void> {
    const test = 'Error Recovery (Graceful Degradation)';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);

      // أضف أحداث
      for (let i = 0; i < 20; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `evt-${i}`,
        });
        await eventService.addEvent(event);
      }

      // أغلق Hyperdrive
      hyperdrive.setOffline(true);

      // محاولة drain يجب أن تفشل ولكن تحتفظ بالطابور
      let drainFailed = false;
      try {
        await eventService.drainQueue();
      } catch (error) {
        drainFailed = true;
      }

      if (!drainFailed) {
        throw new Error('Should fail when Hyperdrive offline');
      }

      // تحقق أن الطابور احتفظ بالأحداث
      if (eventService.getQueueSize() !== 20) {
        throw new Error('Queue should retain events on error');
      }

      // أعد تشغيل Hyperdrive
      hyperdrive.setOffline(false);

      // Drain يجب أن ينجح الآن
      const drained = await eventService.drainQueue();
      if (drained !== 20) {
        throw new Error('Failed to drain after recovery');
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

  private async testConcurrentEvents(): Promise<void> {
    const test = 'Concurrent Event Processing';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // محاكاة 50 حدث متزامن تقريباً
      const promises = [];

      for (let i = 0; i < 50; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `concurrent-${i}`,
        });

        promises.push(eventService.addEvent(event));
      }

      await Promise.all(promises);

      if (eventService.getQueueSize() !== 50) {
        throw new Error('Not all concurrent events added');
      }

      // Drain الكل
      const drained = await eventService.drainQueue();
      if (drained < 50) {
        throw new Error('Failed to drain all concurrent events');
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

  private async testMemoryLeaks(): Promise<void> {
    const test = 'Memory Leak Detection';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);

      const memoryBefore = eventService.getMemoryUsage();

      // أضف وdrain عدة مرات
      for (let batch = 0; batch < 5; batch++) {
        for (let i = 0; i < 100; i++) {
          const event = eventService.createEvent('trade.buy', {
            id: `batch${batch}-${i}`,
          });
          await eventService.addEvent(event);
        }

        await eventService.drainQueue();
      }

      const memoryAfter = eventService.getMemoryUsage();

      // الذاكرة يجب أن تكون قريبة من الأولية (بعد cleanup)
      const memoryGrowth = memoryAfter.queue - memoryBefore.queue;

      // السماح ببعض النمو (cache, metadata)
      if (memoryGrowth > 500000) {
        throw new Error(
          `Memory growth too high: ${memoryGrowth} bytes`
        );
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(
        `✅ ${test}: PASSED (${Date.now() - start}ms) - Memory growth: ${memoryGrowth} bytes`
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

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n========================================');
    console.log('INTEGRATION TEST RESULTS');
    console.log('========================================');
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`⏱️  Total time: ${totalTime}ms`);
    console.log('========================================\n');
  }
}

export { IntegrationTestSuite };
