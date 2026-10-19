import type { Fill, OrderSide } from '../domain/types';

export interface ExecutionLedgerFill {
  fillId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  commission: number;
  commissionAsset: string;
  timestamp: number;
  isMaker: boolean;
}

export interface SettledExecution {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  totalFees: number;
  netPnl: number;
  entryFee: number;
  exitFee: number;
  entrySlippageBps: number;
  exitSlippageBps: number;
}

export function toExecutionLedgerFill(fill: Fill): ExecutionLedgerFill {
  return {
    fillId: fill.fillId,
    orderId: fill.orderId,
    symbol: fill.symbol,
    side: fill.side,
    price: fill.price,
    quantity: fill.quantity,
    commission: fill.commission,
    commissionAsset: fill.commissionAsset,
    timestamp: fill.timestamp,
    isMaker: fill.isMaker,
  };
}

/** Insert a fill exactly once. Exchange reconnects may replay the same trade event. */
export function appendUniqueFill(fills: ExecutionLedgerFill[], fill: ExecutionLedgerFill): ExecutionLedgerFill[] {
  if (fills.some((item) => item.fillId === fill.fillId)) return fills;
  fills.push(fill);
  return fills;
}

export function weightedAveragePrice(fills: ExecutionLedgerFill[]): number {
  const valid = fills.filter((fill) => Number.isFinite(fill.price) && fill.price > 0 && Number.isFinite(fill.quantity) && fill.quantity > 0);
  const quantity = valid.reduce((sum, fill) => sum + fill.quantity, 0);
  return quantity > 0 ? valid.reduce((sum, fill) => sum + fill.price * fill.quantity, 0) / quantity : 0;
}

export function totalFillQuantity(fills: ExecutionLedgerFill[]): number {
  return fills.reduce((sum, fill) => sum + (Number.isFinite(fill.quantity) && fill.quantity > 0 ? fill.quantity : 0), 0);
}

export function totalCommission(fills: ExecutionLedgerFill[]): number {
  return fills.reduce((sum, fill) => {
    const quoteCommission = fill.commissionAsset === 'USDT' || fill.commissionAsset === 'USDC';
    return sum + (quoteCommission && Number.isFinite(fill.commission) && fill.commission > 0 ? fill.commission : 0);
  }, 0);
}

/** Allocate an exit fill stream to one open trade, preserving fee proportionality. */
export function takeFillQuantity(fills: ExecutionLedgerFill[], targetQuantity: number): ExecutionLedgerFill[] {
  let remaining = Math.max(0, targetQuantity);
  const allocated: ExecutionLedgerFill[] = [];
  for (const fill of fills) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, fill.quantity);
    if (quantity <= 0) continue;
    allocated.push({ ...fill, quantity, commission: fill.commission * (quantity / fill.quantity) });
    fill.quantity -= quantity;
    fill.commission -= fill.commission * (quantity / (fill.quantity + quantity));
    remaining -= quantity;
  }
  return allocated;
}

/** Positive bps means adverse execution relative to the decision/reference price. */
export function adverseSlippageBps(side: OrderSide, referencePrice: number, actualPrice: number): number {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(actualPrice) || actualPrice <= 0) return 0;
  const adverseMove = side === 'BUY' ? actualPrice - referencePrice : referencePrice - actualPrice;
  return Number(((adverseMove / referencePrice) * 10_000).toFixed(3));
}

export function settleExecution(params: {
  side: OrderSide;
  entryFills: ExecutionLedgerFill[];
  exitFills: ExecutionLedgerFill[];
  entryReferencePrice?: number;
  exitReferencePrice?: number;
}): SettledExecution | null {
  const quantity = Math.min(totalFillQuantity(params.entryFills), totalFillQuantity(params.exitFills));
  const entryPrice = weightedAveragePrice(params.entryFills);
  const exitPrice = weightedAveragePrice(params.exitFills);
  if (quantity <= 0 || entryPrice <= 0 || exitPrice <= 0) return null;

  const grossPnl = params.side === 'BUY'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity;
  const entryFee = totalCommission(params.entryFills);
  const exitFee = totalCommission(params.exitFills);
  const totalFees = entryFee + exitFee;

  return {
    entryPrice: Number(entryPrice.toFixed(8)),
    exitPrice: Number(exitPrice.toFixed(8)),
    quantity: Number(quantity.toFixed(8)),
    grossPnl: Number(grossPnl.toFixed(8)),
    totalFees: Number(totalFees.toFixed(8)),
    netPnl: Number((grossPnl - totalFees).toFixed(8)),
    entryFee: Number(entryFee.toFixed(8)),
    exitFee: Number(exitFee.toFixed(8)),
    entrySlippageBps: adverseSlippageBps(params.side, params.entryReferencePrice || entryPrice, entryPrice),
    exitSlippageBps: adverseSlippageBps(params.side === 'BUY' ? 'SELL' : 'BUY', params.exitReferencePrice || exitPrice, exitPrice),
  };
}
