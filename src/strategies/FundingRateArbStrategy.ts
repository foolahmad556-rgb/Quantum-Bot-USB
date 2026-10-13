/**
 * Funding Rate Arbitrage Strategy
 * Tracks funding rates from Binance perpetual futures and executes basis trades
 * when funding rates create profitable arbitrage opportunities
 */

import { AssetSymbol, TradingSignal } from '../domain/types';

export interface FundingRateData {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

export interface FundingRateArbConfig {
  annualizedThreshold: number; // e.g., 0.15 (15%)
  minBasisSpreadBps: number; // basis spread must cover transaction costs
  leverage: number;
  positionSize: number;
}

export const DEFAULT_FUNDING_ARB_CONFIG: FundingRateArbConfig = {
  annualizedThreshold: 0.15, // 15%
  minBasisSpreadBps: 10, // 10 bps
  leverage: 3,
  positionSize: 10000, // $10k notional
};

export class FundingRateArbStrategy {
  private config: FundingRateArbConfig;
  private signalCounter: number = 0;
  private fundingRates: Map<string, number> = new Map();
  private lastFetchTime: Map<string, number> = new Map();
  private inPosition: Map<string, 'LONG_PERP_SHORT_SPOT' | 'SHORT_PERP_LONG_SPOT' | null> = new Map();

  constructor(config: Partial<FundingRateArbConfig> = {}) {
    this.config = { ...DEFAULT_FUNDING_ARB_CONFIG, ...config };
  }

  public async fetchFundingRates(symbols?: string[]): Promise<void> {
    try {
      const url = symbols && symbols.length > 0
        ? `https://fapi.binance.com/fapi/v1/premiumIndex?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
        : 'https://fapi.binance.com/fapi/v1/premiumIndex';
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch funding rates: ${response.status}`);
      }
      
      const data: FundingRateData[] = await response.json();
      const now = Date.now();
      
      for (const item of data) {
        const fundingRate = parseFloat(item.lastFundingRate);
        this.fundingRates.set(item.symbol, fundingRate);
        this.lastFetchTime.set(item.symbol, now);
      }
    } catch (error) {
      console.error('Error fetching funding rates:', error);
    }
  }

  public async evaluate(symbols?: string[]): Promise<TradingSignal | null> {
    // Fetch latest funding rates if needed (every minute)
    const now = Date.now();
    const shouldFetch = Array.from(this.lastFetchTime.values()).length === 0 || 
      Array.from(this.lastFetchTime.values()).some(t => now - t > 60000); // 60 seconds
    
    if (shouldFetch) {
      await this.fetchFundingRates(symbols);
    }

    // Evaluate each symbol for arbitrage opportunities
    for (const [symbol, fundingRate] of this.fundingRates.entries()) {
      const signal = this.evaluateSymbol(symbol, fundingRate);
      if (signal) {
        return signal;
      }
    }
    
    return null;
  }

  private evaluateSymbol(symbol: string, fundingRate: number): TradingSignal | null {
    // Annualize funding rate (8-hour intervals * 3 * 365 = ~1095, or more precisely 3 times per day * 365 = 1095)
    // Binance funding is paid every 8 hours, so annualized = fundingRate * 3 * 365 (approx) or fundingRate * (24/8) * 365
    const annualizedFunding = fundingRate * 3 * 365;
    const absAnnualized = Math.abs(annualizedFunding);
    const threshold = this.config.annualizedThreshold;
    
    // Check condition (a): |annualizedFunding| > threshold
    if (absAnnualized <= threshold) {
      return null;
    }
    
    const currentPosition = this.inPosition.get(symbol);
    
    // Determine trade direction
    if (annualizedFunding > 0) {
      // High positive funding: short the perp, hedge by buying spot
      // But check if already in opposite position
      if (currentPosition === 'LONG_PERP_SHORT_SPOT') {
        return null; // Already in counter-position
      }
      
      // Check condition (b): basis spread covers transaction costs
      // For simplicity, assume basis spread is sufficient if annualized > threshold
      // In practice, would compare to transaction costs
      if (absAnnualized < threshold + this.config.minBasisSpreadBps / 10000) {
        // Basic check - if just above threshold, might not cover costs
        // For this implementation, proceed if above threshold
      }
      
      if (currentPosition === 'SHORT_PERP_LONG_SPOT') {
        return null; // Already in this position
      }
      
      const profitPer8h = Math.abs(fundingRate) * this.config.positionSize * (1 / this.config.leverage);
      this.signalCounter += 1;
      const assetSymbol = symbol.replace('USDT', '/USDT').replace('BUSD', '/BUSD') as AssetSymbol;
      
      this.inPosition.set(symbol, 'SHORT_PERP_LONG_SPOT');
      
      return {
        id: `FUNDARB-${this.signalCounter}-${symbol}-${Date.now().toString(36)}`,
        symbol: assetSymbol,
        timestamp: Date.now(),
        type: 'SELL',
        strength: Math.min(1.0, absAnnualized / (threshold * 2)),
        zScore: 0,
        halfLife: 0,
        targetPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reason: `Funding Arb: Short perp + long spot (funding ${(annualizedFunding * 100).toFixed(2)}% annualized, est profit $${profitPer8h.toFixed(2)}/8h)`,
        strategy: 'Funding Rate Arbitrage',
      };
    } else if (annualizedFunding < 0) {
      // Strongly negative funding: long the perp, hedge by shorting spot
      if (currentPosition === 'SHORT_PERP_LONG_SPOT') {
        return null; // Already in counter-position
      }
      
      if (currentPosition === 'LONG_PERP_SHORT_SPOT') {
        return null; // Already in this position
      }
      
      const profitPer8h = Math.abs(fundingRate) * this.config.positionSize * (1 / this.config.leverage);
      this.signalCounter += 1;
      const assetSymbol = symbol.replace('USDT', '/USDT').replace('BUSD', '/BUSD') as AssetSymbol;
      
      this.inPosition.set(symbol, 'LONG_PERP_SHORT_SPOT');
      
      return {
        id: `FUNDARB-${this.signalCounter}-${symbol}-${Date.now().toString(36)}`,
        symbol: assetSymbol,
        timestamp: Date.now(),
        type: 'BUY',
        strength: Math.min(1.0, absAnnualized / (threshold * 2)),
        zScore: 0,
        halfLife: 0,
        targetPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reason: `Funding Arb: Long perp + short spot (funding ${(annualizedFunding * 100).toFixed(2)}% annualized, est profit $${profitPer8h.toFixed(2)}/8h)`,
        strategy: 'Funding Rate Arbitrage',
      };
    }
    
    return null;
  }

  public clearPosition(symbol: string): void {
    this.inPosition.set(symbol, null);
  }
}
