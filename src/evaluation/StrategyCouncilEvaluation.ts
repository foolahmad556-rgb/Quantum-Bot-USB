import { createHash } from 'node:crypto';
import type { Candle } from '../domain/types';
import { FeatureEngine } from '../features/FeatureEngine';
import { decide } from '../strategies/DecisionEngine';
import { MeanReversionStrategy } from '../strategies/MeanReversionStrategy';
import { decideByCouncil, evaluateCandleCouncil } from '../strategies/StrategyCouncil';
import { BoardOfDirectorsEngine } from '../strategies/BoardOfDirectorsEngine';
import { createRng } from '../quantum/seededRng';

export interface EvaluationOptions {
  intervalMs: number;
  horizon: number;
  feeBps: number;
  slippageBps: number;
  spreadBps: number;
  fundingBpsPer8h: number;
  maxParticipation: number;
  exposure: number;
  initialEquity: number;
  seed: number;
  entryZ: number;
  start: number;
  end: number;
  ablations: boolean;
}
export const DEFAULT_EVALUATION: EvaluationOptions = {
  intervalMs: 60_000, horizon: 5, feeBps: 5, slippageBps: 3, spreadBps: 2,
  fundingBpsPer8h: 1, maxParticipation: 0.01, exposure: 0.1, initialEquity: 10000,
  seed: 20261019, entryZ: 1.6, start: 100, end: Infinity, ablations: false,
};
export interface Observation {
  at: number; exitAt: number; model: string; action: string; confidence: number;
  netReturn: number; turnover: number; executed: boolean; size: number; board?: unknown;
}

export function validateDataset(candles: Candle[], intervalMs: number) {
  if (candles.length < 150 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('At least 150 regular candles required');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
        Math.min(c.open, c.high, c.low, c.close) <= 0 || c.volume < 0 ||
        c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) ||
        (i > 0 && c.timestamp - candles[i - 1].timestamp !== intervalMs)) {
      throw new Error(`Invalid, duplicate or gapped candle at ${i}`);
    }
  }
}

export function summarize(observations: Observation[]) {
  const trades = observations.filter(x => x.executed);
  const returns = observations.map(x => x.netReturn);
  let equity = 1, peak = 1, maxDrawdown = 0;
  for (const r of returns) { equity *= 1 + r; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak); }
  const wins = trades.filter(x => x.netReturn > 0), losses = trades.filter(x => x.netReturn < 0);
  const profit = wins.reduce((s, x) => s + x.netReturn, 0), loss = -losses.reduce((s, x) => s + x.netReturn, 0);
  const mean = trades.length ? trades.reduce((s, x) => s + x.netReturn, 0) / trades.length : 0;
  const variance = trades.length > 1 ? trades.reduce((s, x) => s + (x.netReturn - mean) ** 2, 0) / (trades.length - 1) : 0;
  const se = Math.sqrt(variance / Math.max(trades.length, 1));
  return { opportunities: observations.length, trades: trades.length, netReturn: equity - 1, maxDrawdown,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: loss > 0 ? profit / loss : null, expectancy: trades.length ? mean : null,
    // Diagnostic normal approximation; serial dependence and selection can invalidate it.
    approximateMean95: trades.length >= 30 ? [mean - 1.96 * se, mean + 1.96 * se] : null,
    confidenceBrier: trades.length ? trades.reduce((s, t) => s + (t.confidence - Number(t.netReturn > 0)) ** 2, 0) / trades.length : null,
    confidenceBins: [0, 0.25, 0.5, 0.75].map(low => {
      const bin = trades.filter(t => t.confidence >= low && (low === 0.75 ? t.confidence <= 1 : t.confidence < low + 0.25));
      return { low, count: bin.length, winRate: bin.length ? bin.filter(t => t.netReturn > 0).length / bin.length : null };
    }), insufficientSample: trades.length < 30 };
}

/** Fixed-horizon, next-open diagnostic comparison, not a production fill simulator.
 * Every variant sees the same past-only candles, costs, capital cap and opportunities.
 * Counterfactual rejected signals are retained; no live learning/state is touched.
 */
export function evaluateStrategies(candles: Candle[], overrides: Partial<EvaluationOptions> = {}) {
  const config = { ...DEFAULT_EVALUATION, ...overrides };
  validateDataset(candles, config.intervalMs);
  if (!Number.isInteger(config.horizon) || config.horizon < 1 || !Number.isInteger(config.seed) ||
      !Number.isInteger(config.start) || config.start < 60 ||
      ![config.feeBps, config.slippageBps, config.spreadBps, config.fundingBpsPer8h].every(x => Number.isFinite(x) && x >= 0) ||
      !Number.isFinite(config.entryZ) || config.entryZ <= 0 ||
      config.exposure <= 0 || config.exposure > 1 || config.maxParticipation <= 0 || config.maxParticipation > 1 ||
      !Number.isFinite(config.initialEquity) || config.initialEquity <= 0) throw new Error('Invalid evaluation configuration');
  const features = new FeatureEngine(), reversion = new MeanReversionStrategy({ zScoreEntryThreshold: config.entryZ });
  const agentIds = ['algo', 'trading', 'quant', 'scout', 'market', 'risk', 'wf', 'oos', 'cross', 'tf', 'sens', 'boot', 'stress', 'regime'];
  const variants = ['adaptive', 'mean-reversion', 'candle-council', 'simple-filter', 'board-weighted', 'board-equal', 'board-cost-aligned',
    ...(config.ablations ? agentIds.map(a => `without-${a}`) : [])];
  let asOf = 0;
  const boards = new Map(variants.filter(v => v.startsWith('board-') || v.startsWith('without-')).map(v => [v,
    BoardOfDirectorsEngine.forEvaluation({ seed: config.seed, now: () => asOf, equalWeights: v === 'board-equal',
      exclude: v.startsWith('without-') ? v.slice(8) : undefined }, v === 'board-cost-aligned' ? { tradingCostPerSide: (config.feeBps + config.slippageBps + config.spreadBps / 2) / 10000 } : undefined)]));
  const observations: Observation[] = [];
  const equities = Object.fromEntries(variants.map(v => [v, config.initialEquity]));
  const end = Math.min(config.end, candles.length);
  for (let i = config.start; i + config.horizon + 1 < end; i += config.horizon + 1) {
    const past = candles.slice(Math.max(0, i - 199), i + 1);
    asOf = candles[i].timestamp + config.intervalMs;
    const f = features.extractFeatures('BTC/USDT', candles[i].close, past);
    f.timestamp = asOf;
    const adaptive = decide({ features: f, params: { entryZ: config.entryZ } });
    const mr = reversion.evaluate(f);
    const council = decideByCouncil(evaluateCandleCouncil(past, { asOf, intervalMs: config.intervalMs }));
    const sideOf = (signal: typeof adaptive) => signal?.type.includes('BUY') ? 'BUY' : signal?.type.includes('SELL') ? 'SELL' : 'HOLD';
    for (const model of variants) {
      let action = sideOf(adaptive), confidence = adaptive?.strength || 0, size = action === 'HOLD' ? 0 : 1;
      let board: any;
      if (model === 'mean-reversion') { action = sideOf(mr); confidence = mr?.strength || 0; size = action === 'HOLD' ? 0 : 1; }
      if (model === 'candle-council') { action = council?.side || 'HOLD'; confidence = council?.confidence || 0; size = council ? 1 : 0; }
      if (model === 'simple-filter' && (!council || council.side !== action)) size = 0;
      if (boards.has(model)) {
        board = boards.get(model)!.holdMeeting({ symbol: 'BTC/USDT', candles: past, signals: adaptive ? [adaptive] : [], features: f });
        size = board.sizeMultiplier; confidence = board.approvalRatio;
      }
      const entry = candles[i + 1], exit = candles[i + 1 + config.horizon];
      const impact = (config.slippageBps + config.spreadBps / 2) / 10000, direction = action === 'BUY' ? 1 : -1;
      const entryPrice = entry.open * (1 + direction * impact), exitPrice = exit.open * (1 - direction * impact);
      // Participation uses the last known bar, not future bar volume. The resulting
      // fills are an assumption; this is not proof of future execution liquidity.
      const quantity = size > 0 ? Math.min(equities[model] * config.exposure * size / entryPrice, candles[i].volume * config.maxParticipation) : 0;
      const fee = quantity * (entryPrice + exitPrice) * config.feeBps / 10000;
      const funding = quantity * entryPrice * config.fundingBpsPer8h / 10000 * config.horizon * config.intervalMs / (8 * 3600000);
      const pnl = quantity * direction * (exitPrice - entryPrice) - fee - funding;
      const netReturn = quantity > 0 ? pnl / equities[model] : 0;
      equities[model] *= 1 + netReturn;
      observations.push({ at: asOf, exitAt: exit.timestamp, model, action: size > 0 ? action : 'HOLD',
        confidence, size, netReturn, turnover: quantity * entryPrice, executed: quantity > 0,
        ...(board ? { board: { votes: board.votes, proposals: board.proposals, verdict: board.verdict, voteWeights: board.voteWeights } } : {}) });
    }
  }
  return { config: { ...config, end }, datasetHash: createHash('sha256').update(JSON.stringify(candles)).digest('hex'),
    rejectionCounts: Object.fromEntries([...boards.keys()].map(model => [model, Object.fromEntries(agentIds.map(member => [member, observations.filter(o => o.model === model && (o.board as any)?.votes?.[member] === 'rejected').length]))])),
    summaries: Object.fromEntries(variants.map(model => [model, summarize(observations.filter(x => x.model === model))])), observations };
}

/** Selection uses validation only. Purged, chronologically later test data is untouched. */
export function walkForwardEvaluation(candles: Candle[], options: Partial<EvaluationOptions> = {}) {
  const horizon = options.horizon ?? DEFAULT_EVALUATION.horizon;
  if (candles.length < 400) throw new Error('Walk-forward requires at least 400 candles');
  const n = candles.length, folds = [];
  for (const split of [0.5, 0.7]) {
    const trainEnd = Math.floor(n * (split - 0.2)), validationEnd = Math.floor(n * split);
    const testEnd = Math.min(n, Math.floor(n * (split + 0.2)));
    const candidates = [1.6, 2.0, 2.4].map(entryZ => {
      const result = evaluateStrategies(candles, { ...options, ablations: false, entryZ, start: Math.max(100, trainEnd + horizon), end: validationEnd });
      const score = result.summaries.adaptive;
      return { entryZ, score: score.netReturn - score.maxDrawdown, trades: score.trades };
    });
    const selected = [...candidates].sort((a,b) => b.score - a.score || a.entryZ - b.entryZ)[0];
    folds.push({ trainEnd, validationEnd, testEnd, candidates, selected,
      test: evaluateStrategies(candles, { ...options, entryZ: selected.entryZ, start: validationEnd + horizon, end: testEnd }) });
  }
  return { methodology: 'Anchored expanding history; validation-only parameter choice; horizon purge; untouched next chronological test windows', folds };
}

export function scenarioCandles(kind: 'up' | 'down' | 'range' | 'crash' | 'volatile' | 'illiquid', count = 480): Candle[] {
  const rng = createRng(20261019), result: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = kind === 'up' ? 0.001 : kind === 'down' ? -0.001 : kind === 'range' ? (100 - price) / price * 0.1 : 0;
    const noise = (rng() - 0.5) * (kind === 'volatile' ? 0.035 : 0.008);
    price *= 1 + drift + noise + (kind === 'crash' && i === 250 ? -0.25 : 0);
    result.push({ timestamp: 1700000000000 + i * 60000, open, close: price, high: Math.max(open, price) * 1.001,
      low: Math.min(open, price) * 0.999, volume: kind === 'illiquid' ? 0.001 : 1000, vwap: (open + price) / 2 });
  }
  return result;
}
