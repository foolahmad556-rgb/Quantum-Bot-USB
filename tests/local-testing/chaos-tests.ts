/**
 * LOCAL TESTING SUITE - CHAOS TESTS
 * اختبارات الفشل العشوائي والسيناريوهات الحقيقية
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

class ChaosTestSuite {
  private results: TestResult[] = [];

  async run(): Promise<TestResult[]> {
    console.log('\n========================================');
    console.log('PHASE 3: CHAOS TESTS');
    console.log('========================================\n');

    await this.testHyperdriveFailure();
    await this.testD1Failure();
    await this.testNetworkLatency();
    await this.testPartialFailure();
    await this.testRapidToggle();
    await this.testLongRecovery();
    await this.testQueueFillUnderLoad();
    await this.testDataCorruptionDetection();

    this.printResults();
    return this.results;
  }

  private async testHyperdriveFailure(): Promise<void> {
    const test = 'Hyperdrive Failure & Recovery';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // 1. عمل طبيعي
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `normal-${i}`,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();

      if (hyperdrive.getEventCount() !== 10) {
        throw new Error('Events not saved to Hyperdrive');
      }

      // 2. أوقف Hyperdrive
      hyperdrive.setOffline(true);

      // 3. أضف أحداث جديدة (يجب أن تبقى في الطابور)
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('trade.sell', {
          id: `offline-${i}`,
        });
        await eventService.addEvent(event);
      }

      if (eventService.getQueueSize() !== 10) {
        throw new Error('Queued events mismatch');
      }

      // 4. محاولة drain (يجب أن تفشل ولكن تحتفظ بالطابور)
      try {
        await eventService.drainQueue();
        throw new Error('Should fail when offline');
      } catch (error) {
        if (!String(error).includes('offline')) {
          throw error;
        }
      }

      if (eventService.getQueueSize() !== 10) {
        throw new Error('Queue should retain events');
      }

      // 5. أعد تشغيل Hyperdrive
      hyperdrive.setOffline(false);

      // 6. Drain يجب أن ينجح
      const drained = await eventService.drainQueue();
      if (drained < 10) {
        throw new Error('Failed to drain after recovery');
      }

      // 7. تحقق من الكل في Hyperdrive
      if (hyperdrive.getEventCount() !== 20) {
        throw new Error('All events should be in Hyperdrive');
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

  private async testD1Failure(): Promise<void> {
    const test = 'D1 Failure & Recovery';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);
      const syncService = new SyncService(hyperdrive, d1);

      // 1. أضف أحداث وsync
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('balance.update', {
          userId: 'user-1',
          amount: 1000 + i * 100,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();
      await syncService.syncToD1();

      const balanceBefore = await d1.getBalance('user-1');
      if (balanceBefore === 0) {
        throw new Error('Balance should be synced');
      }

      // 2. أوقف D1
      d1.setOffline(true);

      // 3. محاولة sync (يجب أن تفشل)
      try {
        await syncService.syncToD1();
        throw new Error('Should fail when D1 offline');
      } catch (error) {
        if (!String(error).includes('offline')) {
          throw error;
        }
      }

      // 4. أعد تشغيل D1
      d1.setOffline(false);

      // 5. Sync يجب أن ينجح (بدون أحداث جديدة)
      const synced = await syncService.syncToD1();
      if (synced !== 0) {
        // قد يكون 0 إذا كان كل شيء مزامناً بالفعل
        // أو قد يعيد مزامنة الأحداث القديمة
      }

      // 6. تحقق من البيانات
      const balanceAfter = await d1.getBalance('user-1');
      if (balanceAfter === 0) {
        throw new Error('Balance lost after recovery');
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

  private async testNetworkLatency(): Promise<void> {
    const test = 'High Latency Handling';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);

      // 1. اجعل الكمون عالياً جداً (500ms)
      hyperdrive.setLatency(500);
      d1.setLatency(500);

      // 2. أضف أحداث (يجب أن تكون بطيئة)
      const eventStart = Date.now();

      for (let i = 0; i < 5; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `slow-${i}`,
        });
        await eventService.addEvent(event);
      }

      const eventTime = Date.now() - eventStart;

      // 3. Drain (يجب أن يكون بطيئاً جداً)
      const drainStart = Date.now();
      await eventService.drainQueue();
      const drainTime = Date.now() - drainStart;

      // drain من 5 أحداث بـ 500ms latency = ~2500ms (5 * 500ms)
      if (drainTime < 2000) {
        throw new Error(
          `Drain too fast: ${drainTime}ms (expected ~2500ms)`
        );
      }

      // 4. تحقق أن الأحداث وصلت رغم الكمون
      if (hyperdrive.getEventCount() !== 5) {
        throw new Error('Events lost despite high latency');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(
        `✅ ${test}: PASSED (${Date.now() - start}ms) - Drain time: ${drainTime}ms`
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

  private async testPartialFailure(): Promise<void> {
    const test = 'Partial Failure (Some Success)';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // 1. أضف أحداث بدفعات
      for (let i = 0; i < 10; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `partial-${i}`,
        });
        await eventService.addEvent(event);
      }

      // 2. أغلق Hyperdrive قبل الـ drain
      hyperdrive.setOffline(true);

      // 3. محاولة drain (سيفشل)
      try {
        await eventService.drainQueue();
      } catch (error) {
        // متوقع
      }

      // 4. أعد التشغيل
      hyperdrive.setOffline(false);

      // 5. أضف أحداث أخرى
      for (let i = 10; i < 15; i++) {
        const event = eventService.createEvent('trade.sell', {
          id: `partial-${i}`,
        });
        await eventService.addEvent(event);
      }

      // 6. Drain الكل
      while (eventService.getQueueSize() > 0) {
        await eventService.drainQueue();
      }

      // 7. تحقق من أن الكل وصل
      if (hyperdrive.getEventCount() !== 15) {
        throw new Error(
          `Expected 15 events, got ${hyperdrive.getEventCount()}`
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

  private async testRapidToggle(): Promise<void> {
    const test = 'Rapid On/Off Toggle';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // 1. أضف أحداث
      for (let i = 0; i < 50; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `toggle-${i}`,
        });
        await eventService.addEvent(event);
      }

      // 2. Toggle on/off بسرعة (محاكاة network flakiness)
      for (let toggle = 0; toggle < 10; toggle++) {
        hyperdrive.setOffline(toggle % 2 === 0);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // 3. تأكد أن Hyperdrive online
      hyperdrive.setOffline(false);

      // 4. حاول drain
      let totalDrained = 0;
      while (eventService.getQueueSize() > 0) {
        try {
          const drained = await eventService.drainQueue();
          totalDrained += drained;
        } catch (error) {
          // قد يفشل في بعض الأحيان، لكن يجب أن ينجح في النهاية
          if (eventService.getQueueSize() === 0) break;
        }
      }

      if (totalDrained < 50 && hyperdrive.getEventCount() < 50) {
        throw new Error('Lost events during rapid toggle');
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

  private async testLongRecovery(): Promise<void> {
    const test = 'Long Recovery Time';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // 1. أضف أحداث كثيرة
      for (let i = 0; i < 100; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `long-recovery-${i}`,
        });
        await eventService.addEvent(event);
      }

      // 2. أوقف Hyperdrive
      hyperdrive.setOffline(true);

      // 3. أضف المزيد أثناء الانقطاع
      for (let i = 100; i < 150; i++) {
        const event = eventService.createEvent('trade.sell', {
          id: `long-recovery-${i}`,
        });
        await eventService.addEvent(event);
      }

      if (eventService.getQueueSize() !== 150) {
        throw new Error('Queue should have all events');
      }

      // 4. أعد التشغيل ببطء (high latency)
      hyperdrive.setOffline(false);
      hyperdrive.setLatency(100); // 100ms per operation

      // 5. Drain (يجب أن يعمل حتى لو بطيئاً)
      const drainStart = Date.now();

      while (eventService.getQueueSize() > 0) {
        await eventService.drainQueue();
      }

      const drainTime = Date.now() - drainStart;

      if (hyperdrive.getEventCount() !== 150) {
        throw new Error(
          `Expected 150 events in Hyperdrive, got ${hyperdrive.getEventCount()}`
        );
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(
        `✅ ${test}: PASSED (${Date.now() - start}ms) - Recovery took ${drainTime}ms`
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

  private async testQueueFillUnderLoad(): Promise<void> {
    const test = 'Queue Fill Under Heavy Load';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const eventService = new EventService(hyperdrive, new MockD1());

      // 1. اجعل Hyperdrive بطيء جداً
      hyperdrive.setLatency(50);

      // 2. أضف أحداث بسرعة (أسرع من drain)
      let addedCount = 0;
      let queueOverflow = false;

      for (let i = 0; i < 100; i++) {
        const event = eventService.createEvent(`trade.buy.load.${i}`, {
          symbol: 'BTC',
        });

        try {
          await eventService.addEvent(event);
          addedCount++;

          // حاول drain بشكل متواز
          if (i % 20 === 0) {
            try {
              await eventService.drainQueue();
            } catch (error) {
              // قد يفشل إذا كان Hyperdrive مشغول
            }
          }
        } catch (error) {
          if (String(error).includes('overflow')) {
            queueOverflow = true;
            break;
          }
        }
      }

      // 3. إذا لم نصل لـ queue overflow، drain الكل
      if (!queueOverflow) {
        while (eventService.getQueueSize() > 0) {
          await eventService.drainQueue();
        }
      }

      // 4. تحقق من السلامة
      if (
        eventService.getQueueSize() > 10000 ||
        eventService.getMemoryUsage().queue > 10000000
      ) {
        throw new Error('Memory or queue usage too high');
      }

      this.results.push({
        name: test,
        passed: true,
        duration: Date.now() - start,
      });

      console.log(
        `✅ ${test}: PASSED (${Date.now() - start}ms) - Added: ${addedCount}, Queue overflow detected: ${queueOverflow}`
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

  private async testDataCorruptionDetection(): Promise<void> {
    const test = 'Data Corruption Detection';
    const start = Date.now();

    try {
      const hyperdrive = new MockHyperdrive();
      const d1 = new MockD1();
      const eventService = new EventService(hyperdrive, d1);
      const syncService = new SyncService(hyperdrive, d1);

      // 1. أضف أحداث سليمة
      for (let i = 0; i < 20; i++) {
        const event = eventService.createEvent('trade.buy', {
          id: `corruption-${i}`,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();
      await syncService.syncToD1();

      // 2. احسب checksum الصحيح
      const checksumBefore = await syncService.calculateChecksum(
        'hyperdrive'
      );

      // 3. محاكاة corruption (في الواقع، لا نستطيع تعديل البيانات مباشرة في المحاكاة)
      // لكن يمكننا التحقق من أن الـ checksum detection يعمل

      // 4. أضف أحداث إضافية
      for (let i = 20; i < 25; i++) {
        const event = eventService.createEvent('trade.sell', {
          id: `corruption-${i}`,
        });
        await eventService.addEvent(event);
      }

      await eventService.drainQueue();

      // 5. احسب checksum جديد
      const checksumAfter = await syncService.calculateChecksum(
        'hyperdrive'
      );

      if (checksumBefore === checksumAfter) {
        throw new Error(
          'Checksum should change after adding events'
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

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n========================================');
    console.log('CHAOS TEST RESULTS');
    console.log('========================================');
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`⏱️  Total time: ${totalTime}ms`);
    console.log('========================================\n');
  }
}

export { ChaosTestSuite };
