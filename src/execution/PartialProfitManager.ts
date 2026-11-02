/**
 * Basel Quantum Algorithmic Trading System
 * Partial Profit Taking, Break-Even Protection & Trailing Stop Manager
 */

import { OrderGateway } from './OrderGateway';
import { AssetSymbol } from '../domain/types';

export interface PartialProfitConfig {
  enabled: boolean;
  firstTargetR: number;             // الهدف الأول بوحدة R
  firstClosePercent: number;        // نسبة الإغلاق الأول
  trailingStopPercent: number;     // نسبة Trailing Stop (مثلاً 0.03 = 3%)
  moveStopToBreakEven: boolean;    // نقل الوقف لنقطة الدخول
  breakEvenOffsetBps: number;       // هامش تغطية الرسوم والانزلاق
  timeStopProgressR: number;        // أقل تقدم مطلوب عند انتهاء المهلة
}

export interface PositionState {
  orderId: string;
  symbol: AssetSymbol;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  originalQuantity: number;
  remainingQuantity: number;
  partialProfitTaken: boolean;
  breakEvenActivated: boolean;
  highestPrice: number;            // أعلى سعر وصلته (للـ BUY)
  lowestPrice: number;             // أدنى سعر وصلته (للـ SELL)
  trailingStopPrice: number;
  initialStopPrice: number;
  riskPerUnit: number;
  bestR: number;
  lastTrailingUpdate?: number;
  registeredAt: number;
  maxHoldMs?: number;
  exiting?: boolean;               // علم متزامن لمنع إرسال أوامر خروج مكررة على كل tick
}

export class PartialProfitManager {
  private orderGateway: OrderGateway;
  private config: PartialProfitConfig;
  private activePositions: Map<string, PositionState> = new Map();
  private processingMutex: Set<string> = new Set();

  constructor(orderGateway: OrderGateway, config: Partial<PartialProfitConfig> = {}) {
    this.orderGateway = orderGateway;
    this.config = {
      enabled: true,
      firstTargetR: 1.0,
      firstClosePercent: 0.35,
      trailingStopPercent: 0.008,    // Trailing Stop 0.8% لحماية القمة
      moveStopToBreakEven: true,     // نقل وقف الخسارة لنقطة الدخول فوراً
      breakEvenOffsetBps: 8,
      timeStopProgressR: 0.5,
      ...config,
    };
  }

  public registerPosition(
    orderId: string,
    symbol: AssetSymbol,
    side: 'BUY' | 'SELL',
    entryPrice: number,
    quantity: number,
    options: { maxHoldMs?: number; stopLossPrice?: number } = {}
  ): void {
    if (!this.config.enabled) return;

    // Check if an existing position for this symbol is already tracked -> consolidate
    const existing = Array.from(this.activePositions.values()).find((p) => p.symbol === symbol && p.side === side);
    if (existing) {
      const totalCost = (existing.entryPrice * existing.remainingQuantity) + (entryPrice * quantity);
      const totalQty = existing.remainingQuantity + quantity;
      existing.entryPrice = totalCost / totalQty;
      existing.originalQuantity += quantity;
      existing.remainingQuantity = totalQty;
      if (options.maxHoldMs) existing.maxHoldMs = options.maxHoldMs;
      if (options.stopLossPrice && options.stopLossPrice > 0) {
        existing.initialStopPrice = options.stopLossPrice;
        existing.riskPerUnit = Math.max(Math.abs(existing.entryPrice - options.stopLossPrice), existing.entryPrice * 0.001);
      }
      console.log(`📝 PartialProfitManager: Consolidated position for ${symbol} | New Avg: $${existing.entryPrice.toFixed(2)} | Qty: ${existing.remainingQuantity}`);
      return;
    }

    this.activePositions.set(orderId, {
      orderId,
      symbol,
      side,
      entryPrice,
      originalQuantity: quantity,
      remainingQuantity: quantity,
      partialProfitTaken: false,
      breakEvenActivated: false,
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      trailingStopPrice: 0,
      initialStopPrice: options.stopLossPrice && options.stopLossPrice > 0
        ? options.stopLossPrice
        : (side === 'BUY' ? entryPrice * 0.995 : entryPrice * 1.005),
      riskPerUnit: Math.max(
        Math.abs(entryPrice - (options.stopLossPrice && options.stopLossPrice > 0
          ? options.stopLossPrice
          : (side === 'BUY' ? entryPrice * 0.995 : entryPrice * 1.005))),
        entryPrice * 0.001,
      ),
      bestR: 0,
      registeredAt: Date.now(),
      maxHoldMs: options.maxHoldMs,
      exiting: false,
    });

    console.log(`📝 PartialProfitManager: Position registered [${orderId}] | ${symbol} ${side} @ $${entryPrice} | Qty: ${quantity}${options.maxHoldMs ? ` | MaxHold: ${(options.maxHoldMs/60000).toFixed(1)}m` : ''}`);
  }

  public async updatePosition(orderIdOrSymbol: string, currentPrice: number): Promise<void> {
    const matchingPositions: PositionState[] = [];

    if (this.activePositions.has(orderIdOrSymbol)) {
      matchingPositions.push(this.activePositions.get(orderIdOrSymbol)!);
    } else {
      for (const pos of this.activePositions.values()) {
        if (pos.symbol === orderIdOrSymbol) {
          matchingPositions.push(pos);
        }
      }
    }

    for (const position of matchingPositions) {
      if (position.exiting) continue;

      const mutexKey = `${position.symbol}-${position.orderId}`;
      if (this.processingMutex.has(mutexKey)) continue;

      if (position.side === 'BUY') {
        position.highestPrice = Math.max(position.highestPrice, currentPrice);
      } else {
        position.lowestPrice = Math.min(position.lowestPrice, currentPrice);
      }

      const currentR = position.riskPerUnit > 0
        ? (position.side === 'BUY'
          ? (currentPrice - position.entryPrice)
          : (position.entryPrice - currentPrice)) / position.riskPerUnit
        : 0;
      position.bestR = Math.max(position.bestR, currentR);

      // Close only stagnant trades. Once 1R has been reached, the trailing
      // stop owns the exit and the position may continue as a runner.
      const ageMs = Date.now() - position.registeredAt;
      const pastInitialTimeStop = Boolean(position.maxHoldMs && ageMs > position.maxHoldMs);
      const pastFinalTimeStop = Boolean(position.maxHoldMs && ageMs > position.maxHoldMs * 1.5);
      if (position.maxHoldMs && position.bestR < this.config.firstTargetR
        && (pastFinalTimeStop || (pastInitialTimeStop && currentR < this.config.timeStopProgressR))) {
        position.exiting = true;
        this.processingMutex.add(mutexKey);
        try {
          console.log(`⏱️ Smart Time Stop for ${position.symbol}: age=${Math.round((Date.now() - position.registeredAt) / 60000)}m bestR=${position.bestR.toFixed(2)} currentR=${currentR.toFixed(2)}`);
          await this.executeTimeExit(position, currentPrice);
        } finally {
          this.processingMutex.delete(mutexKey);
        }
        continue;
      }

      // 1. Check Partial Profit Target (e.g. +5%)
      if (!position.partialProfitTaken) {
        const profitR = position.riskPerUnit > 0
          ? (position.side === 'BUY'
            ? (currentPrice - position.entryPrice)
            : (position.entryPrice - currentPrice)) / position.riskPerUnit
          : 0;

        if (profitR >= this.config.firstTargetR) {
          this.processingMutex.add(mutexKey);
          try {
            await this.executePartialProfit(position, currentPrice);
          } finally {
            this.processingMutex.delete(mutexKey);
          }
        }
      }

      // 2. Trailing Stop Management (after partial profit)
      if (position.partialProfitTaken && !position.exiting) {
        await this.updateTrailingStop(position, currentPrice);
      }
    }
  }

  private async executeTimeExit(position: PositionState, currentPrice: number): Promise<void> {
    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    const filter = this.orderGateway.getSymbolFilter(position.symbol);
    const stepDecimals = Math.max(0, -Math.floor(Math.log10(filter.stepSize || 0.0001)));
    const cleanQty = Number(position.remainingQuantity.toFixed(stepDecimals));

    if (cleanQty <= 0) {
      this.activePositions.delete(position.orderId);
      return;
    }

    try {
      this.orderGateway.submitOrder({
        symbol: position.symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: cleanQty,
        price: currentPrice,
        strategyId: 'TIME_EXIT',
        executionTag: 'TIME_EXIT',
        reduceOnly: true,
      });

      await this.orderGateway.cancelProtectiveOrders(position.symbol, position.orderId);
      this.activePositions.delete(position.orderId);
      console.log(`⏱️ Closed remaining ${cleanQty} ${position.symbol} via reduceOnly market exit.`);
    } catch (err) {
      position.exiting = false;
      console.error('❌ Error executing time-based exit:', err);
    }
  }

  private async executePartialProfit(position: PositionState, currentPrice: number): Promise<void> {
    const filter = this.orderGateway.getSymbolFilter(position.symbol);
    const stepDecimals = Math.max(0, -Math.floor(Math.log10(filter.stepSize || 0.0001)));
    const rawCloseQty = position.originalQuantity * this.config.firstClosePercent;
    const closeQuantity = Number(rawCloseQty.toFixed(stepDecimals));

    if (closeQuantity <= 0 || closeQuantity > position.remainingQuantity) return;

    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    console.log(`💰 Partial Profit Triggered: Closing ${closeQuantity} ${position.symbol} @ $${currentPrice}`);

    try {
      const fill = this.orderGateway.submitOrder({
        symbol: position.symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: closeQuantity,
        price: currentPrice,
        strategyId: 'PARTIAL_PROFIT',
        reduceOnly: true,
      });

      // Update remaining quantity only on successful submission
      const newRemaining = Number((position.remainingQuantity - closeQuantity).toFixed(stepDecimals));
      position.remainingQuantity = Math.max(0, newRemaining);
      position.partialProfitTaken = true;

      if (this.config.moveStopToBreakEven && position.remainingQuantity > 0) {
        await this.moveToBreakEven(position);
      }

      const profit = position.side === 'BUY'
        ? (currentPrice - position.entryPrice) * closeQuantity
        : (position.entryPrice - currentPrice) * closeQuantity;

      console.log(`✅ Partial profit taken: +$${profit.toFixed(2)} | Remaining qty: ${position.remainingQuantity}`);
    } catch (err) {
      console.error('❌ Failed to execute partial profit order:', err);
    }
  }

  private async moveToBreakEven(position: PositionState): Promise<void> {
    console.log(`🛡️ Moving Stop Loss to Break-Even for ${position.symbol} @ $${position.entryPrice}`);

    await this.orderGateway.cancelProtectiveOrders(position.symbol, position.orderId);

    const offset = position.entryPrice * (this.config.breakEvenOffsetBps / 10_000);
    const stopPrice = position.side === 'BUY'
      ? position.entryPrice + offset
      : position.entryPrice - offset;
    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';

    await this.orderGateway.sendStopLoss(
      position.symbol,
      closeSide,
      position.remainingQuantity,
      stopPrice
    );

    position.breakEvenActivated = true;
  }

  private async updateTrailingStop(position: PositionState, currentPrice: number): Promise<void> {
    let newStopPrice: number;

    if (position.side === 'BUY') {
      newStopPrice = Number((position.highestPrice * (1 - this.config.trailingStopPercent)).toFixed(2));
      
      if (newStopPrice > position.trailingStopPrice && newStopPrice > position.entryPrice) {
        const filter = this.orderGateway.getSymbolFilter(position.symbol);
        const minMove = 5 * filter.tickSize;
        const now = Date.now();

        // تجنب إرسال طلبات متكررة قبل مرور 60 ثانية أو تحرك السعر بأكثر من 5 تكات
        if (position.lastTrailingUpdate && now - position.lastTrailingUpdate < 60_000) return;
        if (position.trailingStopPrice > 0 && Math.abs(newStopPrice - position.trailingStopPrice) < minMove) return;

        position.trailingStopPrice = newStopPrice;
        position.lastTrailingUpdate = now;
        await this.updateStopLossOrder(position, newStopPrice);
        console.log(`📈 Trailing Stop updated for ${position.symbol}: $${newStopPrice.toFixed(2)} (High: $${position.highestPrice.toFixed(2)})`);
      }
    } else {
      newStopPrice = Number((position.lowestPrice * (1 + this.config.trailingStopPercent)).toFixed(2));
      
      if ((newStopPrice < position.trailingStopPrice || position.trailingStopPrice === 0) && newStopPrice < position.entryPrice) {
        const filter = this.orderGateway.getSymbolFilter(position.symbol);
        const minMove = 5 * filter.tickSize;
        const now = Date.now();

        if (position.lastTrailingUpdate && now - position.lastTrailingUpdate < 60_000) return;
        if (position.trailingStopPrice > 0 && Math.abs(newStopPrice - position.trailingStopPrice) < minMove) return;

        position.trailingStopPrice = newStopPrice;
        position.lastTrailingUpdate = now;
        await this.updateStopLossOrder(position, newStopPrice);
        console.log(`📈 Trailing Stop updated for ${position.symbol}: $${newStopPrice.toFixed(2)} (Low: $${position.lowestPrice.toFixed(2)})`);
      }
    }
  }

  private async updateStopLossOrder(position: PositionState, stopPrice: number): Promise<void> {
    await this.orderGateway.cancelProtectiveOrders(position.symbol, position.orderId);

    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    await this.orderGateway.sendStopLoss(
      position.symbol,
      closeSide,
      position.remainingQuantity,
      stopPrice
    );
  }

  public removePosition(orderId: string): void {
    this.activePositions.delete(orderId);
    console.log(`🗑️ Position removed from PartialProfitManager: ${orderId}`);
  }

  public removeBySymbol(symbol: AssetSymbol): void {
    for (const [orderId, pos] of this.activePositions.entries()) {
      if (pos.symbol === symbol) {
        this.activePositions.delete(orderId);
        console.log(`🗑️ PartialProfitManager: Cleaned up position for closed symbol ${symbol} (${orderId})`);
      }
    }
  }

  public getPositionState(orderId: string): PositionState | undefined {
    return this.activePositions.get(orderId);
  }

  public getPositionBySymbol(symbol: AssetSymbol): PositionState | undefined {
    return Array.from(this.activePositions.values()).find(p => p.symbol === symbol);
  }

  public getReport(): any {
    const positions = Array.from(this.activePositions.values());
    return {
      enabled: this.config.enabled,
      config: this.config,
      totalPositions: positions.length,
      partialProfitTakenCount: positions.filter(p => p.partialProfitTaken).length,
      breakEvenActivatedCount: positions.filter(p => p.breakEvenActivated).length,
      positions: positions.map(p => ({
        orderId: p.orderId,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        remainingQuantity: p.remainingQuantity,
        partialProfitTaken: p.partialProfitTaken,
        breakEvenActivated: p.breakEvenActivated,
        trailingStopPrice: p.trailingStopPrice,
        initialStopPrice: p.initialStopPrice,
        riskPerUnit: p.riskPerUnit,
        bestR: p.bestR,
        maxHoldMs: p.maxHoldMs,
        unrealizedPnl: p.side === 'BUY'
          ? (p.highestPrice - p.entryPrice) * p.remainingQuantity
          : (p.entryPrice - p.lowestPrice) * p.remainingQuantity,
      })),
    };
  }
}
