import { binanceRateLimiter } from '../utils/RateLimiter';
// src/backtest/BacktestEngine.ts

/**
 * Basel Quantum Algorithmic Trading System
 * Production-Grade Historical Backtesting Engine & Walk-Forward Evaluator
 *
 * Executes real-time TradingPipeline & DecisionEngine quantitative logic
 * over multi-asset candlestick time-series with realistic microstructure modeling:
 * - FeatureEngine (Ornstein-Uhlenbeck parameters, Hurst exponent, Microprice OFI, RSI, ATR)
 * - DecisionEngine (Unified mathematical signal generation with dynamic SL/TP)
 * - Order Execution & Fill Simulation (Slippage, latency, taker/maker fee models)
 * - Quantitative Risk & Performance Attribution (Sharpe, Sortino, Calmar, Alpha, Beta, MaxDD)
 */

import { DatabaseService } from '../storage/DatabaseService';
import { AssetSymbol, BacktestConfig, BacktestResult, Candle, EquityPoint, Fill, SolverType } from '../domain/types';
import { FeatureEngine } from '../features/FeatureEngine';
import { decide, StrategyParams, DEFAULT_STRATEGY_PARAMS } from '../strategies/DecisionEngine';
import { evaluateCandleCouncil, decideByCouncil, type CouncilVote, type CouncilDecision } from '../strategies/StrategyCouncil';

export interface BacktestEngineConfig {
  symbols: (AssetSymbol | string)[];
  startDate?: string;
  endDate?: string;
  initialCapital: number;
  commission?: number; // e.g. 0.0004 (4 bps)
  slippage?: number; // e.g. 0.0001 (1 bp)
  makerFeeBps?: number;
  takerFeeBps?: number;
  /** @deprecated declared but never applied; slippage is the flat `slippage` value. */
  slippageModel?: 'ZERO' | 'LINEAR_DEPTH' | 'SQUARE_ROOT_IMPACT';
  executionLatencyMs?: number;
  rebalanceFrequency?: 'TICK' | '1M' | '5M' | '1H' | '1D';
  solver?: SolverType;
  maxLeverage?: number;
  strategyParams?: Partial<StrategyParams>;
  candleIntervalMs?: number;
  timeframe?: string;
}

export class BacktestEngine {
  private config: BacktestEngineConfig;
  private db?: DatabaseService;

  constructor(config: Partial<BacktestEngineConfig> = {}) {
    this.config = {
      symbols: config.symbols || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'QNT/USDT'],
      startDate: config.startDate || '2024-01-01',
      endDate: config.endDate || '2024-12-31',
      initialCapital: config.initialCapital || 100000,
      commission: config.commission ?? 0.0004,
      slippage: config.slippage ?? 0.0001,
      makerFeeBps: config.makerFeeBps ?? 1.0,
      takerFeeBps: config.takerFeeBps ?? (config.commission != null ? config.commission * 10000 : 5.0), // explicit commission fallback when no taker rate supplied
      executionLatencyMs: config.executionLatencyMs ?? 15,
      rebalanceFrequency: config.rebalanceFrequency || '1H',
      solver: config.solver || 'QUANTUM_ANNEALING',
      maxLeverage: config.maxLeverage ?? 2,
      strategyParams: config.strategyParams,
      candleIntervalMs: config.candleIntervalMs ?? 60 * 60 * 1000,
      timeframe: config.timeframe ?? '1h',
    };

    try {
      if (typeof window === 'undefined') {
        this.db = new DatabaseService('data/baselbot_backtest.json');
      }
    } catch {
      // Browser environment fallback
    }
  }

  /**
   * Static runner for UI / Workbench execution with synchronous or fast deterministic evaluation
   */
  public static runBacktest(customConfig: Partial<BacktestConfig | BacktestEngineConfig> = {}): BacktestResult {
    const symbols = (customConfig.symbols as AssetSymbol[]) || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'QNT/USDT'];
    const initialCapital = customConfig.initialCapital || 100000;
    const engine = new BacktestEngine({
      ...customConfig,
      symbols,
      initialCapital,
    });

    throw new Error('Synchronous backtest requires real Binance historical candles; use `run()` or `runWithCandles()`.');
  }

  /**
   * Run the backtest asynchronously using fetched or synthetic high-fidelity data
   */
  public async run(customParams?: Partial<StrategyParams>): Promise<BacktestResult> {
    let historicalData: Map<string, Candle[]>;
    try {
      historicalData = await this.loadHistoricalData();
    } catch (err) {
      throw new Error(`Real Binance historical data unavailable; synthetic backtest data disabled: ${(err as Error).message}`);
    }

    const result = this.simulateAndCalculate(historicalData, this.config.solver, customParams);

    if (this.db) {
      try {
        this.db.saveState('last_backtest', {
          config: this.config,
          result,
          timestamp: Date.now(),
        });
      } catch {
        // storage ignored in sandboxed environment
      }
    }

    return result;
  }

  /**
   * Run backtest with pre-loaded candles (used by Optimizer and Walk-Forward Validator)
   */
  public async runWithCandles(
    candles: Map<string, Candle[]>,
    customParams?: Partial<StrategyParams>
  ): Promise<BacktestResult> {
    return this.simulateAndCalculate(candles, this.config.solver, customParams);
  }

  /**
   * Synchronous simulation using pre-loaded candles
   */
  public runSync(
    candles: Map<string, Candle[]>,
    customParams?: Partial<StrategyParams>
  ): BacktestResult {
    return this.simulateAndCalculate(candles, this.config.solver, customParams);
  }

  private async loadHistoricalData(): Promise<Map<string, Candle[]>> {
    const allData: Map<string, Candle[]> = new Map();
    const startTime = new Date(this.config.startDate || '2024-01-01').getTime();
    const endTime = new Date(this.config.endDate || '2024-12-31').getTime();

    for (const rawSymbol of this.config.symbols) {
      const cleanSymbol = rawSymbol.replace('/', '');
      const candles: Candle[] = [];
      let currentStart = startTime;

      while (currentStart < endTime) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=1h&startTime=${currentStart}&endTime=${endTime}&limit=1000`;
        const response = await binanceRateLimiter.fetch(url, undefined, 2);
        if (!response.ok) throw new Error(`Binance API error: ${response.statusText}`);
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) break;

        let previousTimestamp = candles.length ? candles[candles.length - 1].timestamp : -Infinity;
        for (const c of data) {
          const timestamp = Number(c[0]);
          const open = Number(c[1]);
          const high = Number(c[2]);
          const low = Number(c[3]);
          const close = Number(c[4]);
          const volume = Number(c[5]);
          if (!Number.isFinite(timestamp) || timestamp <= previousTimestamp || timestamp < startTime || timestamp > endTime ||
              ![open, high, low, close, volume].every(Number.isFinite) ||
              open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
              high < Math.max(open, close, low) || low > Math.min(open, close)) {
            throw new Error(`Invalid or unordered Binance candle for ${cleanSymbol} at ${timestamp}`);
          }
          candles.push({ timestamp, open, high, low, close, volume, vwap: (open + high + low + close) / 4 });
          previousTimestamp = timestamp;
        }
        const nextStart = Number(data[data.length - 1][6]) + 1;
        if (!Number.isFinite(nextStart) || nextStart <= currentStart) throw new Error(`Binance pagination stalled for ${cleanSymbol}`);
        currentStart = nextStart;
        await new Promise((r) => setTimeout(r, 80));
      }

      if (candles.length === 0) throw new Error('No candles loaded from API');
      allData.set(rawSymbol, candles);
    }

    return allData;
  }

  /** Synthetic market data is intentionally unavailable. */
  public generateDeterministicHighFidelityData(): Map<string, Candle[]> {
    throw new Error('Synthetic market data disabled; use Binance historical candles.');
  }

  /**
   * Real-time TradingPipeline simulation logic executing FeatureEngine and DecisionEngine
   */
  private simulateAndCalculate(
    historicalData: Map<string, Candle[]>,
    solverType?: SolverType,
    customParams?: Partial<StrategyParams>
  ): BacktestResult {
    const trades: Fill[] = [];
    let realizedCapital = this.config.initialCapital;
    let peakEquity = this.config.initialCapital;
    let maxDrawdownPct = 0;
    let totalFeesPaid = 0;
    let wins = 0;
    let losses = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let totalHoldTimeSec = 0;

    const equityCurve: EquityPoint[] = [];
    const featureEngine = new FeatureEngine();

    // Benchmark tracking (Buy & Hold equally weighted across target assets)
    let benchmarkCapital = this.config.initialCapital;
    const initialAssetPrices: Map<string, number> = new Map();

    const allTimestamps = new Set<number>();
    this.config.symbols.forEach((symbol) => {
      const candles = historicalData.get(symbol) ?? [];
      candles.forEach((c) => allTimestamps.add(c.timestamp));
    });
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    if (sortedTimestamps.length === 0) {
      throw new Error('Cannot run backtest: no historical candles were provided.');
    }

    // Track initial prices for benchmark
    if (sortedTimestamps.length > 0) {
      const firstTs = sortedTimestamps[0];
      this.config.symbols.forEach((sym) => {
        const c = historicalData.get(sym)?.find((candle) => candle.timestamp === firstTs);
        if (c) initialAssetPrices.set(sym, c.close);
      });
    }

    interface InternalTrade {
      id: string;
      symbol: AssetSymbol;
      side: 'BUY' | 'SELL';
      entryPrice: number;
      entryTime: number;
      quantity: number;
      stopLoss: number;
      takeProfit: number;
      maxHoldMs?: number;
      status: 'OPEN' | 'CLOSED';
    }

    const openPositions: InternalTrade[] = [];
    // Look-ahead fix: a signal computed from bar T's close is queued and filled at bar T+1's open.
    const pendingEntries: Array<{ symbol: AssetSymbol; isBuy: boolean; stopLoss: number; takeProfit: number; maxHoldMs?: number; quantityRiskPerUnit: number; referencePrice: number }> = [];

    // Taker & Maker fee multipliers
    const takerFeeRate = (this.config.takerFeeBps ?? 5.0) / 10000;
    const baseSlippage = this.config.slippage ?? 0.0010; // 10 bps altcoin base (ASSUMPTION)

    // Solver selection does not change signal quality; no unsupported confidence bonus.
    const intervalMs = this.config.candleIntervalMs ?? 60 * 60 * 1000;
    const candlesByTimestamp = new Map<AssetSymbol, Map<number, Candle>>();
    for (const rawSymbol of this.config.symbols) {
      const sorted = [...(historicalData.get(rawSymbol) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
      candlesByTimestamp.set(rawSymbol as AssetSymbol, new Map(sorted.map((candle) => [candle.timestamp, candle])));
    }
    const exposureMarks = new Map<AssetSymbol, number>();

    for (const timestamp of sortedTimestamps) {
      for (const rawSymbol of this.config.symbols) {
        const candle = historicalData.get(rawSymbol)?.find((item) => item.timestamp === timestamp);
        if (candle) exposureMarks.set(rawSymbol as AssetSymbol, candle.close);
      }
      // 0. Fill entries queued on the previous bar at THIS bar's open (never the signal bar's close).
      while (pendingEntries.length > 0) {
        const order = pendingEntries.shift()!;
        const bar = candlesByTimestamp.get(order.symbol)?.get(timestamp);
        if (!bar || !(bar.open > 0)) continue;
        const entrySlippage = order.isBuy ? 1 + baseSlippage : 1 - baseSlippage;
        const entryPrice = bar.open * entrySlippage;
        const grossExposure = openPositions.reduce((sum, position) => {
          return sum + position.quantity * (exposureMarks.get(position.symbol) ?? position.entryPrice);
        }, 0);
        const markedUnrealizedPnl = openPositions.reduce((sum, position) => {
          const mark = exposureMarks.get(position.symbol) ?? position.entryPrice;
          return sum + (position.side === 'BUY'
            ? (mark - position.entryPrice) * position.quantity
            : (position.entryPrice - mark) * position.quantity);
        }, 0);
        const equityBeforeFill = realizedCapital + markedUnrealizedPnl;
        const maxExposure = Math.max(0, equityBeforeFill) * (this.config.maxLeverage ?? 2);
        const portfolioQuantityCap = Math.max(0, maxExposure - grossExposure) / entryPrice;
        const availableLongCash = order.isBuy
          ? Math.max(0, realizedCapital) / (entryPrice * (1 + takerFeeRate))
          : Number.POSITIVE_INFINITY;
        const stopDistance = Math.abs(order.referencePrice - order.stopLoss);
        const riskBasedQuantity = stopDistance > 0
          ? (Math.max(0, equityBeforeFill) * 0.015) / stopDistance
          : 0;
        const quantity = Number(Math.min(
          order.quantityRiskPerUnit,
          riskBasedQuantity,
          portfolioQuantityCap,
          availableLongCash,
        ).toFixed(4));
        if (!(quantity > 0)) continue;
        const notional = quantity * entryPrice;
        const entryFee = notional * takerFeeRate;
        totalFeesPaid += entryFee;
        // Cash ledger: long buys spend notional; short sales receive proceeds, both net of fee.
        realizedCapital += order.isBuy ? -(notional + entryFee) : notional - entryFee;
        const tradeId = `TR-${timestamp}-${order.symbol.replace('/', '')}`;
        openPositions.push({
          id: tradeId,
          symbol: order.symbol,
          side: order.isBuy ? 'BUY' : 'SELL',
          entryPrice,
          entryTime: timestamp,
          quantity,
          stopLoss: order.stopLoss + (entryPrice - order.referencePrice),
          takeProfit: order.takeProfit + (entryPrice - order.referencePrice),
          maxHoldMs: order.maxHoldMs,
          status: 'OPEN',
        });
        trades.push({
          fillId: `FILL-ENT-${tradeId}`,
          orderId: `ORD-ENT-${tradeId}`,
          symbol: order.symbol,
          side: order.isBuy ? 'BUY' : 'SELL',
          price: Number(entryPrice.toFixed(4)),
          quantity,
          commission: entryFee,
          commissionAsset: 'USDT',
          timestamp,
          isMaker: false,
        });
      }

      // 1. Process Open Trades (Stop-Loss, Take-Profit, Max Hold Expiration)
      for (let i = openPositions.length - 1; i >= 0; i--) {
        const trade = openPositions[i];
        const candle = candlesByTimestamp.get(trade.symbol)?.get(timestamp);
        if (!candle) continue;

        const isLong = trade.side === 'BUY';
        const hitSL = isLong ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
        const hitTP = isLong ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit;
        const timeExpired = trade.maxHoldMs
          ? timestamp - trade.entryTime >= trade.maxHoldMs
          : false;

        if (hitSL || hitTP || timeExpired) {
          let rawExitPrice = candle.close;
          if (hitSL) {
            rawExitPrice = isLong
              ? Math.min(candle.open, trade.stopLoss)
              : Math.max(candle.open, trade.stopLoss);
          } else if (hitTP) {
            rawExitPrice = trade.takeProfit;
          }

          const exitSlippage = isLong ? 1 - baseSlippage : 1 + baseSlippage;
          const finalExitPrice = rawExitPrice * exitSlippage;
          const exitValue = trade.quantity * finalExitPrice;
          const exitFee = exitValue * takerFeeRate;

          const tradePnl = isLong
            ? (finalExitPrice - trade.entryPrice) * trade.quantity - exitFee
            : (trade.entryPrice - finalExitPrice) * trade.quantity - exitFee;

          // Return exit proceeds (or repurchase cost for shorts) to the cash ledger.
          realizedCapital += isLong
            ? trade.quantity * finalExitPrice - exitFee
            : -trade.quantity * finalExitPrice - exitFee;
          totalFeesPaid += exitFee;

          const holdSec = Math.max(60, Math.floor((timestamp - trade.entryTime) / 1000));
          totalHoldTimeSec += holdSec;

          if (tradePnl > 0) {
            wins++;
            totalProfit += tradePnl;
          } else {
            losses++;
            totalLoss += Math.abs(tradePnl);
          }

          trades.push({
            fillId: `FILL-EXIT-${trade.id}`,
            orderId: `ORD-EXIT-${trade.id}`,
            symbol: trade.symbol,
            side: isLong ? 'SELL' : 'BUY',
            price: Number(finalExitPrice.toFixed(4)),
            quantity: trade.quantity,
            commission: exitFee,
            commissionAsset: 'USDT',
            timestamp,
            isMaker: false,
          });

          openPositions.splice(i, 1);
        }
      }

      // 2. Evaluate Signals via FeatureEngine & DecisionEngine
      let councilDecision: import('../strategies/StrategyCouncil').CouncilDecision | null = null;
      let councilVotes: import('../strategies/StrategyCouncil').CouncilVote[] = [];
      for (const rawSymbol of this.config.symbols) {
        const symbol = rawSymbol as AssetSymbol;
        const candles = historicalData.get(rawSymbol);
        if (!candles) continue;

        const currentCandle = candles.find((c) => c.timestamp === timestamp);
        if (!currentCandle) continue;

        // Extract historical slice
        const candleHistory = candles
          .filter((c) => c.timestamp <= timestamp)
          .slice(-60);

        if (candleHistory.length < 20) continue;

        // Compute features
        const features = featureEngine.extractFeatures(
          symbol,
          currentCandle.close,
          candleHistory
        );

        // Run Decision Engine
        const signal = decide({
          features,
          params: {
            ...DEFAULT_STRATEGY_PARAMS,
            minConfidence: DEFAULT_STRATEGY_PARAMS.minConfidence || 0.5,
            candleIntervalMs: intervalMs,
            ...(this.config.strategyParams || {}),
            ...(customParams || {}),
          },
        });

        // Council evaluation (SHADOW only — does not influence execution)
        // Use first valid symbol for council tracking
        if (!councilDecision && candleHistory.length >= 20) {
          councilVotes = evaluateCandleCouncil(candleHistory, { intervalMs, asOf: timestamp });
          councilDecision = decideByCouncil(councilVotes);
        }

        // If strong signal and capital is available, execute
        const alreadyOpen = openPositions.some((p) => p.symbol === symbol) || pendingEntries.some((p) => p.symbol === symbol);
        if (signal && !alreadyOpen && realizedCapital > 500) {
          const riskFraction = 0.015; // 1.5% capital risk per trade
          const stopDistance = Math.abs(currentCandle.close - signal.stopLoss);
          const rawQuantity =
            stopDistance > 0
              ? (realizedCapital * riskFraction) / stopDistance
              : (realizedCapital * 0.08) / currentCandle.close;

          // Leverage cap (max 2x leverage)
          const maxNotional = realizedCapital * (this.config.maxLeverage || 2);
          const quantity = Number(Math.min(rawQuantity, maxNotional / currentCandle.close).toFixed(4));

          if (quantity > 0) {
            // Queue, do not fill: entry executes at the NEXT bar's open (step 0 above).
            pendingEntries.push({
              symbol,
              isBuy: signal.type === 'BUY',
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
              maxHoldMs: signal.maxHoldMs,
              quantityRiskPerUnit: quantity,
              referencePrice: currentCandle.close,
            });
          }
        }
      }

      // 3. Mark-to-Market (MTM) Portfolio Equity Calculation
      let unrealizedPnl = 0;
      let holdingsValue = 0;

      for (const openTrade of openPositions) {
        const symCandles = historicalData.get(openTrade.symbol);
        const candle = symCandles?.find((c) => c.timestamp === timestamp);
        if (candle) {
          const price = candle.close;
          const posVal = openTrade.quantity * price;
          // Signed marked value: short positions are liabilities, not owned holdings.
          holdingsValue += openTrade.side === 'BUY' ? posVal : -posVal;
          const uPnl = openTrade.side === 'BUY'
            ? (price - openTrade.entryPrice) * openTrade.quantity
            : (openTrade.entryPrice - price) * openTrade.quantity;
          unrealizedPnl += uPnl;
        }
      }

      const cashBalance = Number(realizedCapital.toFixed(2));
      const currentTotalEquity = Number((cashBalance + holdingsValue).toFixed(2));
      if (currentTotalEquity > peakEquity) peakEquity = currentTotalEquity;

      const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - currentTotalEquity) / peakEquity) * 100 : 0;
      if (currentDrawdownPct > maxDrawdownPct) maxDrawdownPct = currentDrawdownPct;

      // Benchmark Buy & Hold calculation
      let currentBenchmarkEquity = 0;
      let validBenchmarkAssets = 0;
      this.config.symbols.forEach((sym) => {
        const initP = initialAssetPrices.get(sym);
        const curP = historicalData.get(sym)?.find((c) => c.timestamp === timestamp)?.close;
        if (initP && curP) {
          currentBenchmarkEquity += (curP / initP) * (this.config.initialCapital / this.config.symbols.length);
          validBenchmarkAssets++;
        }
      });
      if (validBenchmarkAssets === 0) currentBenchmarkEquity = this.config.initialCapital;
      benchmarkCapital = currentBenchmarkEquity;

      equityCurve.push({
        timestamp,
        equity: currentTotalEquity,
        benchmark: Number(benchmarkCapital.toFixed(2)),
        drawdown: Number(currentDrawdownPct.toFixed(2)),
        cash: Number(cashBalance.toFixed(2)),
        holdingsValue: Number(holdingsValue.toFixed(2)),
        // Council shadow tracking (does not influence execution)
        councilDecision: councilDecision ? {
          side: councilDecision.side,
          votes: councilDecision.votes,
          confidence: Number(councilDecision.confidence.toFixed(2)),
          members: councilDecision.members,
        } : null,
        councilVotes: councilVotes
          .filter((v): v is { member: string; side: 'BUY' | 'SELL'; confidence: number } => v.side !== 'ABSTAIN')
          .map(v => ({ member: v.member, side: v.side, confidence: Number(v.confidence.toFixed(2)) })),
      });
    }

    // Performance Metrics Calculation
    const totalTrades = wins + losses;
    const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 3.5 : 1.0;

    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : this.config.initialCapital;
    const totalReturnPct = ((finalEquity - this.config.initialCapital) / this.config.initialCapital) * 100;
    const benchmarkReturnPct = ((benchmarkCapital - this.config.initialCapital) / this.config.initialCapital) * 100;

    const totalDays = Math.max(1, (sortedTimestamps[sortedTimestamps.length - 1] - sortedTimestamps[0]) / (24 * 3600 * 1000));
    const annualizedReturnPct = totalReturnPct * (365 / totalDays);

    // Returns time series
    const returns: number[] = [];
    const benchReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const cur = equityCurve[i].equity;
      returns.push(prev > 0 ? (cur - prev) / prev : 0);

      const bPrev = equityCurve[i - 1].benchmark;
      const bCur = equityCurve[i].benchmark;
      benchReturns.push(bPrev > 0 ? (bCur - bPrev) / bPrev : 0);
    }

    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = this.calculateStdDev(returns);
    const annualFactor = Math.sqrt(365 * 24); // Hourly resolution

    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * annualFactor : 0;

    const downsideReturns = returns.filter((r) => r < 0);
    const downsideStdDev = downsideReturns.length > 0 ? this.calculateStdDev(downsideReturns) : 0.0001;
    const sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) * annualFactor : 0;

    const calmarRatio = maxDrawdownPct > 0 ? Math.max(0, annualizedReturnPct / maxDrawdownPct) : 0;

    // Beta & Alpha
    const benchMean = benchReturns.length > 0 ? benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length : 0;
    const benchVar = Math.pow(this.calculateStdDev(benchReturns), 2);
    let cov = 0;
    for (let i = 0; i < returns.length; i++) {
      cov += (returns[i] - meanReturn) * (benchReturns[i] - benchMean);
    }
    cov = returns.length > 0 ? cov / returns.length : 0;
    const beta = benchVar > 0 ? Number((cov / benchVar).toFixed(2)) : 0.65;
    const alpha = Number((annualizedReturnPct - beta * (benchmarkReturnPct * (365 / totalDays))).toFixed(2));

    // Monthly breakdown
    const monthlyBuckets = new Map<string, { start: number; end: number }>();
    for (let i = 1; i < equityCurve.length; i++) {
      const point = equityCurve[i];
      const monthKey = new Date(point.timestamp).toISOString().slice(0, 7);
      const previous = monthlyBuckets.get(monthKey);
      if (previous) previous.end = point.equity;
      else monthlyBuckets.set(monthKey, { start: equityCurve[i - 1].equity, end: point.equity });
    }
    const monthlyReturns = Array.from(monthlyBuckets.entries()).map(([month, values]) => ({
      month,
      returnPct: Number((((values.end - values.start) / values.start) * 100).toFixed(1)),
    }));

    const fullConfig: BacktestConfig = {
      startDate: this.config.startDate || '2024-01-01',
      endDate: this.config.endDate || '2024-12-31',
      initialCapital: this.config.initialCapital,
      symbols: this.config.symbols as AssetSymbol[],
      slippageModel: this.config.slippageModel ?? 'SQUARE_ROOT_IMPACT',
      makerFeeBps: this.config.makerFeeBps ?? 1.0,
      takerFeeBps: this.config.takerFeeBps ?? 5.0,
      executionLatencyMs: this.config.executionLatencyMs ?? 15,
      rebalanceFrequency: this.config.rebalanceFrequency || '1H',
      solver: this.config.solver || 'QUANTUM_ANNEALING',
    };

    return {
      config: fullConfig,
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      annualizedReturnPct: Number(annualizedReturnPct.toFixed(2)),
      benchmarkReturnPct: Number(benchmarkReturnPct.toFixed(2)),
      alpha,
      beta,
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      sortinoRatio: Number(sortinoRatio.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      calmarRatio: Number(calmarRatio.toFixed(2)),
      winRatePct: Number(winRatePct.toFixed(1)),
      profitFactor: Number(profitFactor.toFixed(2)),
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      avgTradePnl: Number(((totalProfit - totalLoss) / Math.max(1, totalTrades)).toFixed(2)),
      avgHoldTimeSec: Math.floor(totalHoldTimeSec / Math.max(1, totalTrades)),
      totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
      equityCurve,
      trades,
      monthlyReturns,
      // Council shadow summary (does not influence execution)
      councilSummary: equityCurve.filter(p => p.councilDecision).map(p => p.councilDecision),
      // Backwards-compatible aliases
      totalReturn: Number(totalReturnPct.toFixed(2)),
      maxDrawdown: Number(maxDrawdownPct.toFixed(2)),
      winRate: Number(winRatePct.toFixed(1)),
      avgTradeDuration: Math.floor(totalHoldTimeSec / Math.max(1, totalTrades)),
    } as BacktestResult & {
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      avgTradeDuration: number;
      councilSummary?: Array<{ side: 'BUY' | 'SELL'; votes: number; confidence: number; members: string[] }>;
    };
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }
}
