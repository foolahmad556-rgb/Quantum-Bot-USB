/** Seven-member council transition contract. */
import assert from 'node:assert/strict';
import { BoardOfDirectorsEngine } from '../strategies/BoardOfDirectorsEngine';

const engine = BoardOfDirectorsEngine.getInstance({ capital: 1000 });
const council = engine.getCouncilStructure();

assert.equal(council.length, 7);
assert.deepEqual(council.map((member) => member.id), [
  'market-regime',
  'trend-structure',
  'momentum',
  'volume-liquidity',
  'reversion-timing',
  'risk-sentinel',
  'execution-arbiter'
]);

for (const member of council) {
  assert.ok(member.primaryFile.length > 0);
  assert.ok(member.secondaryFile.length > 0);
  assert.notEqual(member.primaryFile, member.secondaryFile);
  assert.ok(member.legacyAgentIds.length > 0);
}

const risk = council.find((member) => member.id === 'risk-sentinel');
assert.equal(risk?.hasVeto, true);
assert.equal(council.find((member) => member.id === 'execution-arbiter')?.canExecute, true);
const shadow = engine.getShadowModeSnapshot();
assert.equal(shadow.mode, 'SHADOW');
assert.equal(shadow.executionEnabled, false);
assert.equal(shadow.members, 7);
assert.equal(shadow.legacyAgents, 14);
assert.equal(shadow.mappedLegacyAgents, 14);
const memberDecision = engine.evaluateSevenMemberCouncil({
  symbol: 'BTC/USDT',
  candles: [
    { close: 100, high: 101, low: 99, volume: 100 },
    { close: 101, high: 102, low: 100, volume: 120 },
    { close: 102, high: 103, low: 101, volume: 140 },
    { close: 103, high: 104, low: 102, volume: 160 },
    { close: 104, high: 105, low: 103, volume: 180 }
  ],
  signal: 'BUY'
});
assert.equal(memberDecision.executionEnabled, false);
assert.equal(memberDecision.veto, false);
assert.equal(memberDecision.action, 'BUY');
assert.equal(memberDecision.members.length, 7);
assert.ok(memberDecision.confidence > 0);

const comparison = engine.compareShadowDecision({
  symbol: 'BTC/USDT',
  incumbent: { verdict: 'APPROVED', action: 'BUY', approvalRatio: 0.8 },
  shadow: { verdict: 'CONDITIONAL', action: 'BUY', approvalRatio: 0.6 },
  veto: false,
  confidence: 0.75
});
assert.equal(comparison.symbol, 'BTC/USDT');
assert.equal(comparison.incumbentAction, 'BUY');
assert.equal(comparison.shadowAction, 'BUY');
assert.equal(comparison.actionMatch, true);
assert.equal(comparison.verdictMatch, false);
assert.equal(comparison.executionEnabled, false);

const report = engine.buildShadowReport([
  comparison,
  { ...comparison, shadowAction: 'SELL', actionMatch: false, verdictMatch: false, veto: true }
]);
assert.equal(report.total, 2);
assert.equal(report.actionMatches, 1);
assert.equal(report.vetoes, 1);
assert.equal(report.actionMatchRate, 0.5);
assert.equal(report.executionEnabled, false);
console.log('PASS seven-member council shadow contract');
