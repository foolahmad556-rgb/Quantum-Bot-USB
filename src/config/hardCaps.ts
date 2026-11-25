/**
 * Hard risk caps. Tier tables and runtime config may be MORE conservative than these,
 * never less. Env vars can only lower a cap, never raise it above the built-in ceiling.
 */
function lowerOnly(envName: string, ceiling: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, ceiling) : ceiling;
}

export const HARD_CAPS = Object.freeze({
  /** Max leverage on any position. */
  maxLeverage: lowerOnly('HARD_MAX_LEVERAGE', 5),
  /** Max single-position notional as a fraction of equity. */
  maxTradeNotionalPct: lowerOnly('HARD_MAX_TRADE_NOTIONAL_PCT', 0.30),
  /** Max equity risked to the stop on one trade (fraction). */
  maxRiskPerTradePct: lowerOnly('HARD_MAX_RISK_PER_TRADE_PCT', 0.01),
});

export function clampLeverage(lev: number): number {
  if (!Number.isFinite(lev) || lev < 1) return 1;
  return Math.min(lev, HARD_CAPS.maxLeverage);
}
