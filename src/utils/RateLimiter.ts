// src/utils/RateLimiter.ts

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  weight?: number;
}

export interface RateLimitStatus {
  used: number;
  limit: number;
  remaining: number;
  resetTime: number;
  isApproachingLimit: boolean;
}

export type BinanceRequestPriority = 'exit' | 'account' | 'market' | 'maintenance';

export interface BinanceRequestOptions extends Omit<RequestInit, 'priority'> {
  weight?: number;
  priority?: BinanceRequestPriority;
}

export interface BinanceQuarantineStatus {
  active: boolean;
  until: number;
  remainingMs: number;
  reason: '429' | '418' | null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Serializes reservations and request execution so concurrent callers cannot overshoot the IP budget. */
export class BinanceRestGate {
  private tail: Promise<unknown> = Promise.resolve();

  public run<T>(task: () => Promise<T>): Promise<T> {
    const execute = () => task();
    const result = this.tail.then(execute, execute);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

interface UsageSample {
  at: number;
  weight: number;
}

export class RateLimiter {
  private readonly requestLog = new Map<string, UsageSample[]>();
  private readonly configs = new Map<string, RateLimitConfig>();
  private readonly globalLimit: RateLimitConfig = { maxRequests: 2400, windowMs: 60_000 };
  private readonly gate = new BinanceRestGate();
  private serverUsedWeight = 0;
  private serverUsedAt = 0;
  private readonly safeWeightLimit = 1500;
  private blockedUntil = 0;
  private blockedReason: '429' | '418' | null = null;
  private lastOrderCount = 0;

  constructor() {
    this.configs.set('/fapi/v1/order', { maxRequests: 300, windowMs: 10_000, weight: 1 });
    this.configs.set('/fapi/v1/account', { maxRequests: 2400, windowMs: 60_000, weight: 20 });
    this.configs.set('/fapi/v2/account', { maxRequests: 2400, windowMs: 60_000, weight: 20 });
    this.configs.set('/fapi/v1/positionRisk', { maxRequests: 2400, windowMs: 60_000, weight: 10 });
    this.configs.set('/fapi/v2/positionRisk', { maxRequests: 2400, windowMs: 60_000, weight: 10 });
    console.log(`🚦 RateLimiter initialized (safe IP weight budget: ${this.safeWeightLimit}/2400 per minute)`);
  }

  private endpointConfig(endpoint: string): RateLimitConfig {
    return this.configs.get(endpoint) || this.globalLimit;
  }

  private clean(key: string, now = Date.now()): UsageSample[] {
    const config = this.endpointConfig(key);
    const samples = (this.requestLog.get(key) || []).filter(sample => now - sample.at < config.windowMs);
    this.requestLog.set(key, samples);
    return samples;
  }

  private localWeight(now = Date.now()): number {
    return this.clean('__global_weight__', now).reduce((sum, sample) => sum + sample.weight, 0);
  }

  private observedWeight(now = Date.now()): number {
    return now - this.serverUsedAt < 60_000 ? this.serverUsedWeight : 0;
  }

  private nextWait(endpoint: string, weight: number, now = Date.now()): number {
    const config = this.endpointConfig(endpoint);
    const endpointSamples = this.clean(endpoint, now);
    const endpointUsed = endpointSamples.reduce((sum, sample) => sum + sample.weight, 0);
    const observed = this.observedWeight(now);
    const local = this.localWeight(now);

    let wait = Math.max(0, this.blockedUntil - now);
    if (observed + local + weight > this.safeWeightLimit) {
      const oldest = this.clean('__global_weight__', now)[0];
      wait = Math.max(wait, oldest ? oldest.at + 60_000 - now + 100 : 1_000);
    }
    if (endpointUsed + weight > config.maxRequests) {
      const oldest = endpointSamples[0];
      wait = Math.max(wait, oldest ? oldest.at + config.windowMs - now + 100 : 1_000);
    }
    return wait;
  }

  private reserve(endpoint: string, weight: number, at = Date.now()): void {
    const endpointSamples = this.requestLog.get(endpoint) || [];
    endpointSamples.push({ at, weight });
    this.requestLog.set(endpoint, endpointSamples);
    const globalSamples = this.requestLog.get('__global_weight__') || [];
    globalSamples.push({ at, weight });
    this.requestLog.set('__global_weight__', globalSamples);
  }

  private async reserveInternal(endpoint: string, weight: number): Promise<boolean> {
    for (;;) {
      const wait = this.nextWait(endpoint, weight);
      if (wait > 0) {
        await sleep(Math.min(wait, 60_000));
        continue;
      }
      this.reserve(endpoint, weight);
      return true;
    }
  }

  /** Compatibility API. Reservations are serialized through the shared gate. */
  public acquire(endpoint: string, weight = 1): Promise<boolean> {
    return this.gate.run(() => this.reserveInternal(endpoint, weight));
  }

  /** Compatibility API retained for existing callers. */
  public checkRateLimit(endpoint: string): Promise<boolean> {
    const config = this.endpointConfig(endpoint);
    return this.acquire(endpoint, config.weight || 1);
  }

  public getRateLimitStatus(endpoint: string): RateLimitStatus {
    const now = Date.now();
    const config = this.endpointConfig(endpoint);
    const samples = this.clean(endpoint, now);
    const localUsed = samples.reduce((sum, sample) => sum + sample.weight, 0);
    const used = Math.max(localUsed, this.observedWeight(now));
    return {
      used,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - used),
      resetTime: samples.length ? samples[0].at + config.windowMs : now,
      isApproachingLimit: used >= config.maxRequests * 0.8,
    };
  }

  private isBinanceUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'binance.com' || host.endsWith('.binance.com') ||
        host.endsWith('.binance.info') || host.endsWith('.binancefuture.com');
    } catch {
      return false;
    }
  }

  /** All Binance REST traffic must use this method. It serializes the network call itself. */
  public fetch(input: RequestInfo | URL, init?: RequestInit, weight = 1, priority: BinanceRequestPriority = 'market'): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!this.isBinanceUrl(url)) return fetch(input, init);
    const endpoint = new URL(url).pathname;

    return this.gate.run(async () => {
      if (this.isQuarantined()) {
        throw new Error(`Binance REST quarantine active for ${this.getQuarantineStatus().remainingMs}ms`);
      }
      await this.reserveInternal(endpoint, weight);
      const response = await fetch(input, init);
      this.observeResponse(response);
      return response;
    });
  }

  private observeResponse(response: Response): void {
    const used = Number(response.headers.get('x-mbx-used-weight-1m') || 0);
    if (Number.isFinite(used)) this.syncUsed(used);
    const orderCount = Number(response.headers.get('x-mbx-order-count-10s') || 0);
    if (Number.isFinite(orderCount)) this.lastOrderCount = orderCount;
    if (response.status === 429 || response.status === 418) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const fallback = response.status === 418 ? 15 * 60_000 : 60_000;
      const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallback) +
        Math.floor(Math.random() * (response.status === 418 ? 10_000 : 1_000));
      this.blockFor(wait, response.status === 418 ? '418' : '429');
      console.warn(`🛑 Binance HTTP ${response.status}; REST quarantine ${wait}ms`);
    }
  }

  public syncUsed(usedWeight: number): void {
    if (!Number.isFinite(usedWeight) || usedWeight < 0) return;
    this.serverUsedWeight = usedWeight;
    this.serverUsedAt = Date.now();
    if (usedWeight >= this.safeWeightLimit) {
      console.warn(`⚠️ Binance IP weight near safety ceiling: ${usedWeight}/${this.safeWeightLimit}`);
    }
  }

  public blockFor(ms: number, reason: '429' | '418' = '429'): void {
    const bounded = Math.max(ms, reason === '418' ? 60_000 : 1_000);
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + bounded);
    this.blockedReason = reason;
  }

  public isQuarantined(): boolean {
    return this.blockedUntil > Date.now();
  }

  public getQuarantineStatus(): BinanceQuarantineStatus {
    const remainingMs = Math.max(0, this.blockedUntil - Date.now());
    return { active: remainingMs > 0, until: this.blockedUntil, remainingMs, reason: remainingMs > 0 ? this.blockedReason : null };
  }

  public async backoff(ms = 60_000): Promise<void> {
    this.blockFor(ms, '429');
    await sleep(Math.max(0, this.blockedUntil - Date.now()));
  }

  public handleBinanceRateLimitResponse(headers: Headers | Record<string, string>): void {
    const get = (key: string) => headers instanceof Headers ? headers.get(key) : headers[key] || headers[key.toLowerCase()];
    const used = Number(get('x-mbx-used-weight-1m') || 0);
    const orders = Number(get('x-mbx-order-count-10s') || 0);
    if (used || orders) console.log(`Binance limits: weight=${used}/2400 orders=${orders}/300`);
  }

  public async smartDelay(endpoint: string): Promise<void> {
    const status = this.getRateLimitStatus(endpoint);
    if (status.isApproachingLimit) await sleep(1_000);
    else if (status.remaining < status.limit * 0.5) await sleep(500);
  }

  public async handle429Error(endpoint: string, retryCount = 0): Promise<void> {
    if (retryCount >= 3) throw new Error(`Rate limit exceeded after 3 retries for ${endpoint}`);
    await this.backoff(Math.pow(2, retryCount) * 1_000);
  }

  public getFullReport(): string {
    let report = '🚦 Rate Limiter Report\n━━━━━━━━━━━━━━━━━━━━\n\n';
    this.configs.forEach((_config, endpoint) => {
      const status = this.getRateLimitStatus(endpoint);
      report += `${endpoint}\n  Used: ${status.used}/${status.limit}\n  Remaining: ${status.remaining}\n  Status: ${status.isApproachingLimit ? '⚠️ APPROACHING LIMIT' : '✅ OK'}\n\n`;
    });
    const quarantine = this.getQuarantineStatus();
    report += `Quarantine: ${quarantine.active ? `${quarantine.reason} ${quarantine.remainingMs}ms` : 'none'}\n`;
    report += `Orders (10s): ${this.lastOrderCount}/300\n`;
    return report;
  }
}

/** Shared process-wide limiter for all Binance REST modules. */
export const binanceRateLimiter = new RateLimiter();
