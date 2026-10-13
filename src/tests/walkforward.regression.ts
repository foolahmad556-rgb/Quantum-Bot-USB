/**
 * Regression tests: WalkForwardValidator.
 * Run: npx tsx src/tests/walkforward.regression.ts
 * Deterministic: all synthetic series use mulberry32 with fixed seeds (no Math.random).
 */
import assert from 'node:assert/strict';
import { WalkForwardValidator } from '../validation/WalkForward';
import { Candle } from '../domain/types';
import { mulberry32 } from '../utils/seededRng';

const HOUR = 3600000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function candle(i: number, price: number): Candle {
  return {
    timestamp: i * HOUR,
    open: Math.max(0.01, price - 1),
    high: Math.max(price, price + 2),
    low: Math.min(price, price - 2),
    close: Math.max(0.01, price),
    volume: 1,
    vwap: price,
  };
}

/** Seeded random-walk with drift. */
function makeSeries(n: number, drift: number, vol: number, seed: number): Map<string, Candle[]> {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += drift + (rnd() - 0.5) * vol * 2;
    out.push(candle(i, price));
  }
  return new Map([['BTC/USDT', out]]);
}

/** Strong uptrend in the first 70% (in-sample), then reversal and decay (out-of-sample). */
function makeCollapseSeries(n: number, seed: number): Map<string, Candle[]> {
  const rnd = mulberry32(seed);
  const cut = Math.floor(n * 0.7);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    if (i < cut) {
      price += 0.8 + (rnd() - 0.5) * 0.5;
    } else {
      price = Math.max(0.01, price - 1.5 - rnd() * 0.5);
    }
    out.push(candle(i, price));
  }
  return new Map([['BTC/USDT', out]]);
}

const N = 200;
const WINDOWS = 4;
const BLOCK = Math.floor(N / WINDOWS); // 50
const IS_SIZE = Math.floor(BLOCK * 0.7); // 35 (matches WalkForward.ts isSize)

// 1. Real API call, correct arity, correct window count.
const noEdge = WalkForwardValidator.runWalkForwardValidation(WINDOWS, makeSeries(N, 0.05, 1, 7));
assert.equal(noEdge.windows.length, WINDOWS, 'window count must equal numWindows');

// 2. Non-leakage: window i's OOS bars must not appear in any later window's IS bars.
//    Recover bar indices from timestamps (candle timestamp = index * HOUR).
for (let i = 0; i < noEdge.windows.length; i++) {
  const w = noEdge.windows[i];
  const oosStart = i * BLOCK + IS_SIZE;
  const oosEnd = i * BLOCK + BLOCK; // exclusive
  for (let j = i + 1; j < noEdge.windows.length; j++) {
    const isStart = j * BLOCK;
    const isEnd = j * BLOCK + IS_SIZE; // exclusive
    assert.ok(
      oosEnd <= isStart || isEnd <= oosStart,
      `window ${j} IS [${isStart},${isEnd}) overlaps window ${i} OOS [${oosStart},${oosEnd})`
    );
  }
  // Labels must be timestamp-derived ISO datetimes, matching the actual bar times.
  assert.match(w.trainStart, ISO, `trainStart not ISO: ${w.trainStart}`);
  assert.match(w.testEnd, ISO, `testEnd not ISO: ${w.testEnd}`);
  assert.equal(w.trainStart, new Date(i * BLOCK * HOUR).toISOString(), 'trainStart must equal first IS bar time');
  assert.equal(w.testStart, new Date(oosStart * HOUR).toISOString(), 'testStart must equal first OOS bar time');
}

// 2b. Non-vacuous: the validator must actually trade, otherwise every check is trivially true.
assert.ok(
  noEdge.windows.some((w) => w.inSampleSharpe !== 0 || w.inSampleReturnPct !== 0),
  'noEdge: engine produced no in-sample activity; test is vacuous'
);

// 3. No Sharpe floors: all values finite, no NaN.
for (const w of noEdge.windows) {
  assert.ok(Number.isFinite(w.inSampleSharpe), `IS Sharpe not finite: ${w.inSampleSharpe}`);
  assert.ok(Number.isFinite(w.outOfSampleSharpe), `OOS Sharpe not finite: ${w.outOfSampleSharpe}`);
}

// 4. Determinism: same seed -> identical result.
const again = WalkForwardValidator.runWalkForwardValidation(WINDOWS, makeSeries(N, 0.05, 1, 7));
assert.deepStrictEqual(again, noEdge, 'same seed must yield identical result');

// 4b. Regression: a series with no in-sample edge must never be HIGHLY_ROBUST
//     (old sign-blind ratio certified losing strategies: -27/-16 Sharpe -> 0.91).
assert.notEqual(noEdge.verdict, 'HIGHLY_ROBUST', 'losing series certified HIGHLY_ROBUST');
assert.ok(noEdge.avgInSampleSharpe <= 0 || noEdge.verdict !== 'HIGHLY_ROBUST', 'sign-blind efficiency regression');

// 5. Collapse case: strong IS trend, OOS reversal. The validator must not call it robust.
const collapse = WalkForwardValidator.runWalkForwardValidation(WINDOWS, makeCollapseSeries(N, 11));
assert.notEqual(collapse.verdict, 'HIGHLY_ROBUST', `collapse case must not be HIGHLY_ROBUST (got ${collapse.verdict})`);
assert.ok(
  collapse.windows.some((w) => !w.robustnessPass),
  'collapse case must fail robustness in at least one window'
);

console.log('✓ WalkForward regression passed');
console.log(`  noEdge verdict: ${noEdge.verdict}, efficiency: ${noEdge.overallEfficiency}`);
console.log(`  collapse verdict: ${collapse.verdict}, efficiency: ${collapse.overallEfficiency}`);
console.log(`  collapse failing windows: ${collapse.windows.filter((w) => !w.robustnessPass).length}/${collapse.windows.length}`);
