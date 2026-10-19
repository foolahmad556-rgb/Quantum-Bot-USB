import assert from 'node:assert/strict';
import { evaluateStrategies, scenarioCandles } from '../src/evaluation/StrategyCouncilEvaluation';
// Offline decision replay parity, not live/backtest execution parity.
const data = scenarioCandles('range', 240);
const a = evaluateStrategies(data), b = evaluateStrategies(data);
assert.deepEqual(a.observations, b.observations);
console.log('PASS deterministic decision replay parity; live execution parity remains unverified');
