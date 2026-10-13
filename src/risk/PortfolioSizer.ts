/**
 * Basel Quantum Algorithmic Trading System
 * Dynamic Portfolio Sizer, Tier Manager & Compounding Safety Engine
 */

import { AssetSymbol } from '../domain/types';
import { AssetScreener } from '../market-data/AssetScreener';
import { RiskEngine } from './RiskEngine';

// --- Named constants for portfolio sizing logic ---
/** Default fraction of capital risked per trade (1%). */
const DEFAULT_RISK_PCT = 0.01;
/** Maximum portfolio exposure as a multiple of equity (2x). */
const MAX_EXPOSURE_MULTIPLE = 2.0;
/** Default bid/ask spread percentage for risk calculations. */
const DEFAULT_SPREAD_PCT = 0.05;
/** Minimum allowed risk percentage after clamping. */
const MIN_RISK_PCT = 0.005;
/** Maximum allowed risk percentage after clamping. */
const MAX_RISK_PCT = 0.02;
/** Default maximum trade notional as a percentage of equity. */
const DEFAULT_MAX_TRADE_PERCENTAGE = 0.50;
/** Fraction of equity targeted for proportional margin allocation. */
const PROPORTIONAL_MARGIN_PCT = 0.25;
/** Minimum capital (USDT) for the MICRO portfolio tier. */
const MIN_TIER_CAPITAL_MICRO = 1000;
/** Minimum capital (USDT) for the SMALL portfolio tier. */
const MIN_TIER_CAPITAL_SMALL = 10_000;
/** Minimum capital (USDT) for the MEDIUM portfolio tier. */
const MIN_TIER_CAPITAL_MEDIUM = 50_000;
/** Default balance (USDT) when no equity data is available. */
const FALLBACK_BALANCE = 100;
/** Minimum stop-distance as a percentage of entry price (fallback). */
const FALLBACK_STOP_DISTANCE_PCT = 0.015;

export type PortfolioTier = 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE';

export interface TierConfig {
  tier: PortfolioTier;
  maxConcurrentPositions: number;
  minLeverage: number;          // 5x (Binance minimum standard)
  maxLeverage: number;          // 5x - 15x depending on Tier
  minTradeValue: number;       // بالـ USDT
  maxTradePercentage: number;  // نسبة من المحفظة
  maxQualifiedAssets: number;   // عدد العملات المؤهلة كحد أقصى
  allowedSymbols: AssetSymbol[];
  quboEnabled: boolean;        // هل نستخدم QUBO؟
  minZScore: number;           // عتبة أكثر صرامة للمحافظ الصغيرة
  maxDrawdownPercent: number;
}

export interface CompoundingConfig {
  enabled: boolean;
  reinvestPercentage: number;     // نسبة إعادة الاستثمار (0.80 = 80%)
  maxDailyLossPercent: number;    // حد الخسارة اليومية (0.10 = 10%)
  maxConsecutiveLosses: number;   // حد الخسائر المتتالية (3)
  profitLockPercentage: number;   // نسبة قفل الأرباح (0.20 = 20%)
  autoUpgradeEnabled: boolean;    // ترقية تلقائية للحساب
}

export interface TierStats {
  tier: PortfolioTier;
  dailyPnL: number;              // الربح/الخسارة اليومي
  consecutiveLosses: number;     // عدد الخسائر المتتالية
  totalTradesToday: number;      // عدد صفقات اليوم
  lastTradeTime: number;         // آخر صفقة
  profitsLocked: number;         // الأرباح المقفلة
  startingBalance: number;       // الرصيد عند بداية اليوم
}

const TIER_BOUNDS: [number, PortfolioTier][] = [
  [MIN_TIER_CAPITAL_MICRO, 'MICRO'],
  [MIN_TIER_CAPITAL_SMALL, 'SMALL'],
  [MIN_TIER_CAPITAL_MEDIUM, 'MEDIUM'],
  [Infinity, 'LARGE'],
];

export class PortfolioSizer {
  private currentTier: PortfolioTier = 'MEDIUM';
  private currentBalance: number = 0;
  private compoundingConfig: CompoundingConfig;
  private tierStats: TierStats;
  private assetScreener?: AssetScreener;
  private allowedSymbols: AssetSymbol[] = [];
  private riskEngine?: RiskEngine;
  private targetWeights: Record<string, number> = {};

  private tierConfigs: Record<PortfolioTier, TierConfig> = {
    MICRO: {
      tier: 'MICRO',
      maxConcurrentPositions: 4, // حتى 4 صفقات متوازنة
      minLeverage: 10,           // رافعة 10x
      maxLeverage: 20,           // رافعة 20x
      minTradeValue: 20.0,       // قيمة اسمية تتناسب مع الحد الأدنى للعقود (20 USDT)
      maxTradePercentage: 0.85,
      maxQualifiedAssets: 15,
      allowedSymbols: ['SOL/USDT', 'BTC/USDT', 'ETH/USDT', 'NEAR/USDT', 'SUI/USDT', 'DOGE/USDT', 'TAO/USDT', '1000PEPE/USDT', 'FET/USDT', 'AVAX/USDT', 'RENDER/USDT', 'WIF/USDT'],
      quboEnabled: false,
      minZScore: -2.0,
      maxDrawdownPercent: 0.20,
    },
    SMALL: {
      tier: 'SMALL',
      maxConcurrentPositions: 5,
      minLeverage: 10,
      maxLeverage: 20,
      minTradeValue: 20.0,
      maxTradePercentage: 0.40,
      maxQualifiedAssets: 25,
      allowedSymbols: ['SOL/USDT', 'ETH/USDT', 'BTC/USDT', 'NEAR/USDT', 'SUI/USDT', 'DOGE/USDT', 'TAO/USDT', '1000PEPE/USDT', 'FET/USDT', 'AVAX/USDT', 'INJ/USDT', 'APT/USDT', 'TIA/USDT', 'RENDER/USDT', 'WIF/USDT', 'BNB/USDT', 'XRP/USDT', 'LINK/USDT', 'ADA/USDT'],
      quboEnabled: false,
      minZScore: -2.0,
      maxDrawdownPercent: 0.20,
    },
    MEDIUM: {
      tier: 'MEDIUM',
      maxConcurrentPositions: 6,
      minLeverage: 10,
      maxLeverage: 20,
      minTradeValue: 20,
      maxTradePercentage: 0.25,
      maxQualifiedAssets: 40,
      allowedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'NEAR/USDT', 'SUI/USDT', 'DOGE/USDT', 'TAO/USDT', '1000PEPE/USDT', 'FET/USDT', 'AVAX/USDT', 'INJ/USDT', 'APT/USDT', 'TIA/USDT', 'RENDER/USDT', 'WIF/USDT', 'BNB/USDT', 'XRP/USDT', 'LINK/USDT'],
      quboEnabled: true,
      minZScore: -1.6,
      maxDrawdownPercent: 0.25,
    },
    LARGE: {
      tier: 'LARGE',
      maxConcurrentPositions: 8,
      minLeverage: 10,
      maxLeverage: 20,
      minTradeValue: 50,
      maxTradePercentage: 0.15,
      maxQualifiedAssets: 100,
      allowedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'NEAR/USDT', 'SUI/USDT', 'DOGE/USDT', 'TAO/USDT', '1000PEPE/USDT', 'FET/USDT', 'AVAX/USDT', 'INJ/USDT', 'APT/USDT', 'TIA/USDT', 'RENDER/USDT', 'WIF/USDT', 'BNB/USDT', 'XRP/USDT', 'LINK/USDT'],
      quboEnabled: true,
      minZScore: -1.6,
      maxDrawdownPercent: 0.30,
    },
  };

  constructor(assetScreener?: AssetScreener) {
    this.assetScreener = assetScreener;
    this.compoundingConfig = {
      enabled: true,
      reinvestPercentage: 0.80,    // أعد استثمار 80% من الأرباح
      maxDailyLossPercent: 0.10,   // حد أقصى 10% خسارة يومية
      maxConsecutiveLosses: 3,     // توقف بعد 3 خسائر متتالية
      profitLockPercentage: 0.20,  // اقفل 20% من الأرباح (لا تُعاد استثمارها)
      autoUpgradeEnabled: true,    // ترقية تلقائية
    };

    this.tierStats = {
      tier: 'MEDIUM',
      dailyPnL: 0,
      consecutiveLosses: 0,
      totalTradesToday: 0,
      lastTradeTime: 0,
      profitsLocked: 0,
      startingBalance: 0,
    };

    this.refreshAllowedSymbols();
  }

  /**
   * Sets QUBO-derived target portfolio weights for position sizing adjustments
   */
  public setTargetWeights(weights: Record<string, number>): void {
    this.targetWeights = { ...weights };
    console.log(`🎯 QUBO target weights updated:`, Object.entries(this.targetWeights).map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`).join(', '));
  }

  /**
   * Retrieves current QUBO target weights
   */
  public getTargetWeights(): Record<string, number> {
    return { ...this.targetWeights };
  }

  /**
   * ربط RiskEngine مع Sizer — يسمح لكل منهما بالوصول إلى بيانات الآخر (cross-validation)
   */
  public setRiskEngine(riskEngine: RiskEngine): void {
    this.riskEngine = riskEngine;
  }

  /**
   * التحقق من حدود المخاطرة من خلال RiskEngine (تقييم مزدوج قبل فتح صفقة)
   */
  public validateWithRiskEngine(
    equity: number,
    currentExposureUsd: number,
    orderNotional: number,
    spreadPct: number = DEFAULT_SPREAD_PCT,
    pendingExposureUsd: number = 0,
    positions: any[] = [],
    balance: any = { totalEquity: equity, freeMargin: equity }
  ): { allowed: boolean; reason?: string } {
    if (!this.riskEngine) {
      return { allowed: true, reason: 'RiskEngine not linked; skipping risk validation' };
    }
    return this.riskEngine.validateOrder(
      { quantity: orderNotional, price: 1 },
      balance,
      positions,
      spreadPct,
      pendingExposureUsd
    );
  }

  /**
   * قراءة VaR/CVaR الحالي من RiskEngine لتحديد مستوى المخاطرة
   */
  public getCurrentRiskMetrics(balance: any, positions: any[], killSwitchLevel?: any): {
    sharpe: number | null;
    sortino: number | null;
    drawdown: number;
    var95: number;
  } {
    if (!this.riskEngine) {
      return { sharpe: null, sortino: null, drawdown: 0, var95: 0 };
    }
    const result = this.riskEngine.evaluateRisk(balance, positions, killSwitchLevel);
    const m = result.metrics;
    return {
      sharpe: m.sharpeRatio ?? null,
      sortino: m.sortinoRatio ?? null,
      drawdown: Number.isFinite(m.currentDrawdownPct) ? m.currentDrawdownPct : 0,
      var95: Number.isFinite(m.var95) ? m.var95 : 0,
    };
  }

  /**
   * ربط AssetScreener مع Sizer
   */
  public setAssetScreener(screener: AssetScreener): void {
    this.assetScreener = screener;
    this.refreshAllowedSymbols();
  }

  /**
   * يُستدعى عند كل تحديث للرصيد
   */
  public updateBalance(balance: number): PortfolioTier {
    this.currentBalance = balance;
    if (this.tierStats.startingBalance === 0 && balance > 0) {
      this.tierStats.startingBalance = balance;
    }

    const previousTier = this.currentTier;

    let tier: PortfolioTier = 'LARGE';
    for (const [limit, t] of TIER_BOUNDS) {
      if (balance <= limit) {
        tier = t;
        break;
      }
    }
    this.currentTier = tier;

    this.tierStats.tier = this.currentTier;

    if (previousTier !== this.currentTier) {
      console.log(`📊 Portfolio tier changed: ${previousTier} → ${this.currentTier} (Balance: $${balance.toFixed(2)})`);
    }

    this.refreshAllowedSymbols();

    return this.currentTier;
  }

  /**
   * تحديث قائمة العملات المسموحة بناءً على الفلتر الفعال والفئة الحالية
   */
  public refreshAllowedSymbols(): AssetSymbol[] {
    const config = this.getConfig();
    if (this.assetScreener) {
      const qualified = this.assetScreener.getQualifiedAssets(config.maxQualifiedAssets);
      if (qualified && qualified.length > 0) {
        this.allowedSymbols = qualified;
        return this.allowedSymbols;
      }
    }
    this.allowedSymbols = config.allowedSymbols;
    return this.allowedSymbols;
  }

  public getPortfolioTier(): PortfolioTier {
    return this.currentTier;
  }

  public getAllowedSymbols(): AssetSymbol[] {
    if (this.allowedSymbols.length === 0) {
      return this.refreshAllowedSymbols();
    }
    return this.allowedSymbols;
  }

  public isSymbolAllowed(symbol: AssetSymbol): boolean {
    const allowed = this.getAllowedSymbols();
    return allowed.includes(symbol);
  }

  /**
   * حساب الرافعة الديناميكية (5x إلى 15x) بناءً على قوة الإشارة وفئة المحفظة
   */
  public calculateDynamicLeverage(signalStrength: number): number {
    const config = this.getConfig();
    const minLeverage = config.minLeverage || 10;
    const maxLeverage = config.maxLeverage || 20;

    if (minLeverage >= maxLeverage) {
      return minLeverage;
    }

    const leverageRange = maxLeverage - minLeverage;
    const dynamicLeverage = minLeverage + (leverageRange * Math.max(0, Math.min(1, signalStrength)));
    const roundedLeverage = Math.round(dynamicLeverage);

    console.log(`📊 Dynamic Leverage: ${roundedLeverage}x (Signal: ${(signalStrength * 100).toFixed(0)}%, Range: ${minLeverage}x-${maxLeverage}x)`);

    return roundedLeverage;
  }

  /**
   * يُستدعى عند بداية كل يوم
   */
  public resetDailyStats(currentBalance: number): void {
    this.tierStats.dailyPnL = 0;
    this.tierStats.consecutiveLosses = 0;
    this.tierStats.totalTradesToday = 0;
    this.tierStats.startingBalance = currentBalance;
    console.log(`📅 Daily stats reset. Starting balance: $${currentBalance.toFixed(2)}`);
  }

  /**
   * يُستدعى بعد كل صفقة
   */
  public recordTradeResult(pnl: number, currentBalance: number): void {
    this.tierStats.dailyPnL += pnl;
    this.tierStats.totalTradesToday += 1;
    this.tierStats.lastTradeTime = Date.now();

    if (pnl < 0) {
      this.tierStats.consecutiveLosses += 1;
    } else {
      this.tierStats.consecutiveLosses = 0;
      const profitToLock = pnl * this.compoundingConfig.profitLockPercentage;
      this.tierStats.profitsLocked += profitToLock;
    }

    if (this.compoundingConfig.autoUpgradeEnabled) {
      this.checkAutoUpgrade(currentBalance);
    }

    console.log(`📊 Trade recorded: PnL $${pnl.toFixed(2)} | Daily: $${this.tierStats.dailyPnL.toFixed(2)} | Consecutive losses: ${this.tierStats.consecutiveLosses}`);
  }

  private checkAutoUpgrade(currentBalance: number): void {
    const previousTier = this.currentTier;

    if (currentBalance >= 500 && this.currentTier !== 'LARGE') {
      this.currentTier = 'LARGE';
    } else if (currentBalance >= 100 && this.currentTier === 'SMALL') {
      this.currentTier = 'MEDIUM';
    } else if (currentBalance >= 50 && this.currentTier === 'MICRO') {
      this.currentTier = 'SMALL';
    }

    this.tierStats.tier = this.currentTier;

    if (previousTier !== this.currentTier) {
      console.log(`🎉 AUTO UPGRADE: ${previousTier} → ${this.currentTier} (Balance: $${currentBalance.toFixed(2)})`);
    }

    this.refreshAllowedSymbols();
  }

  public getConfig(): TierConfig {
    return this.tierConfigs[this.currentTier];
  }

  public canOpenNewTrade(currentOpenPositions: number, totalOpenNotional: number = 0, currentEquity: number = 0): { allowed: boolean; reason?: string } {
    const config = this.getConfig();

    if (currentOpenPositions >= config.maxConcurrentPositions) {
      return { allowed: false, reason: `Max positions reached (${config.maxConcurrentPositions})` };
    }

    if (currentEquity > 0 && totalOpenNotional > currentEquity * MAX_EXPOSURE_MULTIPLE) {
      return { allowed: false, reason: `Total portfolio exposure exceeded ($${totalOpenNotional.toFixed(0)} > 2x Equity)` };
    }

    const starting = this.tierStats.startingBalance || this.currentBalance || FALLBACK_BALANCE;
    const maxDailyLoss = starting * this.compoundingConfig.maxDailyLossPercent;
    if (this.tierStats.dailyPnL < -maxDailyLoss) {
      return { 
        allowed: false, 
        reason: `Daily loss limit reached ($${this.tierStats.dailyPnL.toFixed(2)} / -$${maxDailyLoss.toFixed(2)})` 
      };
    }

    if (this.tierStats.consecutiveLosses >= this.compoundingConfig.maxConsecutiveLosses) {
      return { 
        allowed: false, 
        reason: `Max consecutive losses reached (${this.tierStats.consecutiveLosses})` 
      };
    }

    return { allowed: true };
  }

  public canOpenNewPosition(currentOpenPositions: number): boolean {
    return this.canOpenNewTrade(currentOpenPositions).allowed;
  }

  /**
   * Determines position size based on strict risk management (1% of capital per trade)
   * Quantity = RiskAmount / StopLossDistance
   * Also adjusts based on QUBO target portfolio weights
   */
  public calculatePositionSize(
    symbol: AssetSymbol,
    entryOrStrength: number,
    stopOrPrice: number,
    equity: number,
    riskPct: number = DEFAULT_RISK_PCT,
    winRate?: number,
    avgWinLossRatio?: number
  ): { quantity: number; notionalValue: number; leverage: number } {
    const config = this.getConfig();

    // Validate equity - require actual account balance, no hardcoded defaults
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new Error('Invalid equity: must be a finite positive number');
    }
    const safeEquity = equity;

    // Check if arguments are passed as (entry, stop, equity, riskPct) or (strength, price, balance)
    let entry = entryOrStrength;
    let stopDistance = Math.abs(entryOrStrength - stopOrPrice);

    // If second arg is price and first is strength (legacy pattern)
    if (entryOrStrength <= 1.0 && stopOrPrice > 1.0) {
      entry = stopOrPrice;
      // Use actual stop distance if provided, otherwise calculate from risk metrics
      if (stopOrPrice > entry) {
        stopDistance = stopOrPrice - entry;
      } else {
        // Fallback: use 1.5% of entry as stop distance, but log warning
        stopDistance = entry * FALLBACK_STOP_DISTANCE_PCT;
      }
    }

    if (stopDistance <= 0 || !Number.isFinite(stopDistance)) {
      throw new Error('Invalid stop distance: must be a finite positive number');
    }

    // Defined risk (1% of total capital)
    const riskAmount = safeEquity * Math.min(MAX_RISK_PCT, Math.max(MIN_RISK_PCT, riskPct));
    let rawQty = riskAmount / stopDistance;
    let notional = rawQty * entry;

    // Max exposure cap per trade based on portfolio tier
    const maxExposurePct = config.maxTradePercentage || DEFAULT_MAX_TRADE_PERCENTAGE;
    const maxNotional = safeEquity * maxExposurePct;
    if (notional > maxNotional) {
      rawQty = maxNotional / entry;
      notional = maxNotional;
    }

    // Kelly criterion sizing adjustment using actual metrics if available
    if (winRate !== undefined && avgWinLossRatio !== undefined && Number.isFinite(winRate) && Number.isFinite(avgWinLossRatio)) {
      const kellyFraction = winRate - (1 - winRate) / avgWinLossRatio;
      if (kellyFraction > 0) {
        // Apply half-Kelly for safety, capped at 2x the base risk
        const kellyMultiplier = Math.min(2, Math.max(0.5, 0.5 * kellyFraction / riskPct));
        rawQty *= kellyMultiplier;
        notional = rawQty * entry;
        // Re-apply max notional cap after Kelly adjustment
        if (notional > maxNotional) {
          rawQty = maxNotional / entry;
          notional = maxNotional;
        }
      }
    }

    // Proportional margin allocation - use actual equity, no hardcoded minimums
    const proportionalTargetMargin = safeEquity * PROPORTIONAL_MARGIN_PCT;
    const targetNotional = Math.max(config.minTradeValue || 0, proportionalTargetMargin * (config.minLeverage || 10));
    if (notional < targetNotional && entry > 0) {
      notional = targetNotional;
      rawQty = notional / entry;
    }

    // QUBO target weight adjustment
    const targetWeight = this.targetWeights[symbol];
    if (targetWeight !== undefined && targetWeight > 0 && notional > 0) {
      const currentWeight = notional / safeEquity;
      const deviation = (currentWeight - targetWeight) / targetWeight;
      const deviationBand = 0.20; // 20% deviation band

      if (Math.abs(deviation) > deviationBand) {
        // Linear scaling outside the band
        const scaleFactor = 1 - Math.sign(deviation) * Math.min(0.5, (Math.abs(deviation) - deviationBand) * 2);
        rawQty *= Math.max(0.1, scaleFactor);
        notional = rawQty * entry;
        console.log(`🎯 QUBO weight adjustment for ${symbol}: target=${(targetWeight*100).toFixed(1)}%, current=${(currentWeight*100).toFixed(1)}%, deviation=${(deviation*100).toFixed(1)}%, scale=${scaleFactor.toFixed(2)}`);
      }
    }

    // Calculate required leverage to cover margin, respecting tier safe range
    const calculatedLev = Math.max(config.minLeverage || 10, Math.ceil(notional / safeEquity));
    const leverage = Math.min(config.maxLeverage || 20, Math.max(config.minLeverage || 10, calculatedLev));

    return {
      quantity: Number(rawQty.toFixed(4)),
      notionalValue: Number(notional.toFixed(2)),
      leverage,
    };
  }

  public getAdjustedZScoreThreshold(baseZScore: number): number {
    const config = this.getConfig();
    return Math.min(baseZScore, config.minZScore);
  }

  public getCompoundingReport(): any {
    return {
      enabled: this.compoundingConfig.enabled,
      tier: this.currentTier,
      currentBalance: this.currentBalance,
      startingBalance: this.tierStats.startingBalance,
      dailyPnL: this.tierStats.dailyPnL,
      consecutiveLosses: this.tierStats.consecutiveLosses,
      totalTradesToday: this.tierStats.totalTradesToday,
      profitsLocked: this.tierStats.profitsLocked,
      reinvestPercentage: this.compoundingConfig.reinvestPercentage,
      canTrade: this.canOpenNewTrade(0).allowed,
    };
  }

  public getPortfolioReport(): any {
    const config = this.getConfig();
    const symbols = this.getAllowedSymbols();
    return {
      tier: this.currentTier,
      balance: this.currentBalance,
      maxPositions: config.maxConcurrentPositions,
      minLeverage: config.minLeverage,
      maxLeverage: config.maxLeverage,
      allowedSymbolsCount: symbols.length,
      allowedSymbols: symbols,
      quboEnabled: config.quboEnabled,
      minZScore: config.minZScore,
      stats: this.tierStats,
    };
  }
}
