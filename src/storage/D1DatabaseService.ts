import { DatabaseService, TradeRecord, SignalRecord, BalanceSnapshot, PriceRecord } from './DatabaseService.ts';

export class D1ApiError extends Error {
  constructor(public readonly status: number) { super(`D1 API ${status}`); }
}

/** Remote D1-backed storage through Cloudflare Worker HTTP API. */
export class D1DatabaseService extends DatabaseService {
  private readonly base: string;
  private readonly secret: string;
  constructor(baseUrl = process.env.D1_API_URL || '', secret = process.env.D1_API_SECRET || '') {
    super('__d1_disabled__.json', false);
    if (!baseUrl || !secret) throw new Error('D1_API_URL and D1_API_SECRET are required');
    this.base = baseUrl.replace(/\/$/, '');
    this.secret = secret;
  }
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (this.secret) headers.set('Authorization', `Bearer ${this.secret}`);
    const r = await fetch(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(5000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new D1ApiError(r.status);
    return body as T;
  }
  async ping() { return this.call<{ ok: boolean }>('/d1/health'); }
  async saveTrade(trade: TradeRecord) { await this.call('/d1/trades', { method: 'POST', body: JSON.stringify(trade) }); }
  async getOpenTrades(symbol?: string) { const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''; return (await this.call<{ items: TradeRecord[] }>(`/d1/trades/open${q}`)).items; }
  async getAllTrades(symbol?: string) { const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''; return (await this.call<{ items: TradeRecord[] }>(`/d1/trades${q}`)).items; }
  async closeTrade(id: string, pnl: number, exitPrice?: number, fee?: number, details?: Partial<TradeRecord>) { await this.call(`/d1/trades/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pnl, exitPrice, fee, ...details }) }); }
  async saveSignal(signal: SignalRecord) { await this.call('/d1/signals', { method: 'POST', body: JSON.stringify(signal) }); }
  async saveBalanceSnapshot(equity: number, freeMargin: number, unrealizedPnl: number) { await this.call('/d1/balances', { method: 'POST', body: JSON.stringify({ equity, freeMargin, unrealizedPnl }) }); }
  async saveState(key: string, value: any) { await this.call(`/d1/state/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }); }
  async getState<T>(key: string) { const r = await this.call<{ value?: T }>(`/d1/state/${encodeURIComponent(key)}`); return r.value ?? null; }
  async savePrice(symbol: string, price: number) { await this.call('/d1/prices', { method: 'POST', body: JSON.stringify({ symbol, price }) }); }
  async getPriceHistory(symbol: string, limit = 100) { return (await this.call<{ items: PriceRecord[] }>(`/d1/prices/${encodeURIComponent(symbol)}?limit=${limit}`)).items; }
  async saveShadowComparison(comparison: any) { await this.call('/d1/council/shadow', { method: 'POST', body: JSON.stringify(comparison) }); }
  async getShadowComparisons(limit = 100) {
    return (await this.call<{ items: any[] }>(`/d1/council/shadow?limit=${Math.max(1, Math.min(1000, limit))}`)).items;
  }
  async acquireLease(name: string, owner: string) {
    try {
      return await this.call<{ acquired: boolean; expiresAt: number }>(`/d1/leases/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ owner }) });
    } catch (error) {
      if (error instanceof D1ApiError && error.status === 409) return { acquired: false, expiresAt: 0 };
      throw error;
    }
  }
  async releaseLease(name: string, owner: string) {
    return this.call(`/d1/leases/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'X-Lease-Owner': owner } });
  }
  async claimOrder(id: string, requestHash: string) {
    return this.call<{ claimed: boolean; order: any }>('/d1/orders/claim', { method: 'POST', body: JSON.stringify({ id, requestHash }) });
  }
  async saveOrder(order: any) {
    return this.call(`/d1/orders/${encodeURIComponent(order.id)}`, { method: 'PUT', body: JSON.stringify(order) });
  }
  async getOrders(limit = 200) {
    return (await this.call<{ items: any[] }>(`/d1/orders?limit=${Math.max(1, Math.min(1000, limit))}`)).items;
  }
  close() { /* remote service has no local handle */ }
}
