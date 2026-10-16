export type DriftStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface DriftInput {
  approvedReturn: number; liveReturn: number;
  approvedSharpe: number; liveSharpe: number;
  approvedWinRate: number; liveWinRate: number;
}

export interface DriftReport { input: DriftInput; status: DriftStatus; alerts: string[]; metrics: { returnDelta: number; sharpeDelta: number; winRateDelta: number } }

const finite = (name: string, value: number): number => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
};

export function evaluateDrift(input: DriftInput): DriftReport {
  const approvedReturn = finite('approvedReturn', input.approvedReturn);
  const liveReturn = finite('liveReturn', input.liveReturn);
  const approvedSharpe = finite('approvedSharpe', input.approvedSharpe);
  const liveSharpe = finite('liveSharpe', input.liveSharpe);
  const approvedWinRate = finite('approvedWinRate', input.approvedWinRate);
  const liveWinRate = finite('liveWinRate', input.liveWinRate);
  if (approvedReturn === 0) throw new Error('approvedReturn must not be zero');
  const returnDelta = liveReturn - approvedReturn;
  const sharpeDelta = liveSharpe - approvedSharpe;
  const winRateDelta = liveWinRate - approvedWinRate;
  const alerts: string[] = [];
  if (returnDelta <= -Math.abs(approvedReturn) * 0.50) alerts.push('return drift is critical');
  else if (returnDelta <= -Math.abs(approvedReturn) * 0.25) alerts.push('return drift warning');
  if (sharpeDelta <= -Math.max(1, Math.abs(approvedSharpe) * 0.50)) alerts.push('sharpe drift is critical');
  else if (sharpeDelta <= -Math.abs(approvedSharpe) * 0.25) alerts.push('sharpe drift warning');
  if (winRateDelta <= -0.15) alerts.push('win rate drift is critical');
  else if (winRateDelta <= -0.05) alerts.push('win rate drift warning');
  const critical = alerts.some((a) => a.includes('critical'));
  return { input, status: critical ? 'CRITICAL' : alerts.length ? 'WARNING' : 'HEALTHY', alerts, metrics: { returnDelta, sharpeDelta, winRateDelta } };
}
