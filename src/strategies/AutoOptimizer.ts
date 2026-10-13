/**
 * AutoOptimizer.ts
 * Two-stage grid-search parameter optimizer for strategies.
 *
 * - Stage 1 (coarse): 5 evenly spaced values per parameter across the full
 *   parameter space
 * - Stage 2 (fine): 5 evenly spaced values per parameter in a narrow band
 *   around the coarse best
 * - Every combination is scored via evaluateFn(params) -> Sharpe
 * - Full optimization history is tracked per strategy
 */

export type ParamBound = { min: number; max: number } | [number, number];

export interface OptimizationRecord {
  strategyName: string;
  stage: 'coarse' | 'fine';
  params: Record<string, number>;
  score: number;
  timestamp: number;
}

export interface OptimizationResult {
  strategyName: string;
  bestParams: Record<string, number>;
  bestScore: number;
  stage: 'coarse' | 'fine';
  evaluations: number;
  history: OptimizationRecord[];
}

export type OptimizeEvaluator = (params: Record<string, number>) => number | Promise<number>;

const GRID_VALUES = 5;
const MAX_COMBINATIONS = 10000;

interface NormalizedBound {
  min: number;
  max: number;
}

interface SearchOutcome {
  stage: 'coarse' | 'fine';
  params: Record<string, number>;
  score: number;
  records: OptimizationRecord[];
}

export class AutoOptimizer {
  private history: OptimizationRecord[] = [];

  /**
   * Grid-searches the parameter space for a strategy.
   *
   * @param strategyName strategy identifier recorded in the history
   * @param paramBounds parameter name -> { min, max } (or [min, max] tuple)
   * @param evaluateFn scores a parameter combination (returns a Sharpe ratio)
   * @returns best parameter combination, its score, and the run history
   */
  public async optimize(
    strategyName: string,
    paramBounds: Record<string, ParamBound>,
    evaluateFn: OptimizeEvaluator
  ): Promise<OptimizationResult> {
    const bounds = normalizeBounds(paramBounds);
    const paramNames = Object.keys(bounds);

    if (paramNames.length === 0) {
      const score = await safeEvaluate(evaluateFn, {});
      const record: OptimizationRecord = {
        strategyName,
        stage: 'coarse',
        params: {},
        score,
        timestamp: Date.now(),
      };
      this.history.push(record);
      return {
        strategyName,
        bestParams: {},
        bestScore: score,
        stage: 'coarse',
        evaluations: 1,
        history: [record],
      };
    }

    // Stage 1: coarse grid over the full parameter space
    const coarseGrid = buildGrid(bounds, paramNames, GRID_VALUES);
    const coarseBest = await this.search(strategyName, 'coarse', coarseGrid, evaluateFn);

    // Stage 2: fine grid around the coarse best
    const fineBounds = fineBoundsAround(coarseBest.params, bounds);
    const fineGrid = buildGrid(fineBounds, paramNames, GRID_VALUES);
    const fineBest = await this.search(strategyName, 'fine', fineGrid, evaluateFn);

    const best = fineBest.score > coarseBest.score ? fineBest : coarseBest;
    const runHistory = [...coarseBest.records, ...fineBest.records];

    return {
      strategyName,
      bestParams: best.params,
      bestScore: best.score,
      stage: best.stage,
      evaluations: runHistory.length,
      history: runHistory,
    };
  }

  /** Returns optimization history, optionally filtered by strategy name. */
  public getHistory(strategyName?: string): OptimizationRecord[] {
    if (!strategyName) return [...this.history];
    return this.history.filter((r) => r.strategyName === strategyName);
  }

  private async search(
    strategyName: string,
    stage: 'coarse' | 'fine',
    grid: Array<Record<string, number>>,
    evaluateFn: OptimizeEvaluator
  ): Promise<SearchOutcome> {
    let bestParams: Record<string, number> = grid[0] || {};
    let bestScore = -Infinity;
    const records: OptimizationRecord[] = [];

    for (const params of grid) {
      const score = await safeEvaluate(evaluateFn, params);
      const record: OptimizationRecord = { strategyName, stage, params, score, timestamp: Date.now() };
      records.push(record);
      this.history.push(record);
      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
      }
    }

    return { stage, params: bestParams, score: bestScore, records };
  }
}

function normalizeBounds(
  paramBounds: Record<string, ParamBound>
): Record<string, NormalizedBound> {
  const normalized: Record<string, NormalizedBound> = {};
  for (const [name, bound] of Object.entries(paramBounds)) {
    const min = Array.isArray(bound) ? bound[0] : bound.min;
    const max = Array.isArray(bound) ? bound[1] : bound.max;
    normalized[name] = { min: Math.min(min, max), max: Math.max(min, max) };
  }
  return normalized;
}

function buildGrid(
  bounds: Record<string, NormalizedBound>,
  paramNames: string[],
  valuesPerParam: number
): Array<Record<string, number>> {
  const axes = paramNames.map((name) => {
    const { min, max } = bounds[name];
    if (max <= min) return [min];
    const values: number[] = [];
    for (let i = 0; i < valuesPerParam; i++) {
      values.push(min + (i * (max - min)) / (valuesPerParam - 1));
    }
    return values;
  });

  let total = 1;
  for (const axis of axes) total *= axis.length;
  if (total > MAX_COMBINATIONS) {
    throw new Error(
      `AutoOptimizer: grid of ${total} combinations exceeds the ${MAX_COMBINATIONS} limit`
    );
  }

  let combos: Array<Record<string, number>> = [{}];
  for (let p = 0; p < paramNames.length; p++) {
    const name = paramNames[p];
    const next: Array<Record<string, number>> = [];
    for (const combo of combos) {
      for (const value of axes[p]) {
        next.push({ ...combo, [name]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/** Narrows each parameter to a band of one coarse step around the current best. */
function fineBoundsAround(
  bestParams: Record<string, number>,
  bounds: Record<string, NormalizedBound>
): Record<string, NormalizedBound> {
  const fine: Record<string, NormalizedBound> = {};
  for (const [name, { min, max }] of Object.entries(bounds)) {
    const coarseStep = (max - min) / (GRID_VALUES - 1);
    const best = bestParams[name];
    let lo = clamp(best - coarseStep / 2, min, max);
    let hi = clamp(best + coarseStep / 2, min, max);
    if (hi < lo) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }
    fine[name] = { min: lo, max: hi };
  }
  return fine;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function safeEvaluate(
  evaluateFn: OptimizeEvaluator,
  params: Record<string, number>
): Promise<number> {
  try {
    const score = await evaluateFn(params);
    return Number.isFinite(score) ? score : -Infinity;
  } catch {
    return -Infinity;
  }
}
