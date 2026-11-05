import { KillSwitch } from '../risk/KillSwitch';

export function failClosedOnInvalidEquity(equityValue: unknown, killSwitch: KillSwitch): boolean {
  const equity = typeof equityValue === 'number' ? equityValue : Number(equityValue);
  if (Number.isFinite(equity) && equity > 0) return true;
  killSwitch.trigger(
    'HARD_HALT',
    'Exchange reconciliation failed: invalid or non-positive account equity',
    'AUTO_RISK_ENGINE',
  );
  return false;
}

export function watchdogMayRestart(isRunning: boolean, killSwitch: KillSwitch): boolean {
  return !isRunning && !killSwitch.isActive();
}

/** Clear only a halt caused by a transient reconciliation/lease outage after a verified snapshot. */
export function recoverTransientReconciliationHalt(killSwitch: KillSwitch): boolean {
  if (!killSwitch.isActive()) return false;
  const reason = killSwitch.getHistory()[0]?.reason || '';
  if (!/reconciliation|execution lease|heartbeat|snapshot unavailable/i.test(reason)) return false;
  killSwitch.reset();
  return true;
}

export function restorePersistentKillSwitch(
  savedState: { level: Parameters<KillSwitch['trigger']>[0]; active: boolean; reason: string } | null,
  killSwitch: KillSwitch,
): boolean {
  if (!savedState?.active || savedState.level === 'NORMAL') return false;
  return killSwitch.trigger(
    savedState.level,
    `Restored from persistent state: ${savedState.reason}`,
    'AUTO_RISK_ENGINE',
  );
}
