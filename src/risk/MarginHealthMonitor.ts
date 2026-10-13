import { Position, AssetSymbol } from '../domain/types';

export type MarginHealthRecommendation = 'SAFE' | 'REDUCE_RISK' | 'CLOSE_NOW';

export interface PositionMarginHealth {
  symbol: AssetSymbol;
  healthScore: number;
  liquidationPrice: number;
  currentPrice: number;
  isLong: boolean;
  atRisk: boolean;
}

export interface MarginHealthReport {
  worstHealthScore: number;
  atRiskPositions: PositionMarginHealth[];
  recommendation: MarginHealthRecommendation;
  timestamp: number;
}

export class MarginHealthMonitor {
  private readonly HEALTH_WARNING_THRESHOLD = 0.20;
  private readonly HEALTH_CRITICAL_THRESHOLD = 0.10;

  public checkMarginHealth(positions: Position[]): MarginHealthReport {
    const positionHealth: PositionMarginHealth[] = [];
    let worstHealthScore = 1.0;

    for (const pos of positions) {
      const healthScore = this.calculateHealthScore(pos);
      const atRisk = healthScore < this.HEALTH_WARNING_THRESHOLD;

      positionHealth.push({
        symbol: pos.symbol,
        healthScore,
        liquidationPrice: pos.liquidationPrice,
        currentPrice: pos.currentPrice,
        isLong: pos.size > 0,
        atRisk,
      });

      if (healthScore < worstHealthScore) {
        worstHealthScore = healthScore;
      }
    }

    const atRiskPositions = positionHealth.filter((p) => p.atRisk);
    const recommendation = this.determineRecommendation(worstHealthScore, atRiskPositions.length);

    return {
      worstHealthScore,
      atRiskPositions,
      recommendation,
      timestamp: Date.now(),
    };
  }

  private calculateHealthScore(pos: Position): number {
    const { currentPrice, liquidationPrice, size } = pos;
    const isLong = size > 0;

    if (currentPrice <= 0 || liquidationPrice <= 0) {
      return 1.0;
    }

    if (isLong) {
      return (currentPrice - liquidationPrice) / currentPrice;
    } else {
      return (liquidationPrice - currentPrice) / currentPrice;
    }
  }

  private determineRecommendation(
    worstHealthScore: number,
    atRiskCount: number
  ): MarginHealthRecommendation {
    if (worstHealthScore < this.HEALTH_CRITICAL_THRESHOLD || atRiskCount >= 3) {
      return 'CLOSE_NOW';
    }
    if (worstHealthScore < this.HEALTH_WARNING_THRESHOLD || atRiskCount > 0) {
      return 'REDUCE_RISK';
    }
    return 'SAFE';
  }

  public getPositionsNeedingReduction(positions: Position[]): Position[] {
    return positions.filter((pos) => {
      const healthScore = this.calculateHealthScore(pos);
      return healthScore < this.HEALTH_WARNING_THRESHOLD;
    });
  }

  public getHealthWarningThreshold(): number {
    return this.HEALTH_WARNING_THRESHOLD;
  }

  public getHealthCriticalThreshold(): number {
    return this.HEALTH_CRITICAL_THRESHOLD;
  }
}