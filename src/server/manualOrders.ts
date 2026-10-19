import { createHash } from 'node:crypto';

export function orderResponse(order: any) {
  const rejected = order.status === 'REJECTED';
  return {
    statusCode: rejected ? 422 : order.status === 'FILLED' ? 200 : 202,
    body: { success: !rejected, order, executed: order.status === 'FILLED',
      ...(rejected ? { error: order.errorMessage || 'Order rejected' } : {}) },
  };
}

export async function submitManualOrder(storage: any, gateway: any, key: string, input: any) {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new Error('A 16–100 character Idempotency-Key is required');
  const params = { symbol: input.symbol, side: input.side, type: input.type || 'MARKET',
    quantity: Number(input.quantity), ...(input.price !== undefined ? { price: Number(input.price) } : {}) };
  if (typeof params.symbol !== 'string' || !/^[A-Z0-9]+\/[A-Z0-9]+$/.test(params.symbol) ||
      !['BUY', 'SELL'].includes(params.side) || !['MARKET', 'LIMIT'].includes(params.type) ||
      !Number.isFinite(params.quantity) || params.quantity <= 0 ||
      (params.price !== undefined && (!Number.isFinite(params.price) || params.price <= 0)) ||
      (params.type === 'LIMIT' && params.price === undefined)) throw new Error('Invalid order fields');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const id = `M_${hash(key).slice(0, 28)}`, requestHash = hash(JSON.stringify(params));
  // The durable claim precedes exchange I/O. A timed-out/unknown attempt is never
  // automatically resubmitted; reconcile by the stable exchange client order ID.
  const claim = await storage.claimOrder(id, requestHash);
  if (!claim.claimed) {
    if (claim.order.requestHash !== requestHash) return { statusCode: 409, body: { success: false, error: 'Idempotency key reused with different fields' } };
    return orderResponse(claim.order);
  }
  const order = gateway.submitOrder({ ...params, orderId: id, strategyId: 'MANUAL_UI' });
  await storage.saveOrder({ ...order, requestHash });
  return orderResponse(order);
}
