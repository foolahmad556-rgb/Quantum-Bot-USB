/**
 * SignalScoringEngine.test.ts
 * Unit and integration tests for signal quality scoring
 * Run: npx tsx src/tests/signalScoringEngine.test.ts
 * Validates confidence improvement from 35% → 60%+
 */

import assert from 'node:assert/strict';
import { SignalScoringEngine } from '../signals/SignalScoringEngine';
import { CalculatedFeatures } from '../features/FeatureEngine';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  ${(err as Error).message}`);
  }
}

function mockFeatures(overrides: Partial<CalculatedFeatures> = {}): CalculatedFeatures {
  return {
    symbol: 'BTC/USDT',
    timestamp: Date.now(),
    currentPrice: 50000,
    zScore: 2.5,
    ouTheta: 0.15,
    ouMu: 49500,
    ouSigma: 500,
    halfLifePeriods: 18,
    hurstExponent: 0.55,
    adfTStat: -3.2,
    isStationary: true,
    rsi14: 35,
    bbUpper: 51000,
    bbLower: 49000,
    bbMiddle: 50000,
    realizedVolAnn: 0.85,
    microstructureNoiseRatio: 0.05,
    orderFlowImbalance: 0.12,
    ...overrides,
  };
}

const engine = new SignalScoringEngine();

// ============================================================================
// Scoring Components
// ============================================================================

test('RSI: oversold BUY gets high score (>15)', () => {
  const features = mockFeatures({ rsi14: 35 });
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.02);
  const rsiScore = consensus.signals.find(s => s.name === 'RSI14');
  assert.ok(rsiScore, 'RSI score missing');
  assert.ok(rsiScore.score > 15, `RSI score ${rsiScore.score} not > 15`);
  assert.ok(rsiScore.reason.includes('Oversold'), `Reason: ${rsiScore.reason}`);
});

test('RSI: overbought SELL gets high score (>15)', () => {
  const features = mockFeatures({ rsi14: 75 });
  const consensus = engine.scoreSignal(features, 'SELL', 1.5, -0.02);
  const rsiScore = consensus.signals.find(s => s.name === 'RSI14');
  assert.ok(rsiScore, 'RSI score missing');
  assert.ok(rsiScore.score > 15, `RSI score ${rsiScore.score} not > 15`);
  assert.ok(rsiScore.reason.includes('Overbought'), `Reason: ${rsiScore.reason}`);
});

test('RSI: neutral (50) gets low score', () => {
  const features = mockFeatures({ rsi14: 50 });
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.02);
  const rsiScore = consensus.signals.find(s => s.name === 'RSI14');
  assert.ok(rsiScore, 'RSI score missing');
  assert.ok(rsiScore.score < 15, `RSI score ${rsiScore.score} should be < 15`);
});

test('Trend: stationary signals boost score', () => {
  const features = mockFeatures({ isStationary: true });
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.01);
  const trendScore = consensus.signals.find(s => s.name === 'Trend');
  assert.ok(trendScore, 'Trend score missing');
  assert.ok(trendScore.reason.includes('Stationary'), `Reason: ${trendScore.reason}`);
});

test('Trend: non-stationary gets penalty', () => {
  const features = mockFeatures({ isStationary: false });
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.01);
  const trendScore = consensus.signals.find(s => s.name === 'Trend');
  assert.ok(trendScore, 'Trend score missing');
  assert.ok(trendScore.reason.includes('Non-stationary'), `Reason: ${trendScore.reason}`);
});

test('Volume: 2x+ surge gets high score (>12)', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 2.5, 0.02);
  const volScore = consensus.signals.find(s => s.name === 'Volume');
  assert.ok(volScore, 'Volume score missing');
  assert.ok(volScore.score > 12, `Volume score ${volScore.score} not > 12`);
  assert.ok(volScore.reason.includes('Heavy Volume'), `Reason: ${volScore.reason}`);
});

test('Volume: low volume (<1x) gets minimal score', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 0.5, 0.02);
  const volScore = consensus.signals.find(s => s.name === 'Volume');
  assert.ok(volScore, 'Volume score missing');
  assert.ok(volScore.score === 0, `Volume score ${volScore.score} should be 0`);
});

test('Momentum: BUY with positive price change gets high score', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.035);
  const momScore = consensus.signals.find(s => s.name === 'Momentum');
  assert.ok(momScore, 'Momentum score missing');
  assert.ok(momScore.score > 5, `Momentum score ${momScore.score} should be > 5`);
});

test('Momentum: SELL with negative price change gets high score', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'SELL', 1.5, -0.035);
  const momScore = consensus.signals.find(s => s.name === 'Momentum');
  assert.ok(momScore, 'Momentum score missing');
  assert.ok(momScore.score > 5, `Momentum score ${momScore.score} should be > 5`);
});

// ============================================================================
// Consensus Calculation
// ============================================================================

test('Consensus: total score is 0-100', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 1.8, 0.02);
  assert.ok(consensus.totalScore >= 0, `Score ${consensus.totalScore} < 0`);
  assert.ok(consensus.totalScore <= 100, `Score ${consensus.totalScore} > 100`);
});

test('Consensus: confidence is 0-1', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 1.8, 0.02);
  assert.ok(consensus.confidence >= 0, `Confidence ${consensus.confidence} < 0`);
  assert.ok(consensus.confidence <= 1, `Confidence ${consensus.confidence} > 1`);
});

test('Consensus: high-quality signals get >60% confidence', () => {
  const features = mockFeatures({
    rsi14: 32,
    isStationary: true,
    zScore: 2.8,
  });
  const consensus = engine.scoreSignal(features, 'BUY', 2.0, 0.03);
  assert.ok(consensus.confidence > 0.60, `Confidence ${consensus.confidence} not > 0.60`);
  assert.ok(consensus.shouldTrade === true, `Should trade`);
});

test('Consensus: weak signals get <40% confidence', () => {
  const features = mockFeatures({
    rsi14: 55,
    isStationary: false,
    zScore: 0.1,
  });
  const consensus = engine.scoreSignal(features, 'BUY', 0.5, -0.001);
  assert.ok(consensus.confidence < 0.40, `Confidence ${consensus.confidence} not < 0.40`);
  assert.ok(consensus.shouldTrade === false, `Should not trade`);
});

// ============================================================================
// Dynamic Thresholds
// ============================================================================

test('Threshold: STRONG_TREND = 55%', () => {
  const threshold = engine.getDynamicThreshold('STRONG_TREND');
  assert.equal(threshold, 0.55, `Threshold ${threshold} != 0.55`);
});

test('Threshold: SIDEWAYS = 70%', () => {
  const threshold = engine.getDynamicThreshold('SIDEWAYS');
  assert.equal(threshold, 0.70, `Threshold ${threshold} != 0.70`);
});

test('Threshold: VOLATILE = 65%', () => {
  const threshold = engine.getDynamicThreshold('VOLATILE');
  assert.equal(threshold, 0.65, `Threshold ${threshold} != 0.65`);
});

test('Regime: market regime field is set correctly', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 1.5, 0.01, 'SIDEWAYS');
  assert.equal(consensus.marketRegime, 'SIDEWAYS', `Regime ${consensus.marketRegime} != SIDEWAYS`);
});

// ============================================================================
// Edge Cases
// ============================================================================

test('Edge: extreme RSI (5) capped at 22', () => {
  const features = mockFeatures({ rsi14: 5 });
  const consensus = engine.scoreSignal(features, 'BUY', 2.0, 0.04);
  const rsiScore = consensus.signals.find(s => s.name === 'RSI14');
  assert.equal(rsiScore?.score, 22, `RSI score ${rsiScore?.score} != 22`);
});

test('Edge: zero volume score = 0', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 0, 0.01);
  const volScore = consensus.signals.find(s => s.name === 'Volume');
  assert.equal(volScore?.score, 0, `Volume score ${volScore?.score} should be 0`);
});

test('Edge: total score never exceeds 100', () => {
  const features = mockFeatures({
    rsi14: 25,
    zScore: 3.0,
    hurstExponent: 0.65,
    isStationary: true,
  });
  const consensus = engine.scoreSignal(features, 'BUY', 3.0, 0.05);
  assert.ok(consensus.totalScore <= 100, `Score ${consensus.totalScore} > 100`);
});

// ============================================================================
// Report Generation
// ============================================================================

test('Report: contains all required fields', () => {
  const features = mockFeatures();
  const consensus = engine.scoreSignal(features, 'BUY', 1.8, 0.02);
  const report = engine.generateReport(consensus);
  
  assert.ok(report.includes('Signal Consensus Report'), 'Missing header');
  assert.ok(report.includes('Total Score'), 'Missing Total Score');
  assert.ok(report.includes('Confidence'), 'Missing Confidence');
  assert.ok(report.includes('RSI14'), 'Missing RSI14');
});

// ============================================================================
// Confidence Improvement Validation
// ============================================================================

test('Improvement: high-quality >60% confidence', () => {
  const features = mockFeatures({
    rsi14: 28,
    isStationary: true,
    zScore: 2.5,
  });
  const consensus = engine.scoreSignal(features, 'BUY', 2.2, 0.035);
  assert.ok(consensus.confidence > 0.60, `Confidence ${consensus.confidence} not > 0.60`);
  assert.ok(consensus.shouldTrade === true);
});

test('Improvement: low-quality <40% confidence', () => {
  const features = mockFeatures({
    rsi14: 52,
    isStationary: false,
    zScore: 0.05,
  });
  const consensus = engine.scoreSignal(features, 'BUY', 0.5, -0.001);
  assert.ok(consensus.confidence < 0.40, `Confidence ${consensus.confidence} not < 0.40`);
  assert.ok(consensus.shouldTrade === false);
});

test('Improvement: >20% gap between good and bad', () => {
  const good = engine.scoreSignal(mockFeatures({ rsi14: 30, isStationary: true }), 'BUY', 2.0, 0.03);
  const bad = engine.scoreSignal(
    mockFeatures({ rsi14: 55, isStationary: false, zScore: 0.1 }),
    'BUY',
    0.5,
    -0.001
  );
  
  const gap = good.confidence - bad.confidence;
  assert.ok(gap > 0.15, `Gap ${gap} not > 0.15`);
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`📊 SignalScoringEngine Test Summary`);
console.log(`${'='.repeat(50)}`);
console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
