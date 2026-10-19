import { ExecutionLedgerFill, settleExecution } from '../execution/ExecutionLedger';
import { TradeRecord } from '../storage/DatabaseService';

export function settleTradeRecord(params: {
  trade: TradeRecord;
  entryFills: ExecutionLedgerFill[];
  exitFills: ExecutionLedgerFill[];
  fallbackExitPrice?: number;
}) {
  const entryFills = params.entryFills.length > 0
    ? params.entryFills
    : [{
      fillId: `LEGACY-ENTRY-${params.trade.id}`,
      orderId: params.trade.id,
      symbol: params.trade.symbol,
      side: params.trade.side,
      price: params.trade.price,
      quantity: params.trade.quantity,
      commission: params.trade.entryFee ?? params.trade.fee ?? 0,
      commissionAsset: 'USDT',
      timestamp: params.trade.timestamp,
      isMaker: false,
    }];
  const exitFills = params.exitFills.length > 0
    ? params.exitFills
    : params.fallbackExitPrice && params.fallbackExitPrice > 0
      ? [{
        fillId: `FALLBACK-EXIT-${params.trade.id}`,
        orderId: `FALLBACK-${params.trade.id}`,
        symbol: params.trade.symbol,
        side: params.trade.side === 'BUY' ? 'SELL' : 'BUY' as 'BUY' | 'SELL',
        price: params.fallbackExitPrice,
        quantity: params.trade.quantity,
        commission: 0,
        commissionAsset: 'USDT',
        timestamp: Date.now(),
        isMaker: false,
      }]
      : [];
  const settled = settleExecution({
    side: params.trade.side,
    entryFills,
    exitFills,
    entryReferencePrice: params.trade.entryReferencePrice,
    exitReferencePrice: params.trade.exitReferencePrice,
  });
  return settled ? { ...settled, executionSource: params.exitFills.length > 0 ? 'ACTUAL_FILLS' as const : 'FALLBACK_MARK' as const, entryFills, exitFills } : null;
}
