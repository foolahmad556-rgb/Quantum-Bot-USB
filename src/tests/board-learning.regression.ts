/**
 * Regression tests: useBoardLearningSync pure learning functions (imported, not copied).
 * Run: npx tsx --test src/tests/board-learning.regression.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentLearning,
  agentVoteWasCorrect,
  computePnlMagnitudeScale,
  MIN_DECISIONS_FOR_CONFIDENCE_UPDATE,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
  LEARNING_RATE,
  PNL_SCALE_MIN,
  PNL_SCALE_MAX,
} from '../hooks/useBoardLearningSync';

const base = (over: Partial<Parameters<typeof applyAgentLearning>[0]> = {}) => ({
  confidence: 0.6,
  accuracy: 0.5,
  totalDecisions: 0,
  correctDecisions: 0,
  learningCurve: [] as number[],
  ...over,
});

test('sample gate: no confidence move before MIN_DECISIONS_FOR_CONFIDENCE_UPDATE', () => {
  let agent = base();
  for (let i = 0; i < MIN_DECISIONS_FOR_CONFIDENCE_UPDATE - 1; i++) {
    const r = applyAgentLearning(agent, { agentWasCorrect: true, magnitudeScale: 1 });
    assert.equal(r.confidence, 0.6, `confidence moved at decision ${i + 1}`);
    agent = { ...agent, ...r };
  }
  assert.equal(agent.totalDecisions, MIN_DECISIONS_FOR_CONFIDENCE_UPDATE - 1);
});

test('sample gate: decisions are still counted before the gate opens', () => {
  const r = applyAgentLearning(base(), { agentWasCorrect: true, magnitudeScale: 1 });
  assert.equal(r.totalDecisions, 1);
  assert.equal(r.correctDecisions, 1);
});

test('asymmetric update: a wrong call costs 2x a right call earns', () => {
  const agent = base({ totalDecisions: 20, correctDecisions: 10 });
  const up = applyAgentLearning(agent, { agentWasCorrect: true, magnitudeScale: 1 });
  const down = applyAgentLearning(agent, { agentWasCorrect: false, magnitudeScale: 1 });
  assert.ok(Math.abs(down.deltaConf) > Math.abs(up.deltaConf), 'loss penalty must exceed gain');
  assert.equal(Number(up.deltaConf.toFixed(4)), LEARNING_RATE);
  assert.equal(Number(down.deltaConf.toFixed(4)), -LEARNING_RATE * 2);
});

test('confidence stays inside [CONFIDENCE_MIN, CONFIDENCE_MAX]', () => {
  const hi = applyAgentLearning(base({ confidence: CONFIDENCE_MAX, totalDecisions: 50, correctDecisions: 50 }), { agentWasCorrect: true, magnitudeScale: 2 });
  const lo = applyAgentLearning(base({ confidence: CONFIDENCE_MIN, totalDecisions: 50, correctDecisions: 0 }), { agentWasCorrect: false, magnitudeScale: 2 });
  assert.ok(hi.confidence <= CONFIDENCE_MAX);
  assert.ok(lo.confidence >= CONFIDENCE_MIN);
});

test('PnL magnitude scale is clamped and handles NaN', () => {
  assert.equal(computePnlMagnitudeScale(0), PNL_SCALE_MIN);
  assert.equal(computePnlMagnitudeScale(10), PNL_SCALE_MAX);
  assert.equal(computePnlMagnitudeScale(NaN), PNL_SCALE_MIN);
  const s = computePnlMagnitudeScale(-0.05);
  assert.ok(s >= PNL_SCALE_MIN && s <= PNL_SCALE_MAX);
});

test('vote-aware credit: winning trade rewards "approved" only', () => {
  assert.equal(agentVoteWasCorrect('approved', true), true);
  assert.equal(agentVoteWasCorrect('challenge', true), false);
  assert.equal(agentVoteWasCorrect('rejected', true), false);
});

test('vote-aware credit: losing trade rewards any non-approve vote', () => {
  assert.equal(agentVoteWasCorrect('rejected', false), true);
  assert.equal(agentVoteWasCorrect('challenge', false), true);
  assert.equal(agentVoteWasCorrect('approved', false), false);
});

test('no recorded vote falls back to isWin (engine behaviour)', () => {
  assert.equal(agentVoteWasCorrect(undefined, true), true);
  assert.equal(agentVoteWasCorrect(undefined, false), false);
});

test('learning curve keeps at most 25 points', () => {
  let agent = base({ learningCurve: Array.from({ length: 25 }, () => 0.5) });
  const r = applyAgentLearning(agent, { agentWasCorrect: true, magnitudeScale: 1 });
  assert.equal(r.learningCurve.length, 25);
});
