import { Position, AccountBalance, AssetSymbol } from '../domain/types';

export interface StressScenario {
  name: string;
  priceShock: (price: number, symbol: AssetSymbol) => number;
  volatilityMultiplier: number;
  correlationSpike: number;
}

export interface StressTestResult {
  scenarioName: string;
  maxLoss: number;
  maxDrawdown: number;
  positionsAtRisk: number;
  recoveryTimeEstimate: number;
  passed: boolean;
}

export interface StressTestSummary {
  results: StressTestResult[];
  overallPass: boolean;
  worstDrawdown: number;
  totalMaxLoss: number;
  timestamp: number;
}

export class StressTestEngine {
  private scenarios: StressScenario[];

  constructor() {
    this.scenarios = this.initializeScenarios();
  }

  private initializeScenarios(): StressScenario[] {
    return [
      {
        name: 'BTC Flash Crash Oct 2021',
        priceShock: (price: number, symbol: AssetSymbol) => {
          if (symbol.includes('BTC')) {
            return price * 0.82;
          }
          return price * 0.95;
        },
        volatilityMultiplier: 4.0,
        correlationSpike: 0.85,
      },
      {
        name: 'FTX Collapse Nov 2022',
        priceShock: (price: number, symbol: AssetSymbol) => {
          if (symbol.includes('FTT') || symbol.includes('SOL') || symbol.includes('SRM')) {
            return price * 0.5;
          }
          return price * 0.7;
        },
        volatilityMultiplier: 5.5,
        correlationSpike: 0.92,
      },
      {
        name: 'COVID Crash Mar 2020',
        priceShock: (price: number) => price * 0.5,
        volatilityMultiplier: 7.0,
        correlationSpike: 0.95,
      },
      {
        name: '2025 Tariff Shock',
        priceShock: (price: number, symbol: AssetSymbol) => {
          if (symbol.includes('NVDA') || symbol.includes('AAPL') || symbol.includes('USD')) {
            return price * 0.85;
          }
          return price * 0.92;
        },
        volatilityMultiplier: 3.0,
        correlationSpike: 0.88,
      },
      {
        name: 'Funding Rate Extremes',
        priceShock: (price: number, symbol: AssetSymbol) => {
          if (symbol.includes('USDT') || symbol.includes('PERP')) {
            return price * 0.94;
          }
          return price * 0.98;
        },
        volatilityMultiplier: 2.5,
        correlationSpike: 0.6,
      },
    ];
  }

  public runStressTest(positions: Position[], balance: AccountBalance): StressTestSummary {
    const results: StressTestResult[] = [];
    const totalEquity = balance.totalEquity;

    for (const scenario of this.scenarios) {
      let totalLoss = 0;
      let positionsAtRisk = 0;

      for (const pos of positions) {
        const shockedPrice = scenario.priceShock(pos.currentPrice, pos.symbol);
        const isLong = pos.size > 0;
        const pnl = isLong
          ? (shockedPrice - pos.entryPrice) * pos.size
          : (pos.entryPrice - shockedPrice) * Math.abs(pos.size);

        if (pnl < 0) {
          totalLoss += Math.abs(pnl);
        }

        const liquidationDistance = isLong
          ? (pos.currentPrice - pos.liquidationPrice) / pos.currentPrice
          : (pos.liquidationPrice - pos.currentPrice) / pos.currentPrice;

        if (liquidationDistance < 0.3) {
          positionsAtRisk++;
        }
      }

      const maxDrawdown = totalEquity > 0 ? (totalLoss / totalEquity) * 100 : 0;
      const recoveryTimeEstimate = this.estimateRecoveryTime(maxDrawdown, scenario.volatilityMultiplier);
      const passed = maxDrawdown <= 20;

      results.push({
        scenarioName: scenario.name,
        maxLoss: totalLoss,
        maxDrawdown,
        positionsAtRisk,
        recoveryTimeEstimate,
        passed,
      });
    }

    const worstDrawdown = Math.max(...results.map((r) => r.maxDrawdown));
    const totalMaxLoss = results.reduce((sum, r) => sum + r.maxLoss, 0);
    const overallPass = results.every((r) => r.passed);

    return {
      results,
      overallPass,
      worstDrawdown,
      totalMaxLoss,
      timestamp: Date.now(),
    };
  }

  private estimateRecoveryTime(maxDrawdown: number, volatilityMultiplier: number): number {
    if (maxDrawdown <= 0) return 0;
    const baseRecoveryDays = maxDrawdown / 2;
    return Math.round(baseRecoveryDays * volatilityMultiplier);
  }

  public getScenarios(): StressScenario[] {
    return this.scenarios;
  }
}