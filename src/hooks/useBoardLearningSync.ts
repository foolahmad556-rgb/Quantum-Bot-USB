import type { ActiveStrategyPolicy, BoardDeliberationSession, CouncilMemberDefinition } from '../strategies/BoardOfDirectorsEngine';
import { authenticatedApiFetch } from '../lib/api.ts';
/**
 * useBoardLearningSync.ts
 * ====================================================================
 * Real-Time Quantum Board of Directors State & Self-Learning Sync Hook
 * ====================================================================
 * Manages the live state of the 14 Autonomous Quantum Agents:
 * - 6 Alpha Decision Makers
 * - 8 Anti-Overfitting Guards
 *
 * Features:
 * - Real-time `learn_from_outcome` execution directly within React state
 * - Automatic synchronizer with server WebSocket (/brain-ws) & REST API (/api/board/learn)
 * - Fine-grained shift tracking (delta confidence & delta accuracy) per agent
 * - Real-time performance curve evolution (historical accuracy sparkline series)
 * ====================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { secureUUID } from '../utils/seededRng';

export interface AgentProfileReport {
  id: string;
  name: string;
  arabicName: string;
  role: string;
  type: 'alpha' | 'guard';
  confidence: number;
  accuracy: number;
  totalDecisions: number;
  correctDecisions: number;
  weight: number;
  learningCurve: number[];
}

export interface AgentConfidenceShift {
  agentId: string;
  deltaConf: number;
  deltaAcc: number;
  direction: 'up' | 'down';
  timestamp: number;
}

export interface BoardDecision {
  round: number;
  timestamp: string;
  symbol: string;
  verdict: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  action: string;
  sizeMultiplier: number;
  approvalRatio: number;
  guardsPassed: number;
  basicApproved: number;
  minGuardsRequired: number;
  volatilityRegime: 'normal' | 'high_volatility';
  votes: Record<string, 'approved' | 'challenge' | 'rejected'>;
  proposals: Record<string, {
    verdict: string;
    riskPct: number;
    confidence: number;
    note: string;
    metric?: string | number;
    marketBias?: string;
  }>;
  voteWeights: Record<string, number>;
}

export interface TradeLearningEvent {
  id: string;
  timestamp: string;
  pnl: number;
  symbol: string;
  isWin: boolean;
  reason?: string;
  shifts: Record<string, { deltaConf: number; deltaAcc: number; newConf: number; newAcc: number }>;
  source?: 'LIVE' | 'SIMULATION';
}

export interface BoardStatusReport {
  activePolicy?: ActiveStrategyPolicy;
  recentDeliberations?: BoardDeliberationSession[];
  councilMembers?: CouncilMemberDefinition[];
  round: number;
  totalAgents: number;
  alphaAgentsCount: number;
  guardAgentsCount: number;
  agents: AgentProfileReport[];
  latestDecision: BoardDecision | null;
  recentHistory: BoardDecision[];
  recentLearningEvents?: TradeLearningEvent[];
}

export type AgentVote = 'approved' | 'challenge' | 'rejected';

// Mirrors BoardOfDirectorsEngine DEFAULT_BOARD_CONFIG.learningRate and its clamps
// (learn(): +learningRate on correct, -2*learningRate on wrong, floor 0.30, ceiling 0.98).
export const LEARNING_RATE = 0.05;
export const CONFIDENCE_MIN = 0.30;
export const CONFIDENCE_MAX = 0.98;

// Confidence only moves once an agent has this many decisions (the decision being recorded counts).
export const MIN_DECISIONS_FOR_CONFIDENCE_UPDATE = 10;

// |pnl| magnitude scaling: scale = clamp(|pnl| / PNL_REFERENCE, PNL_SCALE_MIN, PNL_SCALE_MAX).
// Bounded so one trade moves confidence by at most LEARNING_RATE * 2 * PNL_SCALE_MAX (0.20),
// which cannot drive an agent from the ceiling to the floor in a single trade.
export const PNL_REFERENCE = 0.05;
export const PNL_SCALE_MIN = 0.5;
export const PNL_SCALE_MAX = 2.0;

export function computePnlMagnitudeScale(pnl: number): number {
  if (Number.isNaN(pnl)) return PNL_SCALE_MIN;
  const raw = Math.abs(pnl) / PNL_REFERENCE;
  return Math.min(Math.max(raw, PNL_SCALE_MIN), PNL_SCALE_MAX);
}

/** Per-agent credit: winning trade credits 'approved'; losing trade credits 'challenge' or 'rejected'.
 *  No recorded vote falls back to isWin (engine behaviour). */
export function agentVoteWasCorrect(vote: AgentVote | undefined, isWin: boolean): boolean {
  if (vote === undefined) return isWin;
  return isWin ? vote === 'approved' : vote !== 'approved';
}

/** Pure per-agent learning step. Counts the decision always; moves confidence only past the sample gate. */
export function applyAgentLearning(
  agent: Pick<AgentProfileReport, 'confidence' | 'accuracy' | 'totalDecisions' | 'correctDecisions' | 'learningCurve'>,
  opts: { agentWasCorrect: boolean; magnitudeScale: number }
): {
  confidence: number;
  accuracy: number;
  totalDecisions: number;
  correctDecisions: number;
  weight: number;
  learningCurve: number[];
  deltaConf: number;
  deltaAcc: number;
} {
  const prevConf = agent.confidence;
  const prevAcc = agent.accuracy;

  const newTotal = agent.totalDecisions + 1;
  const newCorrect = agent.correctDecisions + (opts.agentWasCorrect ? 1 : 0);
  const newAcc = Number((newCorrect / Math.max(newTotal, 1)).toFixed(4));

  let newConf = prevConf;
  if (newTotal >= MIN_DECISIONS_FOR_CONFIDENCE_UPDATE) {
    const baseDelta = opts.agentWasCorrect ? LEARNING_RATE : -LEARNING_RATE * 2;
    const scaled = baseDelta * opts.magnitudeScale;
    newConf = opts.agentWasCorrect
      ? Math.min(Number((prevConf + scaled).toFixed(4)), CONFIDENCE_MAX)
      : Math.max(Number((prevConf + scaled).toFixed(4)), CONFIDENCE_MIN);
  }

  const newWeight = Number((newConf * (0.5 + newAcc * 0.5)).toFixed(4));
  const curve = [...(agent.learningCurve || [])];
  curve.push(newAcc);
  if (curve.length > 25) curve.shift();

  return {
    confidence: newConf,
    accuracy: newAcc,
    totalDecisions: newTotal,
    correctDecisions: newCorrect,
    weight: newWeight,
    learningCurve: curve,
    deltaConf: Number((newConf - prevConf).toFixed(4)),
    deltaAcc: Number((newAcc - prevAcc).toFixed(4)),
  };
}

// Seven-member council display templates. Each member owns primary and secondary files.
const SEED_FIXTURES: AgentProfileReport[] = [
  // 6 Decision Makers
  { id: 'algo', name: 'AlgoEngineer', arabicName: 'خبير الخوارزميات والهندسة', role: 'فحص سلامة التنفيذ والتعقيد الحسابي', type: 'alpha', confidence: 0.85, accuracy: 0.65, totalDecisions: 24, correctDecisions: 16, weight: 0.70, learningCurve: [0.55, 0.58, 0.62, 0.60, 0.65] },
  { id: 'trading', name: 'TradingEngineer', arabicName: 'خبير الصفقات وتطابق الإشارات', role: 'التحقق من تناغم إشارات الدخول والوقف', type: 'alpha', confidence: 0.82, accuracy: 0.62, totalDecisions: 24, correctDecisions: 15, weight: 0.66, learningCurve: [0.50, 0.54, 0.58, 0.61, 0.62] },
  { id: 'quant', name: 'QuantMathematician', arabicName: 'خبير الرياضيات والإحصاء', role: 'فحص الالتواء والتفلطح والتوزيع الشاذ', type: 'alpha', confidence: 0.88, accuracy: 0.70, totalDecisions: 24, correctDecisions: 17, weight: 0.75, learningCurve: [0.60, 0.62, 0.65, 0.68, 0.70] },
  { id: 'scout', name: 'CoinScout', arabicName: 'خبير استطلاع العملات والسيولة', role: 'تقييم الزخم النسبي وأحجام التداول', type: 'alpha', confidence: 0.78, accuracy: 0.58, totalDecisions: 24, correctDecisions: 14, weight: 0.61, learningCurve: [0.52, 0.53, 0.56, 0.55, 0.58] },
  { id: 'market', name: 'MarketExpert', arabicName: 'خبير بنية السوق والاتجاه العام', role: 'تحديد الاتجاه الأكبر وتقاطع المتوسطات', type: 'alpha', confidence: 0.84, accuracy: 0.64, totalDecisions: 24, correctDecisions: 15, weight: 0.69, learningCurve: [0.56, 0.59, 0.60, 0.63, 0.64] },
  { id: 'risk', name: 'RiskController', arabicName: 'خبير إدارة المخاطر وحماية الرصيد', role: 'حق النقض الصارم وحساب كسر كيلي', type: 'alpha', confidence: 0.94, accuracy: 0.80, totalDecisions: 24, correctDecisions: 19, weight: 0.85, learningCurve: [0.70, 0.72, 0.75, 0.78, 0.80] },

  // 8 Anti-Overfitting Guards
  { id: 'wf', name: 'WalkForwardGuard', arabicName: 'حارس التحليل الأمامي (WF)', role: 'قياس فجوة الأداء بين التدريب والاختبار', type: 'guard', confidence: 0.90, accuracy: 0.72, totalDecisions: 24, correctDecisions: 17, weight: 0.77, learningCurve: [0.62, 0.65, 0.68, 0.70, 0.72] },
  { id: 'oos', name: 'OutOfSampleGuard', arabicName: 'حارس العينة الخارجية (OOS)', role: 'التحقق من احتفاظ الاستراتيجية بكفاءتها', type: 'guard', confidence: 0.88, accuracy: 0.69, totalDecisions: 24, correctDecisions: 17, weight: 0.74, learningCurve: [0.60, 0.62, 0.65, 0.67, 0.69] },
  { id: 'cross', name: 'CrossAssetGuard', arabicName: 'حارس تعدد العملات', role: 'فحص عدم اقتصار الربح على عملة واحدة', type: 'guard', confidence: 0.86, accuracy: 0.66, totalDecisions: 24, correctDecisions: 16, weight: 0.71, learningCurve: [0.58, 0.60, 0.62, 0.64, 0.66] },
  { id: 'tf', name: 'MultiTimeframeGuard', arabicName: 'حارس تعدد الأطر الزمنية', role: 'التحقق من ربحية المنظومة على عدة أطر', type: 'guard', confidence: 0.84, accuracy: 0.65, totalDecisions: 24, correctDecisions: 16, weight: 0.69, learningCurve: [0.55, 0.58, 0.60, 0.62, 0.65] },
  { id: 'sens', name: 'SensitivityGuard', arabicName: 'حارس حساسية المعاملات', role: 'اختبار ثبات النتائج عند اضطراب المعاملات', type: 'guard', confidence: 0.90, accuracy: 0.74, totalDecisions: 24, correctDecisions: 18, weight: 0.78, learningCurve: [0.64, 0.68, 0.70, 0.71, 0.74] },
  { id: 'boot', name: 'BootstrapGuard', arabicName: 'حارس فواصل الثقة (CI 95%)', role: '1,000 محاكاة عشوائية لضمان الربح الإيجابي', type: 'guard', confidence: 0.92, accuracy: 0.76, totalDecisions: 24, correctDecisions: 18, weight: 0.81, learningCurve: [0.66, 0.70, 0.72, 0.74, 0.76] },
  { id: 'stress', name: 'StressTestGuard', arabicName: 'حارس الاختبار الصادم', role: 'قياس أسوأ 20% هبوط تاريخي لحماية الرصيد', type: 'guard', confidence: 0.94, accuracy: 0.82, totalDecisions: 24, correctDecisions: 20, weight: 0.85, learningCurve: [0.72, 0.75, 0.78, 0.80, 0.82] },
  { id: 'regime', name: 'RegimeShiftGuard', arabicName: 'حارس تغير أنماط السوق', role: 'فحص استمرارية الأداء في جميع الأنماط', type: 'guard', confidence: 0.86, accuracy: 0.68, totalDecisions: 24, correctDecisions: 16, weight: 0.72, learningCurve: [0.60, 0.62, 0.64, 0.66, 0.68] },
];

// Neutral starting state. SEED_FIXTURES are display fixtures only: they are used as live weights
// when no server snapshot is present (the server effect only overwrites when 14 agents arrive),
// so track counts and accuracy start at zero/neutral here.
const SEED_NEUTRAL_ACCURACY = 0.5;
const INITIAL_AGENTS: AgentProfileReport[] = SEED_FIXTURES.map(a => ({
  ...a,
  totalDecisions: 0,
  correctDecisions: 0,
  accuracy: SEED_NEUTRAL_ACCURACY,
  weight: Number((a.confidence * (0.5 + SEED_NEUTRAL_ACCURACY * 0.5)).toFixed(4)),
  learningCurve: [SEED_NEUTRAL_ACCURACY],
}));

export function useBoardLearningSync(initialBoardData?: BoardStatusReport | null) {
  const [agents, setAgents] = useState<AgentProfileReport[]>(() => {
    return initialBoardData?.agents && initialBoardData.agents.length === 7
      ? initialBoardData.agents
      : INITIAL_AGENTS;
  });

  const [latestDecision, setLatestDecision] = useState<BoardDecision | null>(() => {
    return initialBoardData?.latestDecision || null;
  });

  const [decisionHistory, setDecisionHistory] = useState<BoardDecision[]>(() => {
    return initialBoardData?.recentHistory || [];
  });

  const [round, setRound] = useState<number>(() => {
    return initialBoardData?.round || 1;
  });

  const [recentShifts, setRecentShifts] = useState<Record<string, AgentConfidenceShift>>({});
  const [learningLog, setLearningLog] = useState<TradeLearningEvent[]>(() => {
    return initialBoardData?.recentLearningEvents || [];
  });

  const [lastTradeResult, setLastTradeResult] = useState<{
    pnl: number;
    symbol: string;
    isWin: boolean;
    timestamp: number;
  } | null>(null);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const syncTimeoutRef = useRef<any>(null);
  // Latest-value refs so learnFromOutcome (stable useCallback) reads current agents and votes synchronously.
  const agentsRef = useRef<AgentProfileReport[]>(agents);
  const latestDecisionRef = useRef<BoardDecision | null>(latestDecision);
  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { latestDecisionRef.current = latestDecision; }, [latestDecision]);

  // Sync with incoming server status report if it provides fresher data
  useEffect(() => {
    if (initialBoardData) {
      if (initialBoardData.agents && initialBoardData.agents.length > 0) {
        setAgents(prev => {
          // Merge preserving active visual delta cues
          return initialBoardData.agents.map(serverAgent => {
            const local = prev.find(p => p.id === serverAgent.id);
            return {
              ...serverAgent,
              learningCurve: (serverAgent.learningCurve && serverAgent.learningCurve.length > 0)
                ? serverAgent.learningCurve
                : (local?.learningCurve || [serverAgent.accuracy])
            };
          });
        });
      }
      setLatestDecision(initialBoardData.latestDecision ?? null);
      if (initialBoardData.recentHistory) {
        setDecisionHistory(initialBoardData.recentHistory);
      }
      if (typeof initialBoardData.round === 'number') {
        setRound(initialBoardData.round);
      }
      if (initialBoardData.recentLearningEvents && initialBoardData.recentLearningEvents.length > 0) {
        setLearningLog(initialBoardData.recentLearningEvents);
      }
    }
  }, [initialBoardData]);

  /**
   * 🧠 Core `learn_from_outcome` logic, mirroring BoardOfDirectorsEngine.learnFromOutcome.
   * source 'LIVE' (default): updates all 14 agents, counts decisions, syncs with server.
   * source 'SIMULATION': returns shifts for telemetry only; no agent state, log, or server writes.
   * Each agent is credited by its own vote from the latest decision for this symbol;
   * with no recorded vote, credit falls back to isWin (engine behaviour).
   */
  const learnFromOutcome = useCallback((pnl: number, symbol = 'BTC/USDT', reason?: string, source: 'LIVE' | 'SIMULATION' = 'LIVE') => {
    const isWin = pnl > 0;
    const now = Date.now();
    const magnitudeScale = computePnlMagnitudeScale(pnl);
    const lastDecision = latestDecisionRef.current;
    const votes = lastDecision && lastDecision.symbol === symbol ? lastDecision.votes : undefined;

    const newShifts: Record<string, AgentConfidenceShift> = {};
    const shiftsRecord: Record<string, { deltaConf: number; deltaAcc: number; newConf: number; newAcc: number }> = {};

    const nextAgents = agentsRef.current.map(agent => {
      const agentWasCorrect = agentVoteWasCorrect(votes?.[agent.id] as AgentVote | undefined, isWin);
      const r = applyAgentLearning(agent, { agentWasCorrect, magnitudeScale });

      newShifts[agent.id] = {
        agentId: agent.id,
        deltaConf: r.deltaConf,
        deltaAcc: r.deltaAcc,
        direction: agentWasCorrect ? 'up' : 'down',
        timestamp: now
      };
      shiftsRecord[agent.id] = { deltaConf: r.deltaConf, deltaAcc: r.deltaAcc, newConf: r.confidence, newAcc: r.accuracy };

      return {
        ...agent,
        confidence: r.confidence,
        accuracy: r.accuracy,
        totalDecisions: r.totalDecisions,
        correctDecisions: r.correctDecisions,
        weight: r.weight,
        learningCurve: r.learningCurve
      };
    });

    const newEvent: TradeLearningEvent = {
      id: `${source === 'LIVE' ? 'learn' : 'sim-learn'}-${now}-${secureUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      pnl,
      symbol,
      isWin,
      reason,
      shifts: shiftsRecord,
      source
    };

    if (source === 'SIMULATION') {
      return newEvent;
    }

    agentsRef.current = nextAgents;
    setAgents(nextAgents);
    setRecentShifts(newShifts);
    setLastTradeResult({ pnl, symbol, isWin, timestamp: now });
    setLearningLog(prev => [newEvent, ...prev.slice(0, 19)]);

    // Clear visual shift badge pulses after 4.5 seconds
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      setRecentShifts({});
    }, 4500);

    // UI learning is display-only; verified server outcomes own production learning.
    return newEvent;
  }, []);

  /**
   * Trigger an instant board meeting for a given symbol
   */
  const holdMeeting = useCallback(async (symbol = 'BTC/USDT') => {
    setIsSyncing(true);
    try {
      const res = await authenticatedApiFetch('/api/board/hold-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      const data = await res.json();
      if (data.success && data.decision) {
        setLatestDecision(data.decision);
        setDecisionHistory(prev => [data.decision, ...prev.slice(0, 19)]);
        setRound(data.decision.round);
      }
      return data.decision;
    } catch (err) {
      console.error('Failed to hold board meeting:', err);
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    agents,
    latestDecision,
    decisionHistory,
    round,
    recentShifts,
    learningLog,
    lastTradeResult,
    isSyncing,
    learnFromOutcome,
    holdMeeting
  };
}
