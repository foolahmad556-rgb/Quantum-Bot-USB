/**
 * LOCAL TESTING RUNNER
 * تشغيل جميع الاختبارات المحلية
 */

import { UnitTestSuite } from './unit-tests.js';
import { IntegrationTestSuite } from './integration-tests.js';
import { ChaosTestSuite } from './chaos-tests.js';

interface SuiteResults {
  suiteName: string;
  passed: number;
  failed: number;
  total: number;
  duration: number;
}

class LocalTestRunner {
  private results: SuiteResults[] = [];
  private startTime = Date.now();

  async runAllTests(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║   LOCAL TESTING FRAMEWORK                      ║');
    console.log('║   تجربة محلية شاملة للنظام                      ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    console.log(`⏱️  Started at: ${new Date().toISOString()}\n`);

    try {
      // مرحلة 1: اختبارات الوحدة
      await this.runUnitTests();

      // مرحلة 2: اختبارات التكامل
      await this.runIntegrationTests();

      // مرحلة 3: اختبارات الفشل
      await this.runChaosTests();

      // ملخص نهائي
      this.printFinalSummary();
    } catch (error) {
      console.error('\n❌ FATAL ERROR:', error);
      process.exit(1);
    }
  }

  private async runUnitTests(): Promise<void> {
    console.log('🔧 Running Unit Tests...\n');
    const suite = new UnitTestSuite();
    const testResults = await suite.run();

    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;

    this.results.push({
      suiteName: 'Unit Tests',
      passed,
      failed,
      total: testResults.length,
      duration: testResults.reduce((sum, r) => sum + r.duration, 0),
    });
  }

  private async runIntegrationTests(): Promise<void> {
    console.log('🔗 Running Integration Tests...\n');
    const suite = new IntegrationTestSuite();
    const testResults = await suite.run();

    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;

    this.results.push({
      suiteName: 'Integration Tests',
      passed,
      failed,
      total: testResults.length,
      duration: testResults.reduce((sum, r) => sum + r.duration, 0),
    });
  }

  private async runChaosTests(): Promise<void> {
    console.log('⚡ Running Chaos Tests...\n');
    const suite = new ChaosTestSuite();
    const testResults = await suite.run();

    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;

    this.results.push({
      suiteName: 'Chaos Tests',
      passed,
      failed,
      total: testResults.length,
      duration: testResults.reduce((sum, r) => sum + r.duration, 0),
    });
  }

  private printFinalSummary(): void {
    const totalTests = this.results.reduce((sum, r) => sum + r.total, 0);
    const totalPassed = this.results.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    const totalElapsed = Date.now() - this.startTime;

    const successRate = ((totalPassed / totalTests) * 100).toFixed(1);

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║          FINAL TEST SUMMARY                    ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    // جدول النتائج
    console.log('Suite Results:');
    console.log('─'.repeat(60));
    console.log(
      `${'Suite'.padEnd(25)} | ${'Passed'.padEnd(8)} | ${'Failed'.padEnd(8)} | ${'Duration'.padEnd(10)}`
    );
    console.log('─'.repeat(60));

    for (const result of this.results) {
      const status =
        result.failed === 0
          ? '✅'
          : result.failed < result.total * 0.2
          ? '⚠️ '
          : '❌';

      console.log(
        `${status} ${result.suiteName.padEnd(23)} | ${String(result.passed).padEnd(8)} | ${String(result.failed).padEnd(8)} | ${result.duration}ms`
      );
    }

    console.log('─'.repeat(60));
    console.log(
      `${'TOTAL'.padEnd(25)} | ${String(totalPassed).padEnd(8)} | ${String(totalFailed).padEnd(8)} | ${totalDuration}ms`
    );
    console.log('─'.repeat(60));

    console.log('\nOverall Statistics:');
    console.log(`  📊 Total Tests: ${totalTests}`);
    console.log(`  ✅ Passed: ${totalPassed}`);
    console.log(`  ❌ Failed: ${totalFailed}`);
    console.log(`  📈 Success Rate: ${successRate}%`);
    console.log(`  ⏱️  Total Duration: ${totalElapsed}ms (${(totalElapsed / 1000).toFixed(2)}s)`);

    console.log('\nTest Coverage:');
    for (const result of this.results) {
      const percentage = (
        (result.passed / result.total) *
        100
      ).toFixed(1);
      console.log(
        `  • ${result.suiteName}: ${percentage}% (${result.passed}/${result.total})`
      );
    }

    console.log('\nSystem Readiness:');
    if (totalFailed === 0) {
      console.log('  ✅ All tests passed! System is ready for integration.');
      console.log(
        '  ✅ No data loss detected.'
      );
      console.log(
        '  ✅ Error recovery working correctly.'
      );
      console.log(
        '  ✅ Performance within acceptable limits.'
      );
      console.log(
        '  ✅ Memory management is stable.'
      );
      process.exit(0);
    } else if (totalFailed <= totalTests * 0.1) {
      console.log(`  ⚠️  ${totalFailed} test(s) failed (< 10%).`);
      console.log('  ⚠️  Review failures before production deployment.');
      process.exit(1);
    } else {
      console.log(`  ❌ ${totalFailed} test(s) failed (> 10%).`);
      console.log('  ❌ System NOT ready for integration.');
      process.exit(1);
    }
  }
}

// تشغيل الاختبارات
const runner = new LocalTestRunner();
runner.runAllTests();
