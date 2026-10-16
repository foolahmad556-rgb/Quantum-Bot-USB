import assert from 'node:assert/strict';
import { ApprovalWorkflow } from '../backtest/ApprovalWorkflow';

const workflow = new ApprovalWorkflow();
const pending = workflow.create('run-1', 'hash-1');
assert.equal(pending.status, 'PENDING');
assert.equal(workflow.canActivate('run-1'), false);

const approved = workflow.approve('run-1', 'reviewer-1', 'metrics verified');
assert.equal(approved.status, 'APPROVED');
assert.equal(approved.reviewer, 'reviewer-1');
assert.equal(workflow.canActivate('run-1'), true);
assert.throws(() => workflow.approve('run-1', 'reviewer-2', 'again'), /approved/);

const rejected = workflow.create('run-2', 'hash-2');
const rejectedResult = workflow.reject('run-2', 'reviewer-1', 'drawdown too high');
assert.equal(rejectedResult.status, 'REJECTED');
assert.equal(workflow.canActivate('run-2'), false);
assert.throws(() => workflow.activate('run-2'), /approved/);
const activated = workflow.activate('run-1');
assert.equal(activated.status, 'ACTIVE');
assert.equal(workflow.canActivate('run-1'), true);
console.log('approval workflow tests passed');
