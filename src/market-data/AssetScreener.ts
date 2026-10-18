import { binanceRateLimiter } from '../utils/RateLimiter';
import { AssetSymbol } from '../domain/types';

export interface AssetMetrics {
  symbol: AssetSymbol;
  cleanSymbol: string;          // BTCUSDT (بدون /)

  // مقاييس السيولة
  spreadPercent: number;        // السبريد بالنسبة المئوية
  bidAskDepth: number;          // عمق دفتر الأوامر ($)
  volume24h: number;            // حجم التداول 24 ساعة ($)

  // مقاييس الاستقرار
  priceChange24h: number;       // تغير السعر 24 ساعة (%)
  volatility24h: number;        // التقلب 24 ساعة
  stabilityScore: number;       // درجة الاستقرار (0-1)

  // مقاييس التكلفة
  makerFee: number;             // رسوم Maker
  takerFee: number;             // رسوم Taker

  // معلومات عامة
  minNotional: number;          // الحد الأدنى للصفقة ($)
  minQuantity: number;          // الحد الأدنى للكمية
  stepSize: number;             // دقة الكمية (LOT_SIZE)
  tickSize: number;             // دقة السعر (PRICE_FILTER)
  maxLeverage: number;          // الحد الأقصى للرافعة
  minLeverage: number;          // الحد الأدنى للرافعة

  // النتيجة النهائية
  liquidityScore: number;       // درجة السيولة (0-100)
  isQualified: boolean;         // هل العملة مؤهلة؟
  disqualificationReasons: string[]; // أسباب عدم الأهلية
}

export function formatQuantityToStep(quantity: number, stepSize: number = 0.001): number {
  if (!stepSize || stepSize <= 0) return Number(quantity.toFixed(3));
  const precision = Math.max(0, Math.round(-Math.log10(stepSize)));
  const factor = Math.pow(10, precision);
  const rounded = Math.floor(quantity * factor) / factor;
  return Number(rounded.toFixed(precision));
}

export function formatPriceToTick(price: number, tickSize: number = 0.01): number {
  if (!tickSize || tickSize <= 0) return Number(price.toFixed(2));
  const precision = Math.max(0, Math.round(-Math.log10(tickSize)));
  return Number(price.toFixed(precision));
}

export interface ScreenerConfig {
  maxSpreadPercent: number;      // أقصى سبريد مقبول (مثلا 0.3%)
  minVolume24h: number;          // أدنى حجم تداول 24 ساعة ($1M)
  minBidAskDepth: number;        // أدنى عمق دفتر أوامر ($50K)
  maxVolatility24h: number;      // أقصى تقلب مقبول (15%)
  minStabilityScore: number;     // أدنى درجة استقرار (60%)
  maxTakerFee: number;           // أقصى رسوم Taker مقبولة (0.05%)
  refreshIntervalMs: number;     // فترة تحديث البيانات
}

export class AssetScreener {
  private apiBaseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private config: ScreenerConfig;
  private qualifiedAssets: Map<AssetSymbol, AssetMetrics> = new Map();
  private allAssets: Map<AssetSymbol, AssetMetrics> = new Map();
  private lastRefreshTime: number = 0;

  constructor(apiBaseUrl?: string, apiKey?: string, apiSecret?: string) {
    this.apiBaseUrl = apiBaseUrl || 'https://fapi.binance.com';
    this.apiKey = apiKey || '';
    this.apiSecret = apiSecret || '';

    // إعدادات الفلتر الافتراضية
    this.config = {
      maxSpreadPercent: 0.3,       // 0.3% كحد أقصى
      minVolume24h: 1000000,       // $1M حجم 24 ساعة
      minBidAskDepth: 50000,       // $50K عمق دفتر أوامر
      maxVolatility24h: 0.15,      // 15% تقلب 24 ساعة
      minStabilityScore: 0.6,      // 60% استقرار
      maxTakerFee: 0.0005,         // 0.05% رسوم Taker
      refreshIntervalMs: 60 * 60 * 1000, // تحديث كل ساعة
    };

    // Fail closed: assets remain unqualified until exchange data is fetched and validated.
  }

  /**
   * جلب وتحليل جميع العملات (يُستدعى دورياً كل ساعة)
   */
  public async refreshAllAssets(): Promise<number> {
    console.log('🔍 AssetScreener: Refreshing all assets from exchange API...');

    try {
      // 1. جلب معلومات الأزواج من Binance Futures API
      const exchangeInfo = await this.fetchExchangeInfo();

      // 2. جلب بيانات 24 ساعة
      const tickerData = await this.fetch24hrTicker();

      if (!exchangeInfo?.symbols || !Array.isArray(tickerData)) {
        this.allAssets.clear();
        this.qualifiedAssets.clear();
        this.lastRefreshTime = 0;
        console.warn('AssetScreener: exchange data unavailable; no assets qualified.');
        return 0;
      }

      let qualifiedCount = 0;
      const newAllAssets = new Map<AssetSymbol, AssetMetrics>();
      const newQualifiedAssets = new Map<AssetSymbol, AssetMetrics>();

      for (const symbolInfo of exchangeInfo.symbols) {
        if (symbolInfo.status !== 'TRADING') continue;
        if (symbolInfo.contractType && symbolInfo.contractType !== 'PERPETUAL') continue;
        if (!symbolInfo.symbol.endsWith('USDT') && !symbolInfo.symbol.endsWith('USD')) continue;

        const symbol = this.toAssetSymbol(symbolInfo.symbol);
        const ticker = tickerData.find((t: any) => t.symbol === symbolInfo.symbol);

        if (!ticker || !['quoteVolume', 'priceChangePercent', 'highPrice', 'lowPrice', 'bidPrice', 'askPrice']
          .every((key) => Number.isFinite(Number(ticker[key])) && Number(ticker[key]) > 0)) continue;

        // Require observed book depth; ticker volume cannot stand in for order-book liquidity.
        let depth: { bidDepth: number; askDepth: number; spread: number };
        try {
          depth = await this.fetchOrderBookDepth(symbolInfo.symbol);
        } catch {
          continue;
        }

        const metrics = this.calculateMetrics(symbolInfo, ticker, depth);
        this.applyFilters(metrics);

        newAllAssets.set(symbol, metrics);
        if (metrics.isQualified) {
          newQualifiedAssets.set(symbol, metrics);
          qualifiedCount++;
        }
      }

      // Replace snapshot even when empty; never keep stale qualified assets after failed refresh.
      this.allAssets = newAllAssets;
      this.qualifiedAssets = newQualifiedAssets;

      this.lastRefreshTime = Date.now();
      console.log(`✅ AssetScreener: ${this.qualifiedAssets.size} qualified out of ${this.allAssets.size} total assets`);

      return this.qualifiedAssets.size;
    } catch (error) {
      this.allAssets.clear();
      this.qualifiedAssets.clear();
      this.lastRefreshTime = 0;
      console.error('AssetScreener: refresh failed; cleared qualified assets to avoid stale market data:', error);
      return 0;
    }
  }

  /**
   * جلب معلومات الأزواج من Binance
   */
  private async fetchExchangeInfo(): Promise<any> {
    try {
      const url = `${this.apiBaseUrl}/fapi/v1/exchangeInfo`;
      const response = await binanceRateLimiter.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      return await response.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * جلب بيانات 24 ساعة
   */
  private async fetch24hrTicker(): Promise<any[]> {
    try {
      const url = `${this.apiBaseUrl}/fapi/v1/ticker/24hr`;
      const response = await binanceRateLimiter.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      return await response.json();
    } catch (e) {
      return [];
    }
  }

  /**
   * جلب عمق دفتر الأوامر (أعلى 20 مستوى)
   */
  private async fetchOrderBookDepth(symbol: string): Promise<any> {
    const url = `${this.apiBaseUrl}/fapi/v1/depth?symbol=${symbol}&limit=20`;
    const response = await binanceRateLimiter.fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    let bidDepth = 0;
    let askDepth = 0;

    if (data.bids) {
      for (const bid of data.bids) {
        bidDepth += parseFloat(bid[0]) * parseFloat(bid[1]);
      }
    }

    if (data.asks) {
      for (const ask of data.asks) {
        askDepth += parseFloat(ask[0]) * parseFloat(ask[1]);
      }
    }

    const bestBid = data.bids?.[0] ? parseFloat(data.bids[0][0]) : 1;
    const bestAsk = data.asks?.[0] ? parseFloat(data.asks[0][0]) : 1;
    const spread = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0.05;

    return { bidDepth, askDepth, spread };
  }

  /**
   * حساب المقاييس للزوج
   */
  private calculateMetrics(symbolInfo: any, ticker: any, depth: any): AssetMetrics {
    const symbol = this.toAssetSymbol(symbolInfo.symbol);

    const spreadPercent = depth.spread;
    const bidAskDepth = Math.min(depth.bidDepth, depth.askDepth);
    const volume24h = Number(ticker.quoteVolume);

    const priceChange24h = Number(ticker.priceChangePercent);
    const highPrice = Number(ticker.highPrice);
    const lowPrice = Number(ticker.lowPrice);
    const volatility24h = ((highPrice - lowPrice) / lowPrice);

    const stabilityScore = Math.max(0, Math.min(1, 1 - (volatility24h / 0.20)));

    const makerFee = 0.0002; // 0.02%
    const takerFee = 0.0004; // 0.04%

    const filters = symbolInfo.filters || [];
    const minNotionalFilter = filters.find((f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
    const lotSizeFilter = filters.find((f: any) => f.filterType === 'LOT_SIZE');
    const priceFilter = filters.find((f: any) => f.filterType === 'PRICE_FILTER');

    let minNotional = 5;
    if (minNotionalFilter) {
      const parsedNotional = parseFloat(minNotionalFilter.notional || minNotionalFilter.minNotional || '5');
      if (!isNaN(parsedNotional) && parsedNotional > 0) {
        minNotional = parsedNotional;
      }
    }
    const minQuantity = lotSizeFilter ? (parseFloat(lotSizeFilter.minQty) || 0.001) : 0.001;
    const stepSize = lotSizeFilter ? (parseFloat(lotSizeFilter.stepSize) || 0.001) : 0.001;
    const tickSize = priceFilter ? (parseFloat(priceFilter.tickSize) || 0.01) : 0.01;
    const maxLeverage = 20;
    const minLeverage = 10;

    const liquidityScore = this.calculateLiquidityScore(spreadPercent, bidAskDepth, volume24h);

    return {
      symbol,
      cleanSymbol: symbolInfo.symbol,
      spreadPercent,
      bidAskDepth,
      volume24h,
      priceChange24h,
      volatility24h,
      stabilityScore,
      makerFee,
      takerFee,
      minNotional,
      minQuantity,
      stepSize,
      tickSize,
      maxLeverage,
      minLeverage,
      liquidityScore,
      isQualified: false,
      disqualificationReasons: [],
    };
  }

  /**
   * حساب درجة السيولة (0-100)
   */
  private calculateLiquidityScore(spread: number, depth: number, volume: number): number {
    let score = 0;

    // السبريد (40 نقطة)
    if (spread < 0.05) score += 40;
    else if (spread < 0.1) score += 30;
    else if (spread < 0.2) score += 20;
    else if (spread < 0.3) score += 10;

    // عمق دفتر الأوامر (30 نقطة)
    if (depth > 500000) score += 30;
    else if (depth > 200000) score += 25;
    else if (depth > 100000) score += 20;
    else if (depth > 50000) score += 15;
    else if (depth > 20000) score += 10;

    // حجم التداول (30 نقطة)
    if (volume > 10000000) score += 30;
    else if (volume > 5000000) score += 25;
    else if (volume > 1000000) score += 20;
    else if (volume > 500000) score += 15;
    else if (volume > 100000) score += 10;

    return score;
  }

  /**
   * تطبيق فلاتر الأهلية
   */
  private applyFilters(metrics: AssetMetrics): void {
    const reasons: string[] = [];

    if (metrics.spreadPercent > this.config.maxSpreadPercent) {
      reasons.push(`Spread too high: ${metrics.spreadPercent.toFixed(2)}% > ${this.config.maxSpreadPercent}%`);
    }

    if (metrics.volume24h < this.config.minVolume24h) {
      reasons.push(`Volume too low: $${(metrics.volume24h / 1e6).toFixed(2)}M < $${(this.config.minVolume24h / 1e6).toFixed(2)}M`);
    }

    if (metrics.bidAskDepth < this.config.minBidAskDepth) {
      reasons.push(`Depth too low: $${metrics.bidAskDepth.toFixed(0)} < $${this.config.minBidAskDepth}`);
    }

    if (metrics.volatility24h > this.config.maxVolatility24h) {
      reasons.push(`Volatility too high: ${(metrics.volatility24h * 100).toFixed(1)}% > ${(this.config.maxVolatility24h * 100).toFixed(1)}%`);
    }

    if (metrics.stabilityScore < this.config.minStabilityScore) {
      reasons.push(`Stability too low: ${(metrics.stabilityScore * 100).toFixed(0)}% < ${(this.config.minStabilityScore * 100).toFixed(0)}%`);
    }

    if (metrics.takerFee > this.config.maxTakerFee) {
      reasons.push(`Fees too high: ${(metrics.takerFee * 100).toFixed(2)}% > ${(this.config.maxTakerFee * 100).toFixed(2)}%`);
    }

    metrics.disqualificationReasons = reasons;
    metrics.isQualified = reasons.length === 0;
  }

  /**
   * الحصول على جميع مقاييس العملات
   */
  public getAllAssets(): AssetMetrics[] {
    return Array.from(this.allAssets.values());
  }

  /**
   * الحصول على العملات المؤهلة
   */
  public getQualifiedAssets(maxCount: number = 20): AssetSymbol[] {
    const sorted = Array.from(this.qualifiedAssets.values())
      .sort((a, b) => b.liquidityScore - a.liquidityScore)
      .slice(0, maxCount)
      .map(m => m.symbol);

    if (sorted.length === 0) {
      return ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'QNT/USDT'];
    }
    return sorted;
  }

  /**
   * الحصول على معلومات عملة محددة
   */
  public getAssetMetrics(symbol: AssetSymbol): AssetMetrics | undefined {
    return this.allAssets.get(symbol);
  }

  /**
   * الحصول على الحد الأدنى لقيمة الصفقة (minNotional) بالدولار المجلب من Binance exchangeInfo
   */
  public getMinNotional(symbol: AssetSymbol): number {
    const metrics = this.allAssets.get(symbol);
    return metrics?.minNotional ?? 5.0;
  }

  /**
   * هل يحين وقت تحديث البيانات؟
   */
  public shouldRefresh(): boolean {
    return (Date.now() - this.lastRefreshTime) > this.config.refreshIntervalMs;
  }

  /**
   * تقرير مالي وشامل عن حالة الأصول
   */
  public getReport(): any {
    const qualified = Array.from(this.qualifiedAssets.values())
      .sort((a, b) => b.liquidityScore - a.liquidityScore);

    return {
      totalAssetsScanned: this.allAssets.size,
      qualifiedAssetsCount: qualified.length,
      lastRefresh: this.lastRefreshTime > 0 ? new Date(this.lastRefreshTime).toISOString() : 'INITIALIZED',
      topQualified: qualified.slice(0, 15).map(m => ({
        symbol: m.symbol,
        liquidityScore: m.liquidityScore,
        spread: m.spreadPercent.toFixed(3) + '%',
        volume24h: '$' + (m.volume24h / 1000000).toFixed(2) + 'M',
        stability: (m.stabilityScore * 100).toFixed(0) + '%',
        minNotional: `$${m.minNotional}`,
        minLeverage: `${m.minLeverage}x`,
        maxLeverage: `${m.maxLeverage}x`,
      })),
      disqualifiedSample: Array.from(this.allAssets.values())
        .filter(m => !m.isQualified)
        .slice(0, 5)
        .map(m => ({
          symbol: m.symbol,
          reasons: m.disqualificationReasons,
        })),
    };
  }

  // No hardcoded market metrics. Screener stays empty until exchange data passes validation.

  private toAssetSymbol(cleanSymbol: string): AssetSymbol {
    if (cleanSymbol.endsWith('USDT')) {
      return (cleanSymbol.slice(0, -4) + '/USDT') as AssetSymbol;
    }
    if (cleanSymbol.endsWith('USD')) {
      return (cleanSymbol.slice(0, -3) + '/USD') as AssetSymbol;
    }
    return cleanSymbol as AssetSymbol;
  }
}
