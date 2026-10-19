export type CouncilSide = 'BUY' | 'SELL' | 'ABSTAIN';

export interface CouncilVote {
  member: string;
  side: CouncilSide;
  confidence: number;
}

import type { Candle } from '../domain/types';

export interface CandleCouncilOptions {
  intervalMs: number;
  asOf: number;
}

/** Independent, deterministic experts evaluate closed candles only. */
export function evaluateCandleCouncil(candles: Candle[], options: CandleCouncilOptions): CouncilVote[] {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0 || !Number.isFinite(options.asOf)) {
    throw new Error('Invalid candle council time bounds');
  }
  const closed = candles.filter((c) => c.timestamp + options.intervalMs <= options.asOf &&
    [c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    c.open > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.close > 0
  ).sort((a, b) => a.timestamp - b.timestamp);
  const abstain = (member: string): CouncilVote => ({ member, side: 'ABSTAIN', confidence: 0 });
  if (closed.length < 21) return ['trend', 'mean-reversion', 'breakout', 'momentum'].map(abstain);
  if (options.asOf - (closed.at(-1)!.timestamp + options.intervalMs) > options.intervalMs ||
      closed.some((c, i) => i > 0 && c.timestamp - closed[i - 1].timestamp !== options.intervalMs)) {
    return ['trend', 'mean-reversion', 'breakout', 'momentum'].map(abstain);
  }
  const tail = closed.slice(-21);
  const last = tail[tail.length - 1];
  const pct = (a: number, b: number) => (a / b) - 1;
  const vote = (member: string, value: number, threshold: number): CouncilVote => {
    if (!Number.isFinite(value) || Math.abs(value) < threshold) return abstain(member);
    return { member, side: value > 0 ? 'BUY' : 'SELL', confidence: Math.min(0.99, 0.52 + Math.abs(value) * 10) };
  };
  const mean20 = tail.slice(0, 20).reduce((s, c) => s + c.close, 0) / 20;
  const priorHigh = Math.max(...tail.slice(0, 20).map(c => c.high));
  const priorLow = Math.min(...tail.slice(0, 20).map(c => c.low));
  const momentum = pct(last.close, tail[tail.length - 4].close);
  return [
    vote('trend', pct(last.close, mean20), 0.0005),
    vote('mean-reversion', pct(mean20, last.close), 0.001),
    last.close > priorHigh ? vote('breakout', pct(last.close, priorHigh), 0) : last.close < priorLow ? vote('breakout', pct(last.close, priorLow), 0) : abstain('breakout'),
    vote('momentum', momentum, 0.001),
  ];
}

export interface CouncilDecision {
  side: 'BUY' | 'SELL';
  votes: number;
  confidence: number;
  members: string[];
}

export interface CouncilConfig {
  quorum: number;
  minimumConfidence: number;
  vetoMembers: string[];
}

const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  quorum: 2,
  minimumConfidence: 0.52,
  vetoMembers: [],
};

/** Deterministic, non-executing consensus function. Rejects ties and vetoes. */
export function decideByCouncil(
  votes: CouncilVote[],
  config: Partial<CouncilConfig> = {},
): CouncilDecision | null {
  const settings = { ...DEFAULT_COUNCIL_CONFIG, ...config };
  if (!Number.isInteger(settings.quorum) || settings.quorum < 1) throw new Error('Council quorum must be a positive integer');
  if (!Number.isFinite(settings.minimumConfidence) || settings.minimumConfidence < 0 || settings.minimumConfidence > 1) {
    throw new Error('Council minimumConfidence must be between 0 and 1');
  }
  if (votes.some((vote) => settings.vetoMembers.includes(vote.member) && vote.side !== 'ABSTAIN')) return null;

  const eligible = votes.filter((vote) =>
    vote.side !== 'ABSTAIN' && Number.isFinite(vote.confidence) &&
    vote.confidence >= settings.minimumConfidence && vote.confidence <= 1,
  );
  const buyVotes = eligible.filter((vote) => vote.side === 'BUY');
  const sellVotes = eligible.filter((vote) => vote.side === 'SELL');
  const winner = buyVotes.length === sellVotes.length ? null : buyVotes.length > sellVotes.length ? buyVotes : sellVotes;
  if (!winner || winner.length < settings.quorum) return null;
  return {
    side: winner[0].side as 'BUY' | 'SELL',
    votes: winner.length,
    confidence: winner.reduce((total, vote) => total + vote.confidence, 0) / winner.length,
    members: winner.map((vote) => vote.member),
  };
}
