export interface MonteCarloOptions {
  simulations: number;
  initialCapital: number;
  seed: number;
}

export interface MonteCarloResult {
  simulations: number;
  distribution: number[];
  percentiles: { p05: number; p50: number; p95: number };
  bestFinalEquity: number;
  worstFinalEquity: number;
  probabilityOfLoss: number;
  worstMaxDrawdownPct: number;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function percentile(values: number[], ratio: number): number {
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)));
  return values[index];
}

export function runMonteCarloStress(trades: number[], options: MonteCarloOptions): MonteCarloResult {
  if (!trades.length) throw new Error('trades must not be empty');
  if (!Number.isInteger(options.simulations) || options.simulations <= 0) throw new Error('simulations must be positive');
  if (options.initialCapital <= 0) throw new Error('initial capital must be positive');
  const random = rng(options.seed);
  const distribution: number[] = [];
  let worstMaxDrawdownPct = 0;
  for (let run = 0; run < options.simulations; run++) {
    let equity = options.initialCapital;
    let peak = equity;
    let maxDrawdown = 0;
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[Math.floor(random() * trades.length)];
      equity *= 1 + trade;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
    }
    distribution.push(equity);
    worstMaxDrawdownPct = Math.max(worstMaxDrawdownPct, maxDrawdown);
  }
  const sorted = [...distribution].sort((a, b) => a - b);
  return {
    simulations: options.simulations,
    distribution,
    percentiles: { p05: percentile(sorted, 0.05), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) },
    bestFinalEquity: sorted[sorted.length - 1],
    worstFinalEquity: sorted[0],
    probabilityOfLoss: distribution.filter((equity) => equity < options.initialCapital).length / distribution.length,
    worstMaxDrawdownPct,
  };
}
