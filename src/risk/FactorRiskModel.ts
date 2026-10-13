import { Position, AssetSymbol } from '../domain/types';

export interface FactorDecomposition {
  factorLoadings: number[][];
  factorNames: string[];
  systematicRiskPct: number;
  idiosyncraticRiskPct: number;
  eigenvalues: number[];
  explainedVarianceRatio: number[];
  timestamp: number;
}

export interface FactorRiskResult {
  decomposition: FactorDecomposition;
  portfolioFactorExposure: Record<string, number>;
  riskCapTriggered: boolean;
  recommendedMaxExposure: number;
}

export class FactorRiskModel {
  private readonly MAX_FACTORS = 5;
  private readonly SYSTEMATIC_RISK_CAP = 0.70;

  public decomposeRisk(
    positions: Position[],
    covarianceMatrix: number[][]
  ): FactorRiskResult {
    const decomposition = this.performPCA(covarianceMatrix);
    const portfolioFactorExposure = this.calculateFactorExposure(positions, decomposition);
    const riskCapTriggered = decomposition.systematicRiskPct > this.SYSTEMATIC_RISK_CAP * 100;
    const recommendedMaxExposure = riskCapTriggered
      ? this.calculateReducedExposure(decomposition.systematicRiskPct)
      : 1.0;

    return {
      decomposition,
      portfolioFactorExposure,
      riskCapTriggered,
      recommendedMaxExposure,
    };
  }

  private performPCA(covarianceMatrix: number[][]): FactorDecomposition {
    const n = covarianceMatrix.length;
    const { eigenvalues, eigenvectors } = this.eigenDecomposition(covarianceMatrix);

    const sortedIndices = eigenvalues
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .map((item) => item.idx);

    const totalVariance = eigenvalues.reduce((a, b) => a + b, 0);
    const numFactors = Math.min(this.MAX_FACTORS, n);

    const selectedEigenvalues = sortedIndices.slice(0, numFactors).map((i) => eigenvalues[i]);
    const selectedEigenvectors = sortedIndices.slice(0, numFactors).map((i) => eigenvectors[i]);

    const explainedVarianceRatio = selectedEigenvalues.map((v) => v / totalVariance);
    const cumulativeExplained = explainedVarianceRatio.reduce((a, b) => a + b, 0);

    const systematicRiskPct = cumulativeExplained * 100;
    const idiosyncraticRiskPct = (1 - cumulativeExplained) * 100;

    const factorNames = ['Market Factor (PC1)', 'Volatility Factor (PC2)'];
    if (numFactors >= 3) factorNames.push('Liquidity Factor (PC3)');
    if (numFactors >= 4) factorNames.push('Sector Factor (PC4)');
    if (numFactors >= 5) factorNames.push('Idiosyncratic Factor (PC5)');

    return {
      factorLoadings: selectedEigenvectors,
      factorNames: factorNames.slice(0, numFactors),
      systematicRiskPct,
      idiosyncraticRiskPct,
      eigenvalues: selectedEigenvalues,
      explainedVarianceRatio,
      timestamp: Date.now(),
    };
  }

  private eigenDecomposition(matrix: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
    const n = matrix.length;
    let A = matrix.map((row) => [...row]);
    let V = this.identityMatrix(n);
    const maxIterations = 100;
    const tolerance = 1e-10;

    for (let iter = 0; iter < maxIterations; iter++) {
      let { Q, R } = this.qrDecomposition(A);
      const ANext = this.matrixMultiply(R, Q);
      V = this.matrixMultiply(V, Q);

      const converged = this.checkConvergence(A, ANext, tolerance);
      A = ANext;

      if (converged) break;
    }

    const eigenvalues = A.map((row, i) => row[i]);
    const eigenvectors = V[0].map((_, i) => V.map((row) => row[i]));

    return { eigenvalues, eigenvectors };
  }

  private qrDecomposition(A: number[][]): { Q: number[][]; R: number[][] } {
    const n = A.length;
    const Q: number[][] = [];
    const R: number[][] = Array(n)
      .fill(0)
      .map(() => Array(n).fill(0));

    for (let j = 0; j < n; j++) {
      let v = A.map((row) => row[j]);

      for (let i = 0; i < j; i++) {
        const qi = Q[i];
        const r = this.dotProduct(qi, v);
        R[i][j] = r;
        v = v.map((val, k) => val - r * qi[k]);
      }

      const norm = Math.sqrt(this.dotProduct(v, v));
      if (norm < 1e-12) {
        Q[j] = Array(n).fill(0);
        R[j][j] = 0;
      } else {
        Q[j] = v.map((val) => val / norm);
        R[j][j] = norm;
      }
    }

    return { Q: this.transpose(Q), R };
  }

  private matrixMultiply(A: number[][], B: number[][]): number[][] {
    const m = A.length;
    const n = B[0].length;
    const p = B.length;
    const result = Array(m)
      .fill(0)
      .map(() => Array(n).fill(0));

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < p; k++) {
          sum += A[i][k] * B[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }

  private transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, i) => matrix.map((row) => row[i]));
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private identityMatrix(n: number): number[][] {
    return Array(n)
      .fill(0)
      .map((_, i) => Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)));
  }

  private checkConvergence(A: number[][], ANext: number[][], tolerance: number): boolean {
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < A.length; j++) {
        if (i !== j && Math.abs(A[i][j] - ANext[i][j]) > tolerance) {
          return false;
        }
      }
    }
    return true;
  }

  private calculateFactorExposure(
    positions: Position[],
    decomposition: FactorDecomposition
  ): Record<string, number> {
    const exposure: Record<string, number> = {};
    const totalValue = positions.reduce((sum, p) => sum + Math.abs(p.size * p.currentPrice), 0);

    if (totalValue === 0) return exposure;

    for (let f = 0; f < decomposition.factorLoadings.length; f++) {
      const factorName = decomposition.factorNames[f];
      let factorExposure = 0;

      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const weight = (Math.abs(pos.size * pos.currentPrice)) / totalValue;
        const loading = decomposition.factorLoadings[f][i] || 0;
        factorExposure += weight * loading;
      }

      exposure[factorName] = factorExposure;
    }

    return exposure;
  }

  private calculateReducedExposure(systematicRiskPct: number): number {
    const excessRisk = systematicRiskPct - this.SYSTEMATIC_RISK_CAP * 100;
    const reductionFactor = 1 - excessRisk / 100;
    return Math.max(0.2, Math.min(1.0, reductionFactor));
  }

  public getSystematicRiskCap(): number {
    return this.SYSTEMATIC_RISK_CAP;
  }

  public getMaxFactors(): number {
    return this.MAX_FACTORS;
  }
}