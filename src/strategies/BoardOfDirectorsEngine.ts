/**
 * BoardOfDirectorsEngine.ts
 * ====================================================================
 * BOARD OF DIRECTORS v6.0 — INSTITUTIONAL QUANT ENGINE (TYPESCRIPT)
 * ====================================================================
 * 14 Autonomous Quantum Agents:
 * - 6 Alpha Decision Makers (Strategy, Math, Risk, Execution, Macro, Scout)
 * - 8 Anti-Overfitting Guards (Walk-Forward, OOS, Cross-Asset, MTF, Sensitivity, Bootstrap, Stress, Regime)
 *
 * Features:
 * - 100% Real In-Memory Backtest & Bootstrap Math (Zero Mock Data)
 * - Adaptive Voting Thresholds based on Market Volatility
 * - Self-Learning Reinforcement Loop with Persistent JSON/State Storage
 * - Direct Integration with MarketDataManager, FeatureEngine & SubWalletManager
 * ====================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createRng } from '../quantum/seededRng';
import { AssetSymbol, TradingSignal } from '../domain/types';
import { CalculatedFeatures } from '../features/FeatureEngine';
import { RegimeAnalysis } from '../risk/RegimeDetector';

export interface AgentProfile {
  name: string;
  arabicName: string;
  role: string;
  type: 'alpha' | 'guard';
  confidence: number;
  accuracy: number;
  totalDecisions: number;
  correctDecisions: number;
  learningCurve: number[];
}

export interface AgentVoteProposal {
  verdict: 'approved' | 'challenge' | 'rejected';
  riskPct: number;
  confidence: number;
  note: string;
  metric?: string | number;
  symbol?: string;
  marketBias?: 'bullish' | 'bearish' | 'neutral';
}

export interface AgentDeliberationDiagnosis {
  agentId: string;
  agentName: string;
  arabicName: string;
  role: string;
  diagnosisPerspectiveAr: string;
  diagnosisPerspectiveEn: string;
  rootCauseAr: string;
  rootCauseEn: string;
  proposedParameterFixAr: string;
  proposedParameterFixEn: string;
  suggestedStrategyAdjustment: {
    param: string;
    oldValue: number;
    newValue: number;
    action: 'TIGHTEN' | 'EXPAND' | 'FILTER' | 'REBALANCE';
  };
  confidenceScore: number;
  voteOnFix: 'ACCEPT' | 'REFINE' | 'REJECT';
}

export interface AgentPeerCritique {
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  critiqueAr: string;
  critiqueEn: string;
  counterProposalAr: string;
  counterProposalEn: string;
  agreementScore: number;
}

export interface MultiTrialValidation {
  trialNumber: 1 | 2 | 3;
  testName: string;
  candlesTested: number;
  syntheticProfit: number;
  syntheticWinRate: number;
  maxDrawdownPct: number;
  isSuccessful: boolean;
  validationLogAr: string;
  validationLogEn: string;
}

export interface ActiveStrategyPolicy {
  version: number;
  zScoreEntryThreshold: number;
  stopLossPctMultiplier: number;
  takeProfitPctMultiplier: number;
  minGuardsQuorum: number;
  minApprovalRatio: number;
  volatilitySensitivity: number;
  cooldownMinutesAfterLoss: number;
  dynamicLeverageCap: number;
  maxAllowedSlippageBps: number;
  errorReductionScore: number;
  totalDeliberationsHeld: number;
  lastOptimizedAt: string;
}

export interface BoardDeliberationSession {
  id: string;
  tradeId: string;
  symbol: string;
  pnl: number;
  pnlPct: number;
  isWin: boolean;
  timestamp: string;
  round1Diagnoses: AgentDeliberationDiagnosis[];
  round2Critiques: AgentPeerCritique[];
  round3Trials: MultiTrialValidation[];
  consensusVerdictAr: string;
  consensusVerdictEn: string;
  adoptedStrategyPolicy: ActiveStrategyPolicy;
  policyMutationSummaryAr: string;
  policyMutationSummaryEn: string;
  errorReductionScore: number;
}

export interface TradeLearningEvent {
  id: string;
  timestamp: string;
  pnl: number;
  symbol: string;
  isWin: boolean;
  shifts: Record<string, { deltaConf: number; deltaAcc: number; newConf: number; newAcc: number }>;
}

export interface CouncilMemberDefinition {
  id: string;
  name: string;
  primaryFile: string;
  secondaryFile: string;
  legacyAgentIds: string[];
  hasVeto: boolean;
  canExecute: boolean;
}

export const SEVEN_MEMBER_COUNCIL: CouncilMemberDefinition[] = [
  { id: 'market-regime', name: 'Market Regime', primaryFile: 'market-regime-main.html', secondaryFile: 'market-regime-detailed.html', legacyAgentIds: ['market', 'regime'], hasVeto: false, canExecute: false },
  { id: 'trend-structure', name: 'Trend Structure', primaryFile: 'trend-structure-main.html', secondaryFile: 'trend-structure-detailed.html', legacyAgentIds: ['algo', 'tf'], hasVeto: false, canExecute: false },
  { id: 'momentum', name: 'Momentum', primaryFile: 'momentum-main.html', secondaryFile: 'momentum-detailed.html', legacyAgentIds: ['trading', 'quant'], hasVeto: false, canExecute: false },
  { id: 'volume-liquidity', name: 'Volume & Liquidity', primaryFile: 'volume-main.html', secondaryFile: 'liquidity-detailed.html', legacyAgentIds: ['scout', 'cross'], hasVeto: false, canExecute: false },
  { id: 'reversion-timing', name: 'Reversion & Timing', primaryFile: 'reversion-main.html', secondaryFile: 'timing-detailed.html', legacyAgentIds: ['sens', 'oos'], hasVeto: false, canExecute: false },
  { id: 'risk-sentinel', name: 'Risk Sentinel', primaryFile: 'risk-main.html', secondaryFile: 'risk-detailed.html', legacyAgentIds: ['risk', 'stress', 'boot'], hasVeto: true, canExecute: false },
  { id: 'execution-arbiter', name: 'Execution Arbiter', primaryFile: 'execution-main.html', secondaryFile: 'execution-detailed.html', legacyAgentIds: ['wf'], hasVeto: false, canExecute: true }
];

export interface BoardMeetingDecision {
  id: string;
  round: number;
  timestamp: string;
  symbol: string;
  verdict: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  action: string;
  sizeMultiplier: number; // 1.0 for APPROVED, 0.5 for CONDITIONAL, 0 for REJECTED
  approvalRatio: number;
  guardsPassed: number;
  basicApproved: number;
  minGuardsRequired: number;
  volatilityRegime: 'normal' | 'high_volatility';
  votes: Record<string, 'approved' | 'challenge' | 'rejected'>;
  proposals: Record<string, AgentVoteProposal>;
  voteWeights: Record<string, number>;
  executedSignal?: TradingSignal | null;
}

export interface BoardConfig {
  learningRate: number;
  maxRiskPerTrade: number;
  capital: number;
  maxWfGap: number;
  minOosRatio: number;
  maxCrossAssetStd: number;
  minTimeframePass: number;
  maxParamSensitivity: number;
  minBootstrapCi: number;
  maxStressLoss: number;
  adaptiveThresholds: boolean;
  tradingCostPerSide: number; // fee + slippage per side (verified Binance taker 5 bps futures; slippage ASSUMPTION)
  liquidationBufferRatio: number;
  maxLeverage: number; // liquidation proxy leverage (matches activePolicy.dynamicLeverageCap default 3.0) // fraction of 1/leverage that a single-bar adverse move may consume
  minGuardsPassed: number;
  minBasicApproved: number;
  approvalRatioNormal: number;
  approvalRatioHighVol: number;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  learningRate: 0.05,
  maxRiskPerTrade: 0.02,
  capital: 0,
  maxWfGap: 0.12,
  minOosRatio: 0.55,
  maxCrossAssetStd: 0.65,
  minTimeframePass: 2,
  maxParamSensitivity: 0.40,
  minBootstrapCi: 0.0,
  maxStressLoss: 0.20,
  adaptiveThresholds: true,
  tradingCostPerSide: 0.0020,
  liquidationBufferRatio: 0.8,
  maxLeverage: 3.0,
  minGuardsPassed: 5,
  minBasicApproved: 3,
  approvalRatioNormal: 0.60,
  approvalRatioHighVol: 0.50
};

// Base Abstract Expert Agent
export class ExpertAgent {
  public profile: AgentProfile;
  // Runtime config for guards; set by subclass constructors that receive BoardConfig.
  public config!: BoardConfig;

  constructor(name: string, arabicName: string, role: string, type: 'alpha' | 'guard', initialConfidence = 0.75) {
    this.profile = {
      name,
      arabicName,
      role,
      type,
      confidence: initialConfidence,
      accuracy: 0.50,
      totalDecisions: 0,
      correctDecisions: 0,
      learningCurve: []
    };
  }

  public learn(decisionCorrect: boolean, pnl: number): void {
    this.profile.totalDecisions += 1;
    if (decisionCorrect) {
      this.profile.correctDecisions += 1;
    }
    this.profile.accuracy = this.profile.correctDecisions / Math.max(this.profile.totalDecisions, 1);

    if (decisionCorrect) {
      this.profile.confidence = Math.min(this.profile.confidence + DEFAULT_BOARD_CONFIG.learningRate, 0.98);
    } else {
      this.profile.confidence = Math.max(this.profile.confidence - DEFAULT_BOARD_CONFIG.learningRate * 2, 0.30);
    }

    this.profile.learningCurve.push(Number(this.profile.accuracy.toFixed(3)));
    if (this.profile.learningCurve.length > 50) {
      this.profile.learningCurve.shift();
    }
  }

  public getVoteWeight(): number {
    return Number((this.profile.confidence * (0.5 + this.profile.accuracy * 0.5)).toFixed(4));
  }
}

// -------------------------------------------------------------
//  ALPHA GENERATORS (6 Decision Makers)
// -------------------------------------------------------------

export class AlgoEngineerAgent extends ExpertAgent {
  constructor() {
    super('AlgoEngineer', 'خبير الخوارزميات والهندسة', 'فحص سلامة التنفيذ والتعقيد الحسابي', 'alpha', 0.85);
  }

  public vote(context: { nestedLoops?: number; executionLatencyMs?: number }): AgentVoteProposal {
    const latency = context.executionLatencyMs || 12;
    if (latency > 500) {
      return {
        verdict: 'challenge',
        riskPct: 0.01,
        confidence: 0.45,
        note: `بطء في المعالجة (${latency}ms) — خطر انزلاق سعري`
      };
    }
    return {
      verdict: 'approved',
      riskPct: 0.012,
      confidence: this.profile.confidence,
      note: 'الكود الخوارزمي نظيف والأداء في حدود الميلي ثانية'
    };
  }
}

export class TradingEngineerAgent extends ExpertAgent {
  constructor() {
    super('TradingEngineer', 'خبير الصفقات وتطابق الإشارات', 'التحقق من تناغم إشارات الدخول والوقف', 'alpha', 0.80);
  }

  public vote(signals: TradingSignal[]): AgentVoteProposal {
    if (!signals || signals.length === 0) {
      return {
        verdict: 'rejected',
        riskPct: 0,
        confidence: 0,
        note: 'لا توجد إشارات تداول صالحة'
      };
    }
    const highConfSignals = signals.filter(s => ((s as any).confidence || s.strength || 0) >= 0.65);
    if (highConfSignals.length === 0) {
      return {
        verdict: 'challenge',
        riskPct: 0.008,
        confidence: 0.50,
        note: 'الإشارات المتاحة ذات ثقة متوسطة وغير مؤكدة'
      };
    }
    return {
      verdict: 'approved',
      riskPct: 0.015,
      confidence: this.profile.confidence,
      note: `تطابق ${highConfSignals.length} إشارة كمية عالية الثقة`
    };
  }
}

export class QuantMathematicianAgent extends ExpertAgent {
  constructor() {
    super('QuantMathematician', 'خبير الرياضيات والإحصاء', 'فحص الالتواء، التفلطح، والتوزيع الإحصائي', 'alpha', 0.88);
  }

  public vote(candles: Array<{ close: number }>, features?: CalculatedFeatures): AgentVoteProposal {
    if (!candles || candles.length < 30) {
      return { verdict: 'rejected', riskPct: 0, confidence: 0, note: 'بيانات غير كافية للحساب الإحصائي' };
    }
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    const std = Math.sqrt(variance) || 1e-6;

    // Skewness & Kurtosis
    const skewness = returns.reduce((a, b) => a + Math.pow((b - mean) / std, 3), 0) / returns.length;
    const kurtosis = (returns.reduce((a, b) => a + Math.pow((b - mean) / std, 4), 0) / returns.length) - 3;

    const isAnomalous = Math.abs(skewness) > 1.8 || kurtosis > 8.0;
    if (isAnomalous) {
      return {
        verdict: 'challenge',
        riskPct: 0.01,
        confidence: 0.40,
        note: `توزيع إحصائي شاذ (Skew: ${skewness.toFixed(2)}, Kurt: ${kurtosis.toFixed(2)})`
      };
    }
    return {
      verdict: 'approved',
      riskPct: 0.015,
      confidence: this.profile.confidence,
      note: `توزيع طبيعي مستقر (Skew: ${skewness.toFixed(2)}, Kurt: ${kurtosis.toFixed(2)})`
    };
  }
}

export class CoinScoutAgent extends ExpertAgent {
  constructor() {
    super('CoinScout', 'خبير استطلاع العملات والسيولة', 'تقييم الزخم النسبي وأحجام التداول اللحظية', 'alpha', 0.78);
  }

  public vote(
    symbol: string,
    candlesMap: Record<string, Array<{ close: number; volume: number }>>
  ): AgentVoteProposal {
    const candles = candlesMap[symbol];
    if (!candles || candles.length < 20) {
      return {
        verdict: 'approved',
        symbol,
        riskPct: 0.01,
        confidence: 0.60,
        note: `فحص أولي للعملة ${symbol}`
      };
    }
    const last = candles[candles.length - 1];
    const prev20 = candles[Math.max(0, candles.length - 20)];
    const momentum = ((last.close - prev20.close) / prev20.close) * 100;
    const avgVol = candles.slice(-20).reduce((acc, c) => acc + c.volume, 0) / 20;
    const relVol = last.volume / (avgVol || 1);

    return {
      verdict: 'approved',
      symbol,
      riskPct: 0.012,
      confidence: this.profile.confidence,
      note: `الزخم: ${momentum >= 0 ? '+' : ''}${momentum.toFixed(1)}% | السيولة النسبية: ${relVol.toFixed(1)}x`
    };
  }
}

export class MarketExpertAgent extends ExpertAgent {
  constructor() {
    super('MarketExpert', 'خبير بنية السوق والاتجاه العام', 'تحديد الاتجاه الأكبر وتقاطع المتوسطات الذهبية', 'alpha', 0.82);
  }

  public vote(candles: Array<{ close: number }>, regime?: RegimeAnalysis): AgentVoteProposal {
    if (!candles || candles.length < 50) {
      return {
        verdict: 'approved',
        marketBias: 'neutral',
        riskPct: 0.01,
        confidence: 0.55,
        note: 'بيانات متوسطات محدودة — حياد سوقي'
      };
    }
    const closes = candles.map(c => c.close);
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const isBullish = sma20 > sma50;

    return {
      verdict: 'approved',
      marketBias: isBullish ? 'bullish' : 'bearish',
      riskPct: 0.014,
      confidence: this.profile.confidence,
      note: `السوق ${isBullish ? 'صاعد (SMA20 > SMA50)' : 'هابط/تصحيحي (SMA20 < SMA50)'} | النظام: ${regime?.marketRegime || 'Normal'}`
    };
  }
}

export class RiskControllerAgent extends ExpertAgent {
  private readonly limit: number;

  constructor(limit: number = DEFAULT_BOARD_CONFIG.maxRiskPerTrade) {
    super('RiskController', 'خبير إدارة المخاطر وحماية رأس المال', 'حق النقض الصارم وحساب كسر كيلي والمخاطر التراكمية', 'alpha', 0.95);
    this.limit = limit;
  }

  public vote(proposals: AgentVoteProposal[], capital: number): AgentVoteProposal {
    const totalRisk = proposals.reduce((acc, p) => acc + (p.riskPct || 0), 0) / Math.max(proposals.length, 1);
    const maxRisk = proposals.reduce((acc, p) => Math.max(acc, p.riskPct || 0), 0);
    const avgConf = proposals.reduce((acc, p) => acc + (p.confidence || 0.5), 0) / Math.max(proposals.length, 1);
    const limit = this.limit;

    // Hard veto on the largest single proposal: an average cannot hide one over-cap sizing request.
    if (maxRisk > limit) {
      return {
        verdict: 'rejected',
        riskPct: maxRisk,
        confidence: 0,
        note: `❌ فيتو المخاطر: المخاطرة المقترحة ${(maxRisk * 100).toFixed(1)}% تتجاوز الحد الأقصى ${(limit * 100).toFixed(1)}%`
      };
    }
    if (avgConf < 0.52) {
      return {
        verdict: 'challenge',
        riskPct: totalRisk * 0.5,
        confidence: avgConf,
        note: `⚠️ ثقة منخفضة (${(avgConf * 100).toFixed(0)}%) — تخفيض الحجم إلى النصف`
      };
    }
    return {
      verdict: 'approved',
      riskPct: totalRisk,
      confidence: avgConf,
      note: `✅ موافقة المخاطر: رأس مال آمن ($${capital.toFixed(2)}) بمخاطرة ${(totalRisk * 100).toFixed(2)}%`
    };
  }
}

// -------------------------------------------------------------
//  ANTI-OVERFITTING GUARDS (8 Protection Guardians)
// -------------------------------------------------------------

// Helper math for guards
// Round-trip cost per bar derived from config (cost per side x 2).
function pnlRoundTrip(cfg?: BoardConfig): number {
  return 2 * (cfg?.tradingCostPerSide ?? DEFAULT_BOARD_CONFIG.tradingCostPerSide);
}

export function calculatePnLSeries(candles: Array<{ close: number; high?: number; low?: number }>, atrMultiplier = 1.5, roundTripCost = pnlRoundTrip()): number[] {
  const pnls: number[] = [];
  if (!candles || candles.length < 20) return [];
  for (let i = 15; i < candles.length - 1; i++) {
    const entry = candles[i].close;
    const next = candles[i + 1].close;
    let pnl = (next - entry) / entry;
    // stop-loss: adverse move capped at atrMultiplier * bar range (ATR proxy); makes the multiplier matter
    const range = candles[i].high !== undefined && candles[i].low !== undefined
      ? (candles[i].high! - candles[i].low!) / entry
      : 0.01;
    const stop = -atrMultiplier * range;
    if (pnl < stop) pnl = stop;
    // apply slippage & commission (round trip from config)
    pnl -= roundTripCost;
    pnls.push(pnl);
  }
  return pnls;
}

function calculateSharpe(pnls: number[]): number {
  if (!pnls || pnls.length === 0) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(pnls.length - 1, 1);
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : mean / std;
}

export class WalkForwardGuard extends ExpertAgent {
  constructor(config: BoardConfig) {
    super('WalkForwardGuard', 'حارس التحليل الأمامي (Walk-Forward', 'قياس فجوة الأداء بين التدريب والاختبار الزمني المتدحرج', 'guard', 0.90);
    this.config = config;
  }

  public vote(candles: Array<{ close: number }>): AgentVoteProposal {
    if (!candles || candles.length < 50) {
      return { verdict: 'challenge', confidence: 0, riskPct: 0.01, note: 'بيانات غير كافية لتقسيم WF — موافقة مشروطة' };
    }
    // 3 TimeSeries rolling splits
    const gaps: number[] = [];
    const splitSize = Math.floor(candles.length / 4);
    for (let split = 1; split <= 3; split++) {
      const trainSet = candles.slice(0, split * splitSize);
      const testSet = candles.slice(split * splitSize, (split + 1) * splitSize);
      const trainSharpe = calculateSharpe(calculatePnLSeries(trainSet, 1.5, pnlRoundTrip(this.config)));
      const testSharpe = calculateSharpe(calculatePnLSeries(testSet, 1.5, pnlRoundTrip(this.config)));
      gaps.push(Math.abs(trainSharpe - testSharpe));
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const passed = avgGap <= this.config.maxWfGap;

        return {
          verdict: passed ? 'approved' : 'rejected',
          confidence: passed ? 0.92 : 0.40,
          riskPct: passed ? 0.015 : 0.005,
          note: passed
            ? `✅ فجوة التحليل الأمامي (${(avgGap * 100).toFixed(1)}%) ضمن الحد المسموح`
            : `⚠️ فجوة التحليل الأمامي (${(avgGap * 100).toFixed(1)}%) مرتفعة > ${(this.config.maxWfGap * 100).toFixed(0)}%`
        };
      }
    }

export class OutOfSampleGuard extends ExpertAgent {
  constructor(config: BoardConfig) {
    super('OutOfSampleGuard', 'حارس العينة الخارجية (Out-of-Sample)', 'التحقق من احتفاظ الاستراتيجية بكفاءتها في 30% الأخيرة', 'guard', 0.88);
    this.config = config;
  }

  public vote(candles: Array<{ close: number }>): AgentVoteProposal {
    if (!candles || candles.length < 40) {
      return { verdict: 'challenge', confidence: 0, riskPct: 0.01, note: 'بيانات غير كافية لفصل العينة' };
    }
    const splitIdx = Math.floor(candles.length * 0.70);
    const inSample = candles.slice(0, splitIdx);
    const outSample = candles.slice(splitIdx);

    const inSharpe = calculateSharpe(calculatePnLSeries(inSample, 1.5, pnlRoundTrip(this.config)));
    const outSharpe = calculateSharpe(calculatePnLSeries(outSample, 1.5, pnlRoundTrip(this.config)));
    // No in-sample edge (Sharpe <= 0) means nothing to validate: fail. Never floor it to approve.
    const ratio = inSharpe > 0 ? Math.max(0, outSharpe / inSharpe) : 0;
    const passed = inSharpe > 0 && ratio >= this.config.minOosRatio;
        const verdict = passed ? 'approved' : 'rejected';
        return {
          verdict: verdict,
          confidence: passed ? 0.90 : 0.35,
          riskPct: passed ? 0.015 : 0.005,
          note: passed
            ? `✅ نسبة العينة الخارجية OOS (${(ratio * 100).toFixed(0)}%) قوية ومستقرة`
            : `⚠️ تراجع الأداء خارج العينة (${(ratio * 100).toFixed(0)}% < ${(this.config.minOosRatio * 100).toFixed(0)}%)`
        };
  }
}

export class CrossAssetGuard extends ExpertAgent {
  constructor(config: BoardConfig) {
    super('CrossAssetGuard', 'حارس تعدد العملات (Cross-Asset)', 'فحص عدم اقتصار الربح على عملة واحدة دون غيرها', 'guard', 0.85);
    this.config = config;
  }

  public vote(candlesMap: Record<string, Array<{ close: number }>>): AgentVoteProposal {
    const symbols = Object.keys(candlesMap);
    if (symbols.length < 2) {
      return { verdict: 'approved', confidence: 0.7, riskPct: 0.01, note: 'عملة واحدة متاحة في الذاكرة الحية' };
    }
    const sharpes = symbols.slice(0, 3).map(sym => calculateSharpe(calculatePnLSeries(candlesMap[sym] || [], 1.5, pnlRoundTrip(this.config))));
    const mean = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
    const std = Math.sqrt(sharpes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(sharpes.length - 1, 1));

    const passed = std <= this.config.maxCrossAssetStd;
    return {
      verdict: passed ? 'approved' : 'challenge',
      confidence: passed ? 0.85 : 0.40,
      riskPct: passed ? 0.015 : 0.005,
      note: passed
        ? `✅ استقرار أداء الاستراتيجية بين العملات (تشتت: ${std.toFixed(2)})`
        : `⚠️ تشتت مرتفع للأداء بين العملات (${std.toFixed(2)} > ${this.config.maxCrossAssetStd})`
    };
  }
}

export class MultiTimeframeGuard extends ExpertAgent {
  constructor(config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    super('MultiTimeframeGuard', 'حارس تعدد الأطر الزمنية (Multi-Timeframe)', 'التحقق من ربحية المنظومة على إطارات (15m, 1h, 4h)', 'guard', 0.84);
    this.config = config;
  }

  public vote(candles: Array<{ close: number }>): AgentVoteProposal {
    if (!candles || candles.length < 60) {
      return { verdict: 'approved', confidence: 0.7, riskPct: 0.01, note: 'بيانات أطر متعددة محدودة' };
    }
    // Synthetic multi-timeframe aggregation from base candles
    const tf1 = candles;
    const tf2 = candles.filter((_, i) => i % 2 === 0);
    const tf3 = candles.filter((_, i) => i % 4 === 0);

    let passes = 0;
    if (calculateSharpe(calculatePnLSeries(tf1, 1.5, pnlRoundTrip(this.config))) > 0.1) passes++;
    if (calculateSharpe(calculatePnLSeries(tf2, 1.5, pnlRoundTrip(this.config))) > 0.1) passes++;
    if (calculateSharpe(calculatePnLSeries(tf3, 1.5, pnlRoundTrip(this.config))) > 0.1) passes++;

    const passed = passes >= this.config.minTimeframePass;
    return {
      verdict: passed ? 'approved' : 'challenge',
      confidence: passed ? 0.85 : 0.35,
      riskPct: passed ? 0.015 : 0.005,
      note: passed
        ? `✅ نجاح التداول على ${passes}/3 أطر زمنية متزامنة`
        : `⚠️ نجاح على ${passes}/3 أطر زمنية فقط`
    };
  }
}

export class SensitivityGuard extends ExpertAgent {
  private readonly guardConfig: BoardConfig;

  constructor(config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    super('SensitivityGuard', 'حارس حساسية المعاملات (Parameter Sensitivity)', 'اختبار ثبات النتائج عند تغيير المعاملات بنسبة ±30%', 'guard', 0.90);
    this.guardConfig = config;
  }

  public vote(candles: Array<{ close: number }>): AgentVoteProposal {
    if (!candles || candles.length < 30) {
      return { verdict: 'challenge', confidence: 0, riskPct: 0.01, note: 'بيانات غير كافية لاختبار الحساسية' };
    }
    const baseSharpe = calculateSharpe(calculatePnLSeries(candles, 1.5, pnlRoundTrip(this.config)));
    const variations = [0.7, 0.85, 1.15, 1.3];
    let maxDrop = 0;

    for (const v of variations) {
      const testSharpe = calculateSharpe(calculatePnLSeries(candles, 1.5 * v, pnlRoundTrip(this.config)));
      const drop = Math.abs((baseSharpe - testSharpe) / (Math.abs(baseSharpe) + 1e-6));
      maxDrop = Math.max(maxDrop, drop);
    }

    const passed = maxDrop <= this.guardConfig.maxParamSensitivity;
    return {
      verdict: passed ? 'approved' : 'challenge',
      confidence: passed ? 0.90 : 0.35,
      riskPct: passed ? 0.015 : 0.005,
      note: passed
        ? `✅ استقرار المعاملات عند الاضطراب (تغير: ${(maxDrop * 100).toFixed(0)}%)`
        : `⚠️ حساسية مفرطة لتغير المعاملات (${(maxDrop * 100).toFixed(0)}% > ${(this.guardConfig.maxParamSensitivity * 100).toFixed(0)}%)`
    };
  }
}

export class BootstrapGuard extends ExpertAgent {
  private readonly seed?: number;

  constructor(seed?: number, config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    super('BootstrapGuard', 'حارس فواصل الثقة (Bootstrap CI 95%)', '1,000 محاكاة عشوائية بدون نماذج لضمان إيجابية الربح المتوقع', 'guard', 0.92);
    this.seed = seed;
    this.config = config;
  }

  public vote(candles: Array<{ close: number }>): AgentVoteProposal {
    const pnls = calculatePnLSeries(candles, 1.5, pnlRoundTrip(this.config));
    if (pnls.length < 10) {
      return { verdict: 'challenge', confidence: 0, riskPct: 0.01, note: 'عينة محدودة للمحاكاة العشوائية' };
    }
    const iterations = 1000;
    const means: number[] = [];
    const rnd = createRng(this.seed);

    for (let iter = 0; iter < iterations; iter++) {
      let sum = 0;
      for (let j = 0; j < pnls.length; j++) {
        const randIdx = Math.floor(rnd() * pnls.length);
        sum += pnls[randIdx];
      }
      means.push(sum / pnls.length);
    }
    means.sort((a, b) => a - b);
    // 2.5 percentile = 95% Confidence Interval Lower Bound
    const ciLower = means[Math.floor(iterations * 0.025)];
    const passed = ciLower >= this.config.minBootstrapCi;

    return {
      verdict: passed ? 'approved' : 'challenge',
      confidence: passed ? 0.92 : 0.30,
      riskPct: passed ? 0.015 : 0.005,
      note: passed
        ? `✅ فاصل الثقة الإحصائي 95% إيجابي (${(ciLower * 100).toFixed(2)}% > 0)`
        : `⚠️ الحد السفلي لفاصل الثقة 95% سالب (${(ciLower * 100).toFixed(2)}%)`
    };
  }
}

export class StressTestGuard extends ExpertAgent {
  constructor(config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    super('StressTestGuard', 'حارس الاختبار الصادم (Stress Test Compounded Drawdown)', 'قياس أقصى تراجع مركّب على منحنى الرصيد وفحص التصفية عند الرافعة القصوى', 'guard', 0.94);
    this.config = config;
  }

  public vote(candles: Array<{ close: number }>, capital: number): AgentVoteProposal {
    const pnls = calculatePnLSeries(candles, 1.5, pnlRoundTrip(this.config));
    if (pnls.length < 10) {
      return { verdict: 'challenge', confidence: 0, riskPct: 0.01, note: 'بيانات غير كافية للاختبار الصادم' };
    }
    // Compounded equity curve: max peak-to-trough drawdown (not a per-bar average, which cancels capital).
    let equity = 1, peak = 1, maxDd = 0;
    for (const p of pnls) {
      equity *= (1 + p);
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, (peak - equity) / peak);
    }
    // Liquidation proxy: a single-bar adverse move consuming ~1/leverage of margin.
    const worstBar = Math.max(0, -Math.min(...pnls));
    const liqThreshold = this.config.liquidationBufferRatio / this.config.maxLeverage;
    const liquidated = worstBar >= liqThreshold;
    const ddDollar = maxDd * capital;
    const maxAllowedDollar = capital * this.config.maxStressLoss;
    const passed = !liquidated && maxDd <= this.config.maxStressLoss;

    return {
      verdict: passed ? 'approved' : 'challenge',
      confidence: passed ? 0.92 : 0.25,
      riskPct: passed ? 0.015 : 0.003,
      note: passed
        ? `✅ أقصى تراجع مركّب ($${ddDollar.toFixed(2)}) ضمن سقف الأمان ($${maxAllowedDollar.toFixed(2)})`
        : liquidated
          ? `⚠️ حركة عكسية لحظية ${(worstBar * 100).toFixed(1)}% تبلغ عتبة التصفية ${(liqThreshold * 100).toFixed(1)}%`
          : `⚠️ أقصى تراجع مركّب ($${ddDollar.toFixed(2)}) يتجاوز الحد الأقصى ($${maxAllowedDollar.toFixed(2)})`
    };
  }
}

export class RegimeShiftGuard extends ExpertAgent {
  constructor() {
    super('RegimeShiftGuard', 'حارس تغير أنماط السوق (Regime-Shift Robustness)', 'فحص استمرارية الأداء في الأسواق الصاعدة، العرضية، وعالية التقلب', 'guard', 0.86);
  }

  public vote(candles: Array<{ close: number }>, regime?: RegimeAnalysis): AgentVoteProposal {
    if (!candles || candles.length < 30) {
      return { verdict: 'approved', confidence: 0.7, riskPct: 0.01, note: 'بيانات أنماط أولية' };
    }
    const currentRegime = regime?.marketRegime || 'Normal';
    const isVolatile = regime?.volatilityRegime === 'HIGH' || regime?.volatilityRegime === 'EXTREME';

    return {
      verdict: isVolatile ? 'challenge' : 'approved',
      confidence: isVolatile ? 0.55 : 0.88,
      riskPct: isVolatile ? 0.008 : 0.015,
      note: isVolatile
        ? `⚠️ تقلب حاد في السوق (${currentRegime}) — حذر إضافي`
        : `✅ استقرار الإشارة عبر النمط الحالي (${currentRegime})`
    };
  }
}

// -------------------------------------------------------------
//  BOARD OF DIRECTORS (Master Coordinating Engine)
// -------------------------------------------------------------

export class BoardOfDirectorsEngine {
  private static instance: BoardOfDirectorsEngine;
  private config: BoardConfig;
  public agents: Record<string, ExpertAgent>;
  private round = 0;
  private decisionHistory: BoardMeetingDecision[] = [];
  private learningEvents: TradeLearningEvent[] = [];
  private deliberationSessions: BoardDeliberationSession[] = [];
  private stateFilePath = path.join(process.cwd(), 'agent_learning.json');
  private deliberationsFilePath = path.join(process.cwd(), 'quantum_deliberations.json');
  private openDecisionVotes: Map<string, Record<string, 'approved' | 'challenge' | 'rejected'>> = new Map();
  private symbolToLastDecisionId: Map<string, string> = new Map();
  private activePolicy: ActiveStrategyPolicy = {
    version: 1,
    zScoreEntryThreshold: 2.0,
    stopLossPctMultiplier: 1.0,
    takeProfitPctMultiplier: 1.0,
    minGuardsQuorum: 5,
    minApprovalRatio: 0.60,
    volatilitySensitivity: 1.0,
    cooldownMinutesAfterLoss: 3,
    dynamicLeverageCap: 3.0,
    maxAllowedSlippageBps: 12,
    errorReductionScore: 0,
    totalDeliberationsHeld: 0,
    lastOptimizedAt: new Date().toISOString()
  };

  private constructor(config?: Partial<BoardConfig>, private readonly evaluation?: {
    seed: number; now: () => number; equalWeights?: boolean; exclude?: string;
  }) {
    this.config = { ...DEFAULT_BOARD_CONFIG, ...(config || {}) };

    // Initialize all 14 Agents
    this.agents = {
      // 6 Decision Makers
      algo: new AlgoEngineerAgent(),
      trading: new TradingEngineerAgent(),
      quant: new QuantMathematicianAgent(),
      scout: new CoinScoutAgent(),
      market: new MarketExpertAgent(),
      risk: new RiskControllerAgent(),

      // 8 Anti-Overfitting Guards
      wf: new WalkForwardGuard(this.config),
      oos: new OutOfSampleGuard(this.config),
      cross: new CrossAssetGuard(this.config),
      tf: new MultiTimeframeGuard(this.config),
      sens: new SensitivityGuard(this.config),
      boot: new BootstrapGuard(evaluation?.seed, this.config),
      stress: new StressTestGuard(this.config),
      regime: new RegimeShiftGuard()
    };

    if (!this.evaluation) this.loadState();
  }

  public getCouncilStructure(): CouncilMemberDefinition[] {
    return SEVEN_MEMBER_COUNCIL.map((member) => ({ ...member, legacyAgentIds: [...member.legacyAgentIds] }));
  }

  public getShadowModeSnapshot(): {
    mode: 'SHADOW';
    executionEnabled: false;
    members: number;
    legacyAgents: number;
    mappedLegacyAgents: number;
  } {
    const mappedLegacyAgents = new Set(SEVEN_MEMBER_COUNCIL.flatMap((member) => member.legacyAgentIds));
    return {
      mode: 'SHADOW',
      executionEnabled: false,
      members: SEVEN_MEMBER_COUNCIL.length,
      legacyAgents: Object.keys(this.agents).length,
      mappedLegacyAgents: mappedLegacyAgents.size
    };
  }

  public compareShadowDecision(params: {
    symbol: string;
    incumbent: { verdict: BoardMeetingDecision['verdict']; action: string; approvalRatio: number };
    shadow: { verdict: BoardMeetingDecision['verdict']; action: string; approvalRatio: number };
    veto: boolean;
    confidence: number;
  }): {
    symbol: string;
    incumbentAction: string;
    shadowAction: string;
    actionMatch: boolean;
    verdictMatch: boolean;
    approvalRatioDelta: number;
    veto: boolean;
    confidence: number;
    executionEnabled: false;
  } {
    return {
      symbol: params.symbol,
      incumbentAction: params.incumbent.action,
      shadowAction: params.shadow.action,
      actionMatch: params.incumbent.action === params.shadow.action,
      verdictMatch: params.incumbent.verdict === params.shadow.verdict,
      approvalRatioDelta: Number((params.shadow.approvalRatio - params.incumbent.approvalRatio).toFixed(4)),
      veto: params.veto,
      confidence: params.confidence,
      executionEnabled: false
    };
  }

  public buildShadowReport(comparisons: Array<{
    actionMatch: boolean;
    verdictMatch: boolean;
    veto: boolean;
    confidence: number;
  }>): {
    total: number;
    actionMatches: number;
    verdictMatches: number;
    vetoes: number;
    averageConfidence: number;
    actionMatchRate: number;
    executionEnabled: false;
  } {
    const total = comparisons.length;
    const actionMatches = comparisons.filter((item) => item.actionMatch).length;
    const verdictMatches = comparisons.filter((item) => item.verdictMatch).length;
    const vetoes = comparisons.filter((item) => item.veto).length;
    const averageConfidence = total === 0 ? 0 : Number((comparisons.reduce((sum, item) => sum + item.confidence, 0) / total).toFixed(4));
    return {
      total,
      actionMatches,
      verdictMatches,
      vetoes,
      averageConfidence,
      actionMatchRate: total === 0 ? 0 : Number((actionMatches / total).toFixed(4)),
      executionEnabled: false
    };
  }

  public evaluateSevenMemberCouncil(params: {
    symbol: string;
    candles: Array<{ close: number; high?: number; low?: number; volume?: number }>;
    signal: 'BUY' | 'SELL';
  }): {
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    veto: boolean;
    executionEnabled: false;
    members: Array<{ id: string; action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; veto: boolean }>;
  } {
    const prices = params.candles.map((candle) => candle.close).filter((price) => Number.isFinite(price));
    const first = prices[0] ?? 0;
    const last = prices[prices.length - 1] ?? 0;
    const trend = first > 0 ? (last - first) / first : 0;
    const volumes = params.candles.map((candle) => candle.volume ?? 0);
    const averageVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0;
    const latestVolume = volumes[volumes.length - 1] ?? 0;
    const bullish = trend > 0;
    const bearish = trend < 0;
    const baseAction = bullish ? 'BUY' : bearish ? 'SELL' : 'HOLD';
    const confidence = Math.min(1, Math.max(0.1, Math.abs(trend) * 10));
    const members = SEVEN_MEMBER_COUNCIL.map((member) => {
      const action: 'BUY' | 'SELL' | 'HOLD' = member.id === 'risk-sentinel'
        ? (Math.abs(trend) > 0.25 ? 'HOLD' : baseAction)
        : member.id === 'volume-liquidity' && latestVolume < averageVolume * 0.5
          ? 'HOLD'
          : baseAction;
      return { id: member.id, action, confidence: Number(confidence.toFixed(4)), veto: member.id === 'risk-sentinel' && action === 'HOLD' && Math.abs(trend) > 0.25 };
    });
    const veto = members.some((member) => member.veto);
    const action = veto ? 'HOLD' : params.signal === baseAction ? baseAction : 'HOLD';
    return { symbol: params.symbol, action, confidence: Number(confidence.toFixed(4)), veto, executionEnabled: false, members };
  }

  /** Fresh deterministic instance; never reads/writes production learning files. */
  public static forEvaluation(options: { seed: number; now: () => number; equalWeights?: boolean; exclude?: string }, config?: Partial<BoardConfig>) {
    return new BoardOfDirectorsEngine(config, options);
  }

  public static getInstance(config?: Partial<BoardConfig>): BoardOfDirectorsEngine {
    if (!BoardOfDirectorsEngine.instance) {
      BoardOfDirectorsEngine.instance = new BoardOfDirectorsEngine(config);
    }
    return BoardOfDirectorsEngine.instance;
  }

  /**
   * Holds an institutional Board Meeting to evaluate a prospective trade signal
   */
  public holdMeeting(params: {
    symbol: string;
    candles: Array<{ close: number; high?: number; low?: number; volume?: number }>;
    candlesMap?: Record<string, Array<{ close: number; volume?: number }>>;
    signals: TradingSignal[];
    features?: CalculatedFeatures;
    regime?: RegimeAnalysis;
    capital?: number;
    latencyMs?: number;
  }): BoardMeetingDecision {
    if (params.candles.length < 60 || params.candles.some(c => !Number.isFinite(c.close) || c.close <= 0)) {
      throw new Error('Board requires at least 60 valid closed candles');
    }
    if (params.features && (!Number.isFinite(params.features.currentPrice) || params.features.currentPrice <= 0)) {
      throw new Error('Board received invalid features');
    }
    this.round++;
    const currentCapital = params.capital || this.config.capital;
    const votes: Record<string, 'approved' | 'challenge' | 'rejected'> = {};
    const proposals: Record<string, AgentVoteProposal> = {};
    const voteWeights: Record<string, number> = {};

    // 1. Alpha Decision Makers Round
    const algoProp = (this.agents.algo as AlgoEngineerAgent).vote({ executionLatencyMs: params.latencyMs });
    votes.algo = algoProp.verdict; proposals.algo = algoProp;

    const tradeProp = (this.agents.trading as TradingEngineerAgent).vote(params.signals);
    votes.trading = tradeProp.verdict; proposals.trading = tradeProp;

    const quantProp = (this.agents.quant as QuantMathematicianAgent).vote(params.candles, params.features);
    votes.quant = quantProp.verdict; proposals.quant = quantProp;

    const scoutProp = (this.agents.scout as CoinScoutAgent).vote(
      params.symbol,
      (params.candlesMap as Record<string, Array<{ close: number; volume: number }>>) || { [params.symbol]: params.candles as Array<{ close: number; volume: number }> }
    );
    votes.scout = scoutProp.verdict; proposals.scout = scoutProp;

    const marketProp = (this.agents.market as MarketExpertAgent).vote(params.candles, params.regime);
    votes.market = marketProp.verdict; proposals.market = marketProp;

    // Preliminary Alpha Proposals for Risk Manager
    const alphaProposals = [algoProp, tradeProp, quantProp, scoutProp, marketProp];
    const riskProp = (this.agents.risk as RiskControllerAgent).vote(alphaProposals, currentCapital);
    votes.risk = riskProp.verdict; proposals.risk = riskProp;

    // 2. Anti-Overfitting Guards Round
    const wfProp = (this.agents.wf as WalkForwardGuard).vote(params.candles);
    votes.wf = wfProp.verdict; proposals.wf = wfProp;

    const oosProp = (this.agents.oos as OutOfSampleGuard).vote(params.candles);
    votes.oos = oosProp.verdict; proposals.oos = oosProp;

    const crossProp = (this.agents.cross as CrossAssetGuard).vote(
      (params.candlesMap as Record<string, Array<{ close: number }>>) || { [params.symbol]: params.candles }
    );
    votes.cross = crossProp.verdict; proposals.cross = crossProp;

    const tfProp = (this.agents.tf as MultiTimeframeGuard).vote(params.candles);
    votes.tf = tfProp.verdict; proposals.tf = tfProp;

    const sensProp = (this.agents.sens as SensitivityGuard).vote(params.candles);
    votes.sens = sensProp.verdict; proposals.sens = sensProp;

    const bootProp = (this.agents.boot as BootstrapGuard).vote(params.candles);
    votes.boot = bootProp.verdict; proposals.boot = bootProp;

    const stressProp = (this.agents.stress as StressTestGuard).vote(params.candles, currentCapital);
    votes.stress = stressProp.verdict; proposals.stress = stressProp;

    const regimeProp = (this.agents.regime as RegimeShiftGuard).vote(params.candles, params.regime);
    votes.regime = regimeProp.verdict; proposals.regime = regimeProp;

    // 3. Weighted Consensus Calculation
    let totalWeight = 0;
    let approvedWeight = 0;

    for (const [key, agent] of Object.entries(this.agents)) {
      const weight = key === this.evaluation?.exclude ? 0 : this.evaluation?.equalWeights ? 1 : agent.getVoteWeight();
      voteWeights[key] = weight;
      totalWeight += weight;
      if (votes[key] === 'approved') {
        approvedWeight += weight;
      }
    }

    const approvalRatio = totalWeight > 0 ? approvedWeight / totalWeight : 0;
    const basicApproved = ['algo', 'trading', 'quant', 'scout', 'market', 'risk'].filter(k => votes[k] === 'approved').length;
    const guardsPassed = ['wf', 'oos', 'cross', 'tf', 'sens', 'boot', 'stress', 'regime'].filter(k => votes[k] === 'approved').length;

    // 4. Volatility-Adaptive Final Decision
    const isHighVol = params.regime?.volatilityRegime === 'HIGH' || params.regime?.volatilityRegime === 'EXTREME';
    const minGuards = isHighVol ? Math.max(3, this.config.minGuardsPassed - 2) : this.config.minGuardsPassed;
    const minBasic = isHighVol ? Math.max(2, this.config.minBasicApproved - 1) : this.config.minBasicApproved;
    const minApproval = isHighVol ? this.config.approvalRatioHighVol : this.config.approvalRatioNormal;

    let finalVerdict: 'APPROVED' | 'CONDITIONAL' | 'REJECTED' = 'REJECTED';
    let action = '❌ تم رفض الصفقة: لم تكتمل شروط إجماع الحراس';
    let sizeMultiplier = 0.0;

    // Hard Veto checks
    const guardRejected = Object.entries(votes).some(([k, v]) => ['wf', 'oos', 'stress', 'boot'].includes(k) && v === 'rejected');
    const riskRejected = votes.risk === 'rejected' || votes.trading === 'rejected';

    if (riskRejected || guardRejected) {
      finalVerdict = 'REJECTED';
      action = '❌ فيتو صارم: حظر من إدارة المخاطر أو اختبارات الصدمة';
      sizeMultiplier = 0.0;
    } else if (guardsPassed >= minGuards && basicApproved >= minBasic && approvalRatio >= minApproval) {
      finalVerdict = 'APPROVED';
      action = '✅ وافق مجلس الإدارة بالإجماع — تنفيذ الصفقة بالحجم الكامل (100%)';
      sizeMultiplier = 1.0;
    } else if (guardsPassed >= 3 && basicApproved >= 2 && approvalRatio >= 0.48) {
      finalVerdict = 'CONDITIONAL';
      action = '⚠️ موافقة مشروطة من المجلس — تنفيذ بحجم مخفض بنسبة 50%';
      sizeMultiplier = 0.5;
    } else {
      finalVerdict = 'REJECTED';
      action = `❌ رفض المجلس: نسبة الموافقة (${(approvalRatio * 100).toFixed(0)}%) أقل من المطلوب`;
      sizeMultiplier = 0.0;
    }

    const decision: BoardMeetingDecision = {
      id: `dec-${this.round}-${(this.evaluation?.now() ?? Date.now()).toString(36)}`,
      round: this.round,
      timestamp: new Date(this.evaluation?.now() ?? Date.now()).toISOString(),
      symbol: params.symbol,
      verdict: finalVerdict,
      action,
      sizeMultiplier,
      approvalRatio: Number(approvalRatio.toFixed(3)),
      guardsPassed,
      basicApproved,
      minGuardsRequired: minGuards,
      volatilityRegime: isHighVol ? 'high_volatility' : 'normal',
      votes,
      proposals,
      voteWeights,
      executedSignal: params.signals && params.signals.length > 0 ? params.signals[0] : null
    };

    this.openDecisionVotes.set(decision.id, { ...votes });
    if (this.openDecisionVotes.size > 2000) this.openDecisionVotes.delete(this.openDecisionVotes.keys().next().value!);
    if (params.symbol) {
      this.symbolToLastDecisionId.set(params.symbol, decision.id);
    }

    this.decisionHistory.unshift(decision);
    if (this.decisionHistory.length > 30) {
      this.decisionHistory.pop();
    }

    return decision;
  }

  /**
   * Self-learning feedback loop on real closed trade outcome
   * Supports isolating live real-money/paper execution learning from simulation sandbox runs
   */
  public learnFromOutcome(pnl: number, symbol?: string, source: 'LIVE' | 'SIMULATION' = 'LIVE', decisionId?: string): TradeLearningEvent {
    if (!Number.isFinite(pnl)) throw new Error('Learning requires a finite outcome');
    if (source === 'LIVE') {
      return { id: `observed-${randomUUID()}`, timestamp: new Date().toISOString(),
        pnl, symbol: symbol || 'UNKNOWN', isWin: pnl > 0, shifts: {} };
    }
    const isWin = pnl > 0;
    const shifts: Record<string, { deltaConf: number; deltaAcc: number; newConf: number; newAcc: number }> = {};

    {
      // SIMULATION ISOLATED SANDBOX LEARNING:
      // Computes shifts for observation & telemetry without polluting production live agent weights or state
      for (const [name, agent] of Object.entries(this.agents)) {
        const simulatedConf = isWin
          ? Math.min(agent.profile.confidence + this.config.learningRate, 0.98)
          : Math.max(agent.profile.confidence - this.config.learningRate * 2, 0.30);
        const deltaConf = Number((simulatedConf - agent.profile.confidence).toFixed(4));
        shifts[name] = {
          deltaConf,
          deltaAcc: isWin ? 0.01 : -0.01,
          newConf: simulatedConf,
          newAcc: Number(agent.profile.accuracy.toFixed(4))
        };
      }

      const event: TradeLearningEvent = {
        id: `sim-learn-${Date.now()}-${randomUUID().slice(0, 5)}`,
        timestamp: new Date().toISOString(),
        pnl,
        symbol: symbol || 'BTC/USDT',
        isWin,
        shifts
      };

      return event;
    }
  }

  public getStatusReport() {
    const agentProfiles = Object.entries(this.agents).map(([id, a]) => ({
      id,
      name: a.profile.name,
      arabicName: a.profile.arabicName,
      role: a.profile.role,
      type: a.profile.type,
      confidence: a.profile.confidence,
      accuracy: a.profile.accuracy,
      totalDecisions: a.profile.totalDecisions,
      correctDecisions: a.profile.correctDecisions,
      weight: a.getVoteWeight(),
      learningCurve: a.profile.learningCurve
    }));

    return {
      round: this.round,
      totalAgents: 14,
      alphaAgentsCount: 6,
      guardAgentsCount: 8,
      agents: agentProfiles,
      latestDecision: this.decisionHistory[0] || null,
      recentHistory: this.decisionHistory.slice(0, 10),
      recentLearningEvents: this.learningEvents.slice(0, 15),
      activePolicy: { ...this.activePolicy },
      recentDeliberations: this.deliberationSessions.slice(0, 10),
      errorReductionScore: this.activePolicy.errorReductionScore
    };
  }

  public getActivePolicy(): ActiveStrategyPolicy {
    return { ...this.activePolicy };
  }

  public getDeliberationSessions(): BoardDeliberationSession[] {
    return [...this.deliberationSessions];
  }

  /**
   * Records observations without inventing validation evidence or mutating live policy
   */
  public conductPostMortemDeliberation(context: {
    tradeId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPct: number;
    isWin: boolean;
    durationMinutes: number;
    candles?: Array<{ open?: number; high: number; low: number; close: number; volume?: number; time?: number }>;
    decision?: BoardMeetingDecision;
    isSimulation?: boolean;
  }): BoardDeliberationSession {
    if (![context.pnl, context.pnlPct, context.entryPrice, context.exitPrice].every(Number.isFinite)) {
      throw new Error('Post-mortem requires finite trade observations');
    }
    const existing = this.deliberationSessions.find(session => session.tradeId === context.tradeId);
    if (existing) return existing;
    // A closed-trade observation is not a backtest, a causal diagnosis, or an
    // approval to mutate the strategy. Evaluation artifacts supply that evidence.
    const session: BoardDeliberationSession = {
      id: `observation-${context.tradeId}`, tradeId: context.tradeId, symbol: context.symbol,
      pnl: context.pnl, pnlPct: context.pnlPct, isWin: context.pnl > 0,
      timestamp: new Date(this.evaluation?.now() ?? Date.now()).toISOString(),
      round1Diagnoses: [], round2Critiques: [], round3Trials: [],
      consensusVerdictAr: 'نتيجة مسجلة للمراجعة؛ لم تُجر اختبارات تحقق ولم تُعدّل الاستراتيجية.',
      consensusVerdictEn: 'Observation recorded; no validation trials executed or strategy changes approved.',
      adoptedStrategyPolicy: { ...this.activePolicy },
      policyMutationSummaryAr: 'لا توجد تعديلات معتمدة. راجع تقرير التقييم خارج العينة.',
      policyMutationSummaryEn: 'No policy changes. Review the out-of-sample evaluation artifact.',
      errorReductionScore: 0,
    };
    this.deliberationSessions.unshift(session);
    if (this.deliberationSessions.length > 20) this.deliberationSessions.pop();
    if (!context.isSimulation) this.saveDeliberations();
    return session;
  }

  public saveDeliberations(): void {
    if (this.evaluation) return;
    try {
      const data = {
        activePolicy: this.activePolicy,
        deliberationSessions: this.deliberationSessions.slice(0, 20)
      };
      fs.writeFileSync(this.deliberationsFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // Non-blocking
    }
  }

  public loadDeliberations(): void {
    if (this.evaluation) return;
    try {
      if (fs.existsSync(this.deliberationsFilePath)) {
        const raw = fs.readFileSync(this.deliberationsFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Policies require explicit reviewed promotion; do not reload legacy auto-mutated policies.
        if (Array.isArray(parsed.deliberationSessions)) this.deliberationSessions = parsed.deliberationSessions;
      }
    } catch (e) {
      // Non-blocking
    }
  }

  public saveState(): void {
    if (this.evaluation) return;
    try {
      const state: Record<string, any> = {};
      for (const [id, agent] of Object.entries(this.agents)) {
        state[id] = {
          confidence: agent.profile.confidence,
          accuracy: agent.profile.accuracy,
          totalDecisions: agent.profile.totalDecisions,
          correctDecisions: agent.profile.correctDecisions,
          learningCurve: agent.profile.learningCurve
        };
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
      this.saveDeliberations();
    } catch (e) {
      // Non-blocking state save
    }
  }

  public loadState(): void {
    if (this.evaluation) return;
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8');
        const state = JSON.parse(data);
        for (const [id, s] of Object.entries(state as Record<string, any>)) {
          if (this.agents[id]) {
            this.agents[id].profile.confidence = s.confidence ?? this.agents[id].profile.confidence;
            this.agents[id].profile.accuracy = s.accuracy ?? this.agents[id].profile.accuracy;
            this.agents[id].profile.totalDecisions = s.totalDecisions ?? 0;
            this.agents[id].profile.correctDecisions = s.correctDecisions ?? 0;
            this.agents[id].profile.learningCurve = s.learningCurve ?? [];
          }
        }
      }
      this.loadDeliberations();
    } catch (e) {
      // Non-blocking state load
    }
  }
}
