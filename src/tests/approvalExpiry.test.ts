import assert from 'node:assert/strict';
import { ApprovalWorkflow } from '../backtest/ApprovalWorkflow';

const workflow = new ApprovalWorkflow({ approvalTtlMs: 1_000 });
workflow.create('run-1', 'hash-1', 1_000);
workflow.approve('run-1', 'reviewer', 'verified', 1_000);
assert.equal(workflow.isExpired('run-1', 1_999), false);
assert.equal(workflow.canActivate('run-1', 1_999), true);
assert.equal(workflow.isExpired('run-1', 2_000), true);
assert.equal(workflow.canActivate('run-1', 2_000), false);
assert.equal(workflow.get('run-1', 2_000)?.status, 'EXPIRED');
assert.throws(() => workflow.activate('run-1', 2_000), /expired/);

workflow.create('run-2', 'hash-2', 1_000);
workflow.approve('run-2', 'reviewer', 'verified', 1_000);
assert.equal(workflow.isExpired('run-2', 1_500, 'hash-changed'), true);
assert.equal(workflow.get('run-2', 1_500)?.status, 'EXPIRED');
console.log('approval expiry tests passed');
