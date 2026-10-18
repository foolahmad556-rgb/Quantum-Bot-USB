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

export class RateLimiter {
    private requestLog: Map<string, number[]> = new Map();
    private configs: Map<string, RateLimitConfig> = new Map();
    private globalLimit: RateLimitConfig;
    private serverUsedWeight = 0;
    private serverUsedAt = 0;
    private readonly safeWeightLimit = 1920; // keep 20% headroom below Binance's 1m limit
    private readonly cooldownUntil = new Map<string, number>();
    private blockedUntil = 0;
    private readonly requestStartTimes = new Map<string, number[]>();

    constructor() {
        this.globalLimit = {
            maxRequests: 2400, // 2400 requests/minute for Binance Futures
            windowMs: 60000
        };

        this.configs.set('/fapi/v1/order', {
            maxRequests: 300, // 300 orders per 10 seconds
            windowMs: 10000,
            weight: 1
        });

        this.configs.set('/fapi/v1/positionRisk', {
            maxRequests: 2400,
            windowMs: 60000,
            weight: 10
        });

        this.configs.set('/fapi/v1/account', {
            maxRequests: 2400,
            windowMs: 60000,
            weight: 20
        });

        console.log('🚦 RateLimiter initialized with Binance Futures limits');
    }

    /**
     * Check if request can be made, wait if necessary
     */
    public async checkRateLimit(endpoint: string): Promise<boolean> {
        const config = this.configs.get(endpoint) || this.globalLimit;
            const now = Date.now();
            const cooldown = Math.max(this.blockedUntil, this.cooldownUntil.get(endpoint) || 0);
            if (cooldown > now) {
                await new Promise(resolve => setTimeout(resolve, cooldown - now));
            }

            const key = endpoint;
            this.cleanOldRequests(key, config.windowMs, Date.now());
            let requests = this.requestLog.get(key) || [];
            let totalWeight = requests.reduce((sum, _time) => sum + (config.weight || 1), 0);
            const observed = Date.now() - this.serverUsedAt < 60_000 ? this.serverUsedWeight : 0;
            const waitForObservedWindow = observed >= this.safeWeightLimit && this.serverUsedAt > 0
                ? this.serverUsedAt + 60_000 - Date.now() + 100
                : 0;
            const waitForEndpointWindow = totalWeight >= config.maxRequests && requests.length
                ? requests[0] + config.windowMs - Date.now() + 100
                : 0;
            const waitTime = Math.max(waitForObservedWindow, waitForEndpointWindow);
            if (waitTime > 0) {
                console.warn(`⚠️ Rate budget reached for ${endpoint}; waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.checkRateLimit(endpoint);
            }

            if (!this.requestLog.has(key)) this.requestLog.set(key, []);
            this.requestLog.get(key)!.push(Date.now());
            const starts = this.requestStartTimes.get(endpoint) || [];
            this.requestStartTimes.set(endpoint, starts.filter(t => Date.now() - t < 10_000).concat(Date.now()));
            return true;
    }

    public getRateLimitStatus(endpoint: string): RateLimitStatus {
        const now = Date.now();
        const config = this.configs.get(endpoint) || this.globalLimit;
        const key = endpoint;

        this.cleanOldRequests(key, config.windowMs, now);

        const requests = this.requestLog.get(key) || [];
        const localUsed = requests.length * (config.weight || 1);
        const observed = Date.now() - this.serverUsedAt < 60_000 ? this.serverUsedWeight : 0;
        const used = Math.max(localUsed, observed);
        const remaining = Math.max(0, config.maxRequests - used);

        return {
            used,
            limit: config.maxRequests,
            remaining,
            resetTime: requests.length > 0 ? requests[0] + config.windowMs : now,
            isApproachingLimit: remaining < config.maxRequests * 0.2
        };
    }

    public async acquire(endpoint: string, weight: number = 1): Promise<boolean> {
        const now = Date.now();
        const observed = now - this.serverUsedAt < 60_000 ? this.serverUsedWeight : 0;
        const local = this.requestLog.get('__global_weight__') || [];
        this.cleanOldRequests('__global_weight__', 60_000, now);
        const log = this.requestLog.get('__global_weight__') || [];
        const localUsed = log.length;
        if (observed + localUsed + weight > this.safeWeightLimit) {
            const wait = this.serverUsedAt > 0 && observed > 0
                ? Math.max(100, this.serverUsedAt + 60_000 - now + 100)
                : Math.max(100, (log[0] || now) + 60_000 - now + 100);
            console.warn(`⚠️ Binance weight safety budget reached; waiting ${wait}ms before ${endpoint}`);
            await new Promise(resolve => setTimeout(resolve, wait));
            return this.acquire(endpoint, weight);
        }
        if (!local.length) this.requestLog.set('__global_weight__', []);
        for (let i = 0; i < weight; i++) this.requestLog.get('__global_weight__')!.push(now);
        return this.checkRateLimit(endpoint);
    }

    /** Rate-limited fetch for Binance endpoints; leaves non-Binance traffic untouched. */
    public async fetch(input: RequestInfo | URL, init?: RequestInit, weight = 1): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!/(^|\.)binance\.(com|info)(\/|:|$)/i.test(new URL(url).host + '/')) {
            return fetch(input, init);
        }
        const endpoint = new URL(url).pathname;
        await this.acquire(endpoint, weight);
        const response = await fetch(input, init);
        const used = Number(response.headers.get('x-mbx-used-weight-1m') || 0);
        if (Number.isFinite(used)) this.syncUsed(used);
        if (response.status === 429 || response.status === 418) {
            const raw = Number(response.headers.get('retry-after'));
            this.blockFor(Number.isFinite(raw) && raw > 0 ? raw * 1000 : 60_000);
        }
        return response;
    }

    public syncUsed(usedWeight: number): void {
        if (Number.isFinite(usedWeight) && usedWeight >= 0) {
            this.serverUsedWeight = usedWeight;
            this.serverUsedAt = Date.now();
            if (usedWeight >= this.safeWeightLimit) {
                console.warn(`🚨 Binance weight safety threshold reached: ${usedWeight}/2400`);
            }
        }
    }

    public blockFor(ms: number): void {
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + Math.max(ms, 60_000));
    }

    public async backoff(ms: number = 60000): Promise<void> {
        console.warn(`🛑 RateLimiter backing off for ${ms}ms due to exchange 429/418`);
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    public handleBinanceRateLimitResponse(headers: any): void {
        const limit = parseInt(headers['x-mbx-used-weight-1m'] || '0');
        const orderLimit = parseInt(headers['x-mbx-order-count-10s'] || '0');

        if (limit > 0 || orderLimit > 0) {
            console.log(` Binance Rate Limit Status:`);
            console.log(`   Used Weight (1min): ${limit}/2400`);
            console.log(`   Orders (10s): ${orderLimit}/300`);
        }
    }

    private cleanOldRequests(key: string, windowMs: number, now: number) {
        const requests = this.requestLog.get(key) || [];
        const cutoff = now - windowMs;
        const filtered = requests.filter(timestamp => timestamp > cutoff);
        this.requestLog.set(key, filtered);
    }

    public async smartDelay(endpoint: string): Promise<void> {
        const status = this.getRateLimitStatus(endpoint);

        if (status.isApproachingLimit) {
            const delay = 1000;
            console.log(`⏳ Smart delay: ${delay}ms (approaching rate limit)`);
            await new Promise(resolve => setTimeout(resolve, delay));
        } else if (status.remaining < status.limit * 0.5) {
            const delay = 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    public async handle429Error(endpoint: string, retryCount: number = 0): Promise<void> {
        const maxRetries = 3;
        if (retryCount >= maxRetries) {
            throw new Error(`Rate limit exceeded after ${maxRetries} retries for ${endpoint}`);
        }

        const backoffTime = Math.pow(2, retryCount) * 1000;
        console.warn(`⚠️ 429 Error for ${endpoint}. Retrying in ${backoffTime}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
    }

    public getFullReport(): string {
        let report = `🚦 Rate Limiter Report\n`;
        report += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        this.configs.forEach((config, endpoint) => {
            const status = this.getRateLimitStatus(endpoint);
            const usagePercent = (status.used / status.limit) * 100;

            report += `${endpoint}\n`;
            report += `  Used: ${status.used}/${status.limit} (${usagePercent.toFixed(1)}%)\n`;
            report += `  Remaining: ${status.remaining}\n`;
            report += `  Status: ${status.isApproachingLimit ? '⚠️ APPROACHING LIMIT' : '✅ OK'}\n\n`;
        });

        return report;
    }
}

/** Shared process-wide limiter for all Binance REST modules. */
export const binanceRateLimiter = new RateLimiter();
