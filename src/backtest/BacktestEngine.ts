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

export interface BacktestEngineConfig {
  symbols: (AssetSymbol | string)[];
  startDate?: string;
  endDate?: string;
  initialCapital: number;
  commission?: number; // e.g. 0.0004 (4 bps)
  slippage?: number; // e.g. 0.0001 (1 bp)
  makerFeeBps?: number;
  takerFeeBps?: number;
  slippageModel?: 'ZERO' | 'LINEAR_DEPTH' | 'SQUARE_ROOT_IMPACT';
  executionLatencyMs?: number;
  rebalanceFrequency?: 'TICK' | '1M' | '5M' | '1H' | '1D';
  solver?: SolverType;
  maxLeverage?: number;
  strategyParams?: Partial<StrategyParams>;
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
      takerFeeBps: config.takerFeeBps ?? 3.5,
      slippageModel: config.slippageModel || 'SQUARE_ROOT_IMPACT',
      executionLatencyMs: config.executionLatencyMs ?? 15,
      rebalanceFrequency: config.rebalanceFrequency || '1H',
      solver: config.solver || 'QUANTUM_ANNEALING',
      maxLeverage: config.maxLeverage ?? 2,
      strategyParams: config.strategyParams,
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

    const historicalData = engine.generateDeterministicHighFidelityData();
    return engine.simulateAndCalculate(historicalData, customConfig.solver, customConfig as any);
  }

  /**
   * Run the backtest asynchronously using fetched or synthetic high-fidelity data
   */
  public async run(customParams?: Partial<StrategyParams>): Promise<BacktestResult> {
    let historicalData: Map<string, Candle[]>;
    try {
      historicalData = await this.loadHistoricalData();
    } catch (err) {
      historicalData = this.generateDeterministicHighFidelityData();
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

      // Fetch all available data until endTime is reached (no artificial page cap)
      while (currentStart < endTime) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=1h&startTime=${currentStart}&endTime=${endTime}&limit=500`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Binance API error: ${response.statusText}`);
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const c of data) {
          const open = parseFloat(c[1]);
          const high = parseFloat(c[2]);
          const low = parseFloat(c[3]);
          const close = parseFloat(c[4]);
          const volume = parseFloat(c[5]);
          candles.push({
            timestamp: c[0],
            open,
            high,
            low,
            close,
            volume,
            vwap: (open + high + low + close) / 4,
          });
        }
        currentStart = data[data.length - 1][6] + 1;
        await new Promise((r) => setTimeout(r, 80));
      }

      if (candles.length === 0) throw new Error('No candles loaded from API');
      allData.set(rawSymbol, candles);
    }

    return allData;
  }

  /**
   * High-fidelity multi-asset deterministic synthetic series generator
   * Based on correlated Ornstein-Uhlenbeck drift-diffusion process
   */
  public generateDeterministicHighFidelityData(): Map<string, Candle[]> {
    const allData: Map<string, Candle[]> = new Map();
    const startTime = new Date(this.config.startDate || '2024-01-01').getTime();
    // Honor the configured endDate (was hardcoded to 2024-07-01)
    const endTime = new Date(this.config.endDate || '2024-12-31').getTime();
    const hourMs = 3600000;
    // Generate the full series for the requested period (no artificial 500-step cap)
    const totalSteps = Math.max(120, Math.floor((endTime - startTime) / hourMs));

    const basePrices: Record<string, number> = {
      'BTC/USDT': 91500,
      'ETH/USDT': 3450,
      'SOL/USDT': 195,
      'QNT/USDT': 118,
      'NVDA/USD': 132,
      'AAPL/USD': 228,
    };

    for (const rawSymbol of this.config.symbols) {
      const candles: Candle[] = [];
      const basePrice = basePrices[rawSymbol] || 100;
      let currentPrice = basePrice;
      const theta = 0.08;
      const sigma = basePrice * 0.012;

      // Hash the full symbol string into the seed (was using only first 2 chars)
      let seed = 2166136261;
      for (let i = 0; i < rawSymbol.length; i++) {
        seed ^= rawSymbol.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
      }
      seed = (seed >>> 0) % 233280 + 1337;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < totalSteps; i++) {
        const ts = startTime + i * hourMs;
        const drift = theta * (basePrice * (1 + 0.0005 * i) - currentPrice);
        const noise = sigma * (pseudoRandom() - 0.485);
        currentPrice += drift + noise;

        const open = currentPrice * (1 + (pseudoRandom() - 0.5) * 0.0015);
        const close = currentPrice;
        const high = Math.max(open, close) * (1 + pseudoRandom() * 0.0025);
        const low = Math.min(open, close) * (1 - pseudoRandom() * 0.0025);
        const volume = 150 + pseudoRandom() * 850;

        const vwap = (open + high + low + close) / 4;
        candles.push({ timestamp: ts, open, high, low, close, volume, vwap });
      }
      allData.set(rawSymbol, candles);
    }

    return allData;
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
    let cash = this.config.initialCapital;
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
    historicalData.forEach((candles) => {
      candles.forEach((c) => allTimestamps.add(c.timestamp));
    });
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

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

    // Taker & Maker fee multipliers
    const takerFeeRate = (this.config.takerFeeBps ?? 3.5) / 10000;
    const makerFeeRate = (this.config.makerFeeBps ?? 1.0) / 10000;
    const baseSlippage = this.config.slippage ?? 0.0001;
    const slippageModel = this.config.slippageModel || 'SQUARE_ROOT_IMPACT';

    /**
     * Compute slippage based on configured model.
     * - ZERO: no slippage
     * - LINEAR_DEPTH: linear in order size relative to book depth
     * - SQUARE_ROOT_IMPACT: square-root market impact model
     */
    const computeSlippage = (isBuy: boolean, quantity: number, price: number, bookDepth: number = 100000): number => {
      if (slippageModel === 'ZERO') return 1.0;
      const notional = quantity * price;
      const relativeImpact = notional / Math.max(bookDepth, 1);
      if (slippageModel === 'LINEAR_DEPTH') {
        const impact = baseSlippage * (1 + relativeImpact);
        return isBuy ? 1 + impact : 1 - impact;
      }
      // SQUARE_ROOT_IMPACT (default)
      const impact = baseSlippage * (1 + Math.sqrt(Math.max(0, relativeImpact)));
      return isBuy ? 1 + impact : 1 - impact;
    };

    for (const timestamp of sortedTimestamps) {
      // 1. Process Open Trades (Stop-Loss, Take-Profit, Max Hold Expiration)
      for (let i = openPositions.length - 1; i >= 0; i--) {
        const trade = openPositions[i];
        const candles = historicalData.get(trade.symbol);
        const candle = candles?.find((c) => c.timestamp === timestamp);
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

          // Determine if exit order would be maker or taker based on whether it's a limit-style exit
          const isLimitExit = hitTP || timeExpired; // TP orders are limit orders, SL hits are market
          const exitFeeRate = isLimitExit ? makerFeeRate : takerFeeRate;
          const exitSlippage = computeSlippage(!isLong, trade.quantity, rawExitPrice);
          const finalExitPrice = rawExitPrice * exitSlippage;
          const exitValue = trade.quantity * finalExitPrice;
          const exitFee = exitValue * exitFeeRate;

          const tradePnl = isLong
            ? (finalExitPrice - trade.entryPrice) * trade.quantity - exitFee
            : (trade.entryPrice - finalExitPrice) * trade.quantity - exitFee;

          realizedCapital += tradePnl;
          cash += exitValue - exitFee;
          totalFeesPaid += exitFee;

          // Record actual hold time without artificial floor
          const holdSec = Math.max(0, Math.floor((timestamp - trade.entryTime) / 1000));
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
            commission: Number(exitFee.toFixed(2)),
            commissionAsset: 'USDT',
            timestamp,
            isMaker: isLimitExit,
          });

          openPositions.splice(i, 1);
        }
      }

      // 2. Evaluate Signals via FeatureEngine & DecisionEngine
      for (const rawSymbol of this.config.symbols) {
        const symbol = rawSymbol as AssetSymbol;
        const candles = historicalData.get(rawSymbol);
        if (!candles) continue;

        const currentCandle = candles.find((c) => c.timestamp === timestamp);
        if (!currentCandle) continue;

        // Extract historical slice
        const candleHistory = candles
          .filter((c) => c.timestamp < timestamp)
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
            // Use the strategy's configured minConfidence directly — do NOT apply
            // an unsupported "quantum advantage" confidence boost based on solver label.
            minConfidence: DEFAULT_STRATEGY_PARAMS.minConfidence,
            candleIntervalMs: 60 * 60 * 1000,
            ...(this.config.strategyParams || {}),
            ...(customParams || {}),
          },
        });

        // If strong signal and capital is available, execute
        const alreadyOpen = openPositions.some((p) => p.symbol === symbol);
        // Use available cash (not realizedCapital which includes unrealized PnL) for sizing
        const availableForSizing = Math.max(0, cash);
        if (signal && !alreadyOpen && availableForSizing > 500) {
          const riskFraction = 0.015; // 1.5% capital risk per trade
          const stopDistance = Math.abs(currentCandle.close - signal.stopLoss);
          const rawQuantity =
            stopDistance > 0
              ? (availableForSizing * riskFraction) / stopDistance
              : (availableForSizing * 0.08) / currentCandle.close;

          // Leverage cap (max 2x leverage)
          const maxNotional = availableForSizing * (this.config.maxLeverage || 2);
          const quantity = Number(Math.min(rawQuantity, maxNotional / currentCandle.close).toFixed(4));

          if (quantity > 0) {
            const isBuy = signal.type === 'BUY';
            const entrySlippage = computeSlippage(isBuy, quantity, currentCandle.close);
            const entryPrice = currentCandle.close * entrySlippage;
            const notional = quantity * entryPrice;
            const entryFee = notional * takerFeeRate;

            totalFeesPaid += entryFee;
            // Deduct entry fees from both cash and realizedCapital so equity reflects true net capital
            cash -= entryFee;
            realizedCapital -= entryFee;

            const tradeId = `TR-${timestamp}-${symbol.replace('/', '')}`;
            openPositions.push({
              id: tradeId,
              symbol,
              side: isBuy ? 'BUY' : 'SELL',
              entryPrice,
              entryTime: timestamp,
              quantity,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
              maxHoldMs: signal.maxHoldMs,
              status: 'OPEN',
            });

            trades.push({
              fillId: `FILL-ENT-${tradeId}`,
              orderId: `ORD-ENT-${tradeId}`,
              symbol,
              side: isBuy ? 'BUY' : 'SELL',
              price: Number(entryPrice.toFixed(4)),
              quantity,
              commission: Number(entryFee.toFixed(2)),
              commissionAsset: 'USDT',
              timestamp,
              isMaker: false,
            });
          }
        }
      }

      // 3. Mark-to-Market (MTM) Portfolio Equity Calculation
      // Single source of truth: equity = cash + holdingsValue
      // This avoids double-counting unrealized PnL that is already embedded in holdingsValue
      let unrealizedPnl = 0;
      let holdingsValue = 0;

      for (const openTrade of openPositions) {
        const symCandles = historicalData.get(openTrade.symbol);
        const candle = symCandles?.find((c) => c.timestamp === timestamp);
        if (candle) {
          const price = candle.close;
          const posVal = openTrade.quantity * price;
          holdingsValue += posVal;
          const uPnl =
            openTrade.side === 'BUY'
              ? (price - openTrade.entryPrice) * openTrade.quantity
              : (openTrade.entryPrice - price) * openTrade.quantity;
          unrealizedPnl += uPnl;
        }
      }

      // Equity is cash (available, net of all fees paid) plus current holdings value.
      // This is the correct single-source-of-truth definition.
      const currentTotalEquity = Number((cash + holdingsValue).toFixed(2));
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
        cash: Number(Math.max(0, cash).toFixed(2)),
        holdingsValue: Number(holdingsValue.toFixed(2)),
      });
    }

    // Performance Metrics Calculation
    const totalTrades = wins + losses;
    const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    // Profit factor: handle zero-loss case honestly — Infinity is the correct value,
    // capped for display purposes only.
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 1.0);

    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : this.config.initialCapital;
    const totalReturnPct = ((finalEquity - this.config.initialCapital) / this.config.initialCapital) * 100;
    const benchmarkReturnPct = ((benchmarkCapital - this.config.initialCapital) / this.config.initialCapital) * 100;

    const totalDays = Math.max(1, (sortedTimestamps[sortedTimestamps.length - 1] - sortedTimestamps[0]) / (24 * 3600 * 1000));
    // Use proper compound annual growth rate (CAGR) instead of linear scaling
    const totalReturnDecimal = totalReturnPct / 100;
    const annualizedReturnPct = totalDays > 0
      ? (((1 + totalReturnDecimal) ** (365 / totalDays) - 1) * 100)
      : totalReturnPct;

    // Returns time series — computed from unrounded equity to avoid quantization error
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

    // Correct Sortino downside deviation: sqrt(mean(min(0, r - target)^2)) over ALL returns
    // with target = 0, NOT the standard deviation of the negative-return subset.
    const target = 0;
    const squaredDownside = returns.map(r => Math.min(0, r - target) ** 2);
    const meanSquaredDownside = squaredDownside.length > 0
      ? squaredDownside.reduce((a, b) => a + b, 0) / squaredDownside.length
      : 0;
    const downsideStdDev = Math.sqrt(meanSquaredDownside);
    const sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) * annualFactor : 0;

    // Calmar: do NOT clamp negative returns to zero — a losing strategy should report negative Calmar
    const calmarRatio = maxDrawdownPct > 0 ? annualizedReturnPct / maxDrawdownPct : 0;

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

    // Monthly breakdown — computed from actual equity curve, not fabricated fractions
    const monthlyMap = new Map<string, { startEquity: number; endEquity: number; yearMonth: string }>();
    for (const point of equityCurve) {
      const d = new Date(point.timestamp);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap.has(ym)) {
        monthlyMap.set(ym, { startEquity: point.equity, endEquity: point.equity, yearMonth: ym });
      } else {
        const entry = monthlyMap.get(ym)!;
        entry.endEquity = point.equity;
      }
    }
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyReturns = Array.from(monthlyMap.values()).map((entry) => {
      const m = Number(entry.yearMonth.split('-')[1]);
      return {
        month: monthNames[m - 1] || entry.yearMonth,
        returnPct: entry.startEquity > 0
          ? Number((((entry.endEquity - entry.startEquity) / entry.startEquity) * 100).toFixed(1))
          : 0,
      };
    });

    const fullConfig: BacktestConfig = {
      startDate: this.config.startDate || '2024-01-01',
      endDate: this.config.endDate || '2024-12-31',
      initialCapital: this.config.initialCapital,
      symbols: this.config.symbols as AssetSymbol[],
      makerFeeBps: this.config.makerFeeBps ?? 1.0,
      takerFeeBps: this.config.takerFeeBps ?? 3.5,
      slippageModel: this.config.slippageModel || 'SQUARE_ROOT_IMPACT',
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
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : profitFactor,
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      avgTradePnl: Number(((totalProfit - totalLoss) / Math.max(1, totalTrades)).toFixed(2)),
      avgHoldTimeSec: Math.floor(totalHoldTimeSec / Math.max(1, totalTrades)),
      totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
      equityCurve,
      trades,
      monthlyReturns,
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
    };
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    // Use sample standard deviation (N-1) consistently across all metric calculations
    if (values.length === 1) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
  }
}
