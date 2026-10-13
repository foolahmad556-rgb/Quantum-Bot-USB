/**
 * VPIN (Volume-Synchronized Probability of Informed Trading) Calculator
 * Implements VPIN calculation based on Easley et al. (2008)
 */

export interface Trade {
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  notional: number;
  timestamp: number;
}

export interface VPINBucket {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  orderImbalance: number; // |buy - sell| / total
  startTime: number;
  endTime: number;
}

export interface VPINConfig {
  bucketSizeNotional: number; // e.g., 100000 ($100K)
  rollingWindow: number; // e.g., 20 buckets
  highToxicityThreshold: number; // e.g., 0.6
  pauseEntriesThreshold: number; // e.g., 0.8
}

export const DEFAULT_VPIN_CONFIG: VPINConfig = {
  bucketSizeNotional: 100000, // $100K
  rollingWindow: 20,
  highToxicityThreshold: 0.6,
  pauseEntriesThreshold: 0.8,
};

export class VPINCalculator {
  private config: VPINConfig;
  private buckets: VPINBucket[] = [];
  private currentBucket: Partial<VPINBucket> | null = null;
  private trades: Trade[] = [];

  constructor(config: Partial<VPINConfig> = {}) {
    this.config = { ...DEFAULT_VPIN_CONFIG, ...config };
  }

  public addTrade(side: 'buy' | 'sell', quantity: number, price: number): void {
    const notional = quantity * price;
    const trade: Trade = {
      side,
      quantity,
      price,
      notional,
      timestamp: Date.now(),
    };
    
    this.trades.push(trade);
    if (this.trades.length > 10000) {
      this.trades.shift();
    }
    
    this.processTradeIntoBuckets(trade);
  }

  private processTradeIntoBuckets(trade: Trade): void {
    if (!this.currentBucket) {
      this.startNewBucket(trade.timestamp);
    }
    
    const bucket = this.currentBucket as VPINBucket;
    bucket.totalVolume += trade.notional;
    bucket.totalVolume = bucket.totalVolume; // ensure numeric
    
    if (trade.side === 'buy') {
      bucket.buyVolume += trade.notional;
    } else {
      bucket.sellVolume += trade.notional;
    }
    
    // Check if bucket is full
    if (bucket.totalVolume >= this.config.bucketSizeNotional) {
      // Finalize current bucket
      bucket.orderImbalance = bucket.totalVolume > 0
        ? Math.abs(bucket.buyVolume - bucket.sellVolume) / bucket.totalVolume
        : 0;
      bucket.endTime = trade.timestamp;
      this.buckets.push(bucket as VPINBucket);
      
      // Maintain rolling window
      if (this.buckets.length > this.config.rollingWindow) {
        this.buckets.shift();
      }
      
      // Start new bucket
      this.startNewBucket(trade.timestamp);
    }
  }

  private startNewBucket(timestamp: number): void {
    this.currentBucket = {
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      orderImbalance: 0,
      startTime: timestamp,
      endTime: timestamp,
    };
  }

  public getVPIN(): number {
    if (this.buckets.length === 0) {
      return 0;
    }
    
    // Calculate rolling VPIN over last N buckets
    const sumImbalance = this.buckets.reduce((sum, bucket) => sum + bucket.orderImbalance, 0);
    const vpin = sumImbalance / this.buckets.length;
    
    return Math.min(1.0, Math.max(0.0, vpin));
  }

  public getToxicity(): 'low' | 'medium' | 'high' | 'extreme' {
    const vpin = this.getVPIN();
    if (vpin > this.config.pauseEntriesThreshold) {
      return 'extreme';
    } else if (vpin > this.config.highToxicityThreshold) {
      return 'high';
    } else if (vpin > 0.4) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  public shouldReducePositions(): boolean {
    const vpin = this.getVPIN();
    return vpin > this.config.highToxicityThreshold;
  }

  public shouldPauseEntries(): boolean {
    const vpin = this.getVPIN();
    return vpin > this.config.pauseEntriesThreshold;
  }

  public getPositionSizeMultiplier(): number {
    const vpin = this.getVPIN();
    if (vpin > this.config.pauseEntriesThreshold) {
      return 0; // Pause new entries entirely
    } else if (vpin > this.config.highToxicityThreshold) {
      return 0.5; // Reduce position sizes by 50%
    }
    return 1.0;
  }

  public getBucketCount(): number {
    return this.buckets.length;
  }

  public reset(): void {
    this.buckets = [];
    this.currentBucket = null;
    this.trades = [];
  }
}
