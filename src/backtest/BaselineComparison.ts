export interface BaselineResult {
  finalEquity: number;
  returnPct: number;
}

export interface RandomBaselineResult {
  simulations: number;
  distribution: number[];
  medianFinalEquity: number;
}

export interface BaselineComparisonResult {
  buyAndHold: BaselineResult;
  strategy: BaselineResult & { beatsBuyAndHold: boolean; beatsRandom: boolean };
  randomBaseline: RandomBaselineResult;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function compareBaselines(prices: number[], strategyReturns: number[], initialCapital: number): BaselineComparisonResult {
  if (prices.length < 2) throw new Error('prices must contain at least two values');
  if (strategyReturns.length !== prices.length - 1) throw new Error('returns must match price intervals');
  if (initialCapital <= 0) throw new Error('initial capital must be positive');

  const buyAndHoldFinal = initialCapital * prices[prices.length - 1] / prices[0];
  let strategyFinal = initialCapital;
  for (const returnPct of strategyReturns) strategyFinal *= 1 + returnPct;

  const random = seededRandom(42);
  const distribution: number[] = [];
  for (let run = 0; run < 1_000; run++) {
    let equity = initialCapital;
    for (const returnPct of strategyReturns) equity *= 1 + strategyReturns[Math.floor(random() * strategyReturns.length)];
    distribution.push(equity);
  }
  const randomMedian = median(distribution);
  return {
    buyAndHold: { finalEquity: buyAndHoldFinal, returnPct: (buyAndHoldFinal / initialCapital - 1) * 100 },
    strategy: { finalEquity: strategyFinal, returnPct: (strategyFinal / initialCapital - 1) * 100, beatsBuyAndHold: strategyFinal > buyAndHoldFinal, beatsRandom: strategyFinal > randomMedian },
    randomBaseline: { simulations: 1_000, distribution, medianFinalEquity: randomMedian },
  };
}
