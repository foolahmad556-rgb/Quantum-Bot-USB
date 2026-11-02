import assert from 'node:assert/strict';
import { RegimeDetector } from '../risk/RegimeDetector';

function analyzeWith(hurstExponent: number, adx: number) {
  const detector = new RegimeDetector();
  const impl = detector as any;
  impl.calculateVolatility = () => 0.10;
  impl.calculateHurstExponent = () => hurstExponent;
  impl.calculateADX = () => adx;
  impl.calculateTrendStrength = () => 0.8;
  return detector.analyze();
}

const confirmedTrend = analyzeWith(0.80, 50);
assert.equal(confirmedTrend.marketRegime, 'TRENDING');
assert.ok(confirmedTrend.confidence >= 0.75);
assert.equal(confirmedTrend.tradingAllowed, true, 'high-confidence trends must allow breakout entries');

const uncertainTrend = analyzeWith(0.55, 25);
assert.equal(uncertainTrend.marketRegime, 'TRENDING');
assert.ok(uncertainTrend.confidence < 0.75);
assert.equal(uncertainTrend.tradingAllowed, false, 'uncertain trends must remain blocked');

const rangingMarket = analyzeWith(0.35, 10);
assert.notEqual(rangingMarket.marketRegime, 'TRENDING');
assert.equal(rangingMarket.tradingAllowed, true);

console.log('PASS RegimeDetector allows confirmed trends and blocks uncertain trends');
