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
