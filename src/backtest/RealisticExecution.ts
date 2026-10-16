export type ExecutionSide = 'BUY' | 'SELL';

export interface ExecutionRequest {
  side: ExecutionSide;
  referencePrice: number;
  quantity: number;
  candleVolume: number;
  feeRate: number;
  slippageBps: number;
  spreadBps: number;
  maxParticipation: number;
}

export interface ExecutionResult {
  filledQuantity: number;
  remainingQuantity: number;
  executionPrice: number;
  notional: number;
  fee: number;
}

export function simulateExecution(request: ExecutionRequest): ExecutionResult {
  if (request.referencePrice <= 0 || !Number.isFinite(request.referencePrice)) throw new Error('reference price must be positive');
  if (request.quantity < 0 || request.candleVolume < 0) throw new Error('quantity and volume must be non-negative');
  if (request.maxParticipation < 0 || request.maxParticipation > 1) throw new Error('participation must be between 0 and 1');
  const capacity = request.candleVolume * request.maxParticipation;
  const filledQuantity = Math.min(request.quantity, capacity);
  const remainingQuantity = request.quantity - filledQuantity;
  const impact = (request.slippageBps + request.spreadBps / 2) / 10_000;
  const executionPrice = request.referencePrice * (request.side === 'BUY' ? 1 + impact : 1 - impact);
  const notional = filledQuantity * executionPrice;
  return { filledQuantity, remainingQuantity, executionPrice, notional, fee: notional * request.feeRate };
}
