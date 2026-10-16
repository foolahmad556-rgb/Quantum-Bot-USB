import assert from 'node:assert/strict';
import { exportReportCsv, exportReportJson } from '../backtest/ReportExport';

const report = {
  runId: 'run-42',
  strategyVersion: 'v1.0.0',
  datasetHash: 'hash-abc',
  status: 'APPROVED',
  metrics: { returnPct: 12.5, sharpe: 1.4, maxDrawdownPct: 4.2 },
  driftStatus: 'HEALTHY',
};

const json = exportReportJson(report);
assert.deepEqual(JSON.parse(json), report);
const csv = exportReportCsv(report);
assert.ok(csv.includes('runId,value'));
assert.ok(csv.includes('run-42'));
assert.ok(csv.includes('metrics.sharpe,1.4'));
assert.ok(csv.endsWith('\n'));
assert.throws(() => exportReportJson({ ...report, runId: '' }), /runId/);
console.log('report export tests passed');
