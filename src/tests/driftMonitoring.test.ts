import assert from 'node:assert/strict';
import { evaluateDrift } from '../backtest/DriftMonitoring';

const healthy = evaluateDrift({ approvedReturn: 0.20, liveReturn: 0.18, approvedSharpe: 1.5, liveSharpe: 1.3, approvedWinRate: 0.55, liveWinRate: 0.53 });
assert.equal(healthy.status, 'HEALTHY');
assert.equal(healthy.alerts.length, 0);

const warning = evaluateDrift({ approvedReturn: 0.20, liveReturn: 0.12, approvedSharpe: 1.5, liveSharpe: 0.9, approvedWinRate: 0.55, liveWinRate: 0.48 });
assert.equal(warning.status, 'WARNING');
assert.ok(warning.alerts.length > 0);

const critical = evaluateDrift({ approvedReturn: 0.20, liveReturn: -0.10, approvedSharpe: 1.5, liveSharpe: -0.4, approvedWinRate: 0.55, liveWinRate: 0.30 });
assert.equal(critical.status, 'CRITICAL');
assert.ok(critical.alerts.some((alert) => alert.includes('return')));
assert.throws(() => evaluateDrift({ ...healthy.input, approvedReturn: 0 }), /approvedReturn/);
console.log('drift monitoring tests passed');
