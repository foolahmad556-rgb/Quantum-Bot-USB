import { AssetSymbol, Fill, OrderSide } from '../domain/types';

export interface TCAFillRecord {
  fillId: string;
  orderId: string;
  symbol: AssetSymbol;
  side: OrderSide;
  arrivalPrice: number;
  fillPrice: number;
  quantity: number;
  timestamp: number;
  implementationShortfall: number;
  marketImpactBps: number;
  slippageVsMidBps: number;
  effectiveSpreadBps: number;
  isMaker: boolean;
  commission: number;
  commissionAsset: string;
}

export interface TCASummary {
  avgSlippageBps: number;
  avgMarketImpactBps: number;
  avgEffectiveSpreadBps: number;
  fillRate: number;
  score: number;
  totalFills: number;
  totalVolume: number;
  totalCommission: number;
}

export interface TCAConfig {
  windowSize: number;
  highSlippageThresholdBps: number;
  logIntervalMs: number;
}

const DEFAULT_CONFIG: TCAConfig = {
  windowSize: 100,
  highSlippageThresholdBps: 50,
  logIntervalMs: 7 * 24 * 60 * 60 * 1000,
};

export class TransactionCostAnalysis {
  private fills: TCAFillRecord[] = [];
  private config: TCAConfig;
  private logTimer?: NodeJS.Timeout;
  private lastReportTime: number = 0;

  constructor(config: Partial<TCAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startPeriodicLogging();
  }

  /**
   * Record a fill for TCA analysis
   */
  public recordFill(
    fill: Fill,
    arrivalPrice: number,
    midPriceAtFill: number,
    bidPrice: number,
    askPrice: number
  ): TCAFillRecord {
    const side = fill.side;
    const fillPrice = fill.price;
    const quantity = fill.quantity;
    const isBuy = side === 'BUY';

    const implementationShortfall = (fillPrice - arrivalPrice) * quantity * (isBuy ? 1 : -1);
    
    const midPrice = midPriceAtFill || ((bidPrice + askPrice) / 2) || fillPrice;
    const slippageVsMid = ((fillPrice - midPrice) / midPrice) * 10000 * (isBuy ? 1 : -1);
    
    const spread = askPrice - bidPrice;
    const effectiveSpread = 2 * Math.abs(fillPrice - midPrice);
    const effectiveSpreadBps = midPrice > 0 ? (effectiveSpread / midPrice) * 10000 : 0;
    
    const marketImpactBps = Math.abs(slippageVsMid) - (effectiveSpreadBps / 2);
    
    const record: TCAFillRecord = {
      fillId: fill.fillId,
      orderId: fill.orderId,
      symbol: fill.symbol,
      side,
      arrivalPrice,
      fillPrice,
      quantity,
      timestamp: fill.timestamp,
      implementationShortfall,
      marketImpactBps: Math.max(0, marketImpactBps),
      slippageVsMidBps: slippageVsMid,
      effectiveSpreadBps,
      isMaker: fill.isMaker,
      commission: fill.commission,
      commissionAsset: fill.commissionAsset,
    };

    this.fills.push(record);
    
    if (this.fills.length > this.config.windowSize * 2) {
      this.fills = this.fills.slice(-this.config.windowSize);
    }

    this.checkHighSlippage(record);

    return record;
  }

  private checkHighSlippage(record: TCAFillRecord): void {
    if (Math.abs(record.slippageVsMidBps) > this.config.highSlippageThresholdBps) {
      console.warn(
        `⚠️ [TCA] High slippage detected: ${record.slippageVsMidBps.toFixed(2)} bps ` +
        `(${record.symbol} ${record.side} ${record.quantity} @ ${record.fillPrice}, ` +
        `arrival: ${record.arrivalPrice}, mid: ${record.arrivalPrice})`
      );
      console.warn(`🔍 [TCA] Triggering execution algorithm review for ${record.symbol}`);
    }
  }

  private startPeriodicLogging(): void {
    this.logTimer = setInterval(() => {
      const report = this.getTCAReport();
      if (report.totalFills > 0) {
        console.log(`📊 [TCA Weekly Report] ${JSON.stringify(report, null, 2)}`);
      }
      this.lastReportTime = Date.now();
    }, this.config.logIntervalMs);
    
    this.logTimer.unref();
  }

  /**
   * Get TCA report for the rolling window
   */
  public getTCAReport(): TCASummary {
    const windowFills = this.fills.slice(-this.config.windowSize);
    
    if (windowFills.length === 0) {
      return {
        avgSlippageBps: 0,
        avgMarketImpactBps: 0,
        avgEffectiveSpreadBps: 0,
        fillRate: 0,
        score: 100,
        totalFills: 0,
        totalVolume: 0,
        totalCommission: 0,
      };
    }

    const totalFills = windowFills.length;
    const totalVolume = windowFills.reduce((sum, f) => sum + f.quantity * f.fillPrice, 0);
    const totalCommission = windowFills.reduce((sum, f) => sum + f.commission, 0);
    
    const avgSlippageBps = windowFills.reduce((sum, f) => sum + Math.abs(f.slippageVsMidBps), 0) / totalFills;
    const avgMarketImpactBps = windowFills.reduce((sum, f) => sum + f.marketImpactBps, 0) / totalFills;
    const avgEffectiveSpreadBps = windowFills.reduce((sum, f) => sum + f.effectiveSpreadBps, 0) / totalFills;
    
    const filledOrders = new Set(windowFills.map(f => f.orderId)).size;
    const fillRate = filledOrders / Math.max(1, totalFills);
    
    const score = this.computeScore(avgSlippageBps, avgMarketImpactBps, avgEffectiveSpreadBps, fillRate);

    return {
      avgSlippageBps: Number(avgSlippageBps.toFixed(2)),
      avgMarketImpactBps: Number(avgMarketImpactBps.toFixed(2)),
      avgEffectiveSpreadBps: Number(avgEffectiveSpreadBps.toFixed(2)),
      fillRate: Number(fillRate.toFixed(4)),
      score,
      totalFills,
      totalVolume: Number(totalVolume.toFixed(2)),
      totalCommission: Number(totalCommission.toFixed(4)),
    };
  }

  private computeScore(
    avgSlippageBps: number,
    avgMarketImpactBps: number,
    avgEffectiveSpreadBps: number,
    fillRate: number
  ): number {
    let score = 100;
    
    score -= Math.min(30, avgSlippageBps * 0.5);
    score -= Math.min(25, avgMarketImpactBps * 0.5);
    score -= Math.min(20, (avgEffectiveSpreadBps - 2) * 0.5);
    score -= Math.min(25, (1 - fillRate) * 100);
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get detailed fill records for analysis
   */
  public getFillRecords(symbol?: AssetSymbol, limit?: number): TCAFillRecord[] {
    let records = this.fills;
    if (symbol) {
      records = records.filter(f => f.symbol === symbol);
    }
    if (limit) {
      records = records.slice(-limit);
    }
    return [...records].reverse();
  }

  /**
   * Get TCA report per symbol
   */
  public getTCAReportBySymbol(): Record<AssetSymbol, TCASummary> {
    const symbols = [...new Set(this.fills.map(f => f.symbol))];
    const result: Record<AssetSymbol, TCASummary> = {} as any;
    
    for (const symbol of symbols) {
      const symbolFills = this.fills.filter(f => f.symbol === symbol).slice(-this.config.windowSize);
      if (symbolFills.length === 0) continue;
      
      const totalFills = symbolFills.length;
      const totalVolume = symbolFills.reduce((sum, f) => sum + f.quantity * f.fillPrice, 0);
      const totalCommission = symbolFills.reduce((sum, f) => sum + f.commission, 0);
      
      const avgSlippageBps = symbolFills.reduce((sum, f) => sum + Math.abs(f.slippageVsMidBps), 0) / totalFills;
      const avgMarketImpactBps = symbolFills.reduce((sum, f) => sum + f.marketImpactBps, 0) / totalFills;
      const avgEffectiveSpreadBps = symbolFills.reduce((sum, f) => sum + f.effectiveSpreadBps, 0) / totalFills;
      
      const filledOrders = new Set(symbolFills.map(f => f.orderId)).size;
      const fillRate = filledOrders / Math.max(1, totalFills);
      
      const score = this.computeScore(avgSlippageBps, avgMarketImpactBps, avgEffectiveSpreadBps, fillRate);
      
      result[symbol] = {
        avgSlippageBps: Number(avgSlippageBps.toFixed(2)),
        avgMarketImpactBps: Number(avgMarketImpactBps.toFixed(2)),
        avgEffectiveSpreadBps: Number(avgEffectiveSpreadBps.toFixed(2)),
        fillRate: Number(fillRate.toFixed(4)),
        score,
        totalFills,
        totalVolume: Number(totalVolume.toFixed(2)),
        totalCommission: Number(totalCommission.toFixed(4)),
      };
    }
    
    return result;
  }

  /**
   * Clear all recorded fills
   */
  public clear(): void {
    this.fills = [];
  }

  /**
   * Stop periodic logging
   */
  public stop(): void {
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = undefined;
    }
  }

  /**
   * Export TCA data for external analysis
   */
  public exportData(): TCAFillRecord[] {
    return [...this.fills];
  }
}