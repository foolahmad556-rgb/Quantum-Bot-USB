# Synthetic evaluation findings

Diagnostic only: fixed-horizon next-open returns, no actual exchange orders. Live stop/target execution, historical provenance and future liquidity are not validated here.

| Scenario | Adaptive trades / net % | Mean reversion trades / net % | Candle council trades / net % | Weighted board trades |
| --- | --- | --- | --- | --- |
| up | 19 / 0.3286 | 0 / 0.0000 | 55 / 0.6609 | 0 |
| down | 17 / 0.0129 | 0 / 0.0000 | 53 / 0.3126 | 0 |
| range | 27 / -0.2219 | 18 / 0.2260 | 48 / -1.4911 | 0 |
| crash | 26 / -0.2291 | 2 / 0.0308 | 47 / -1.0351 | 0 |
| volatile | 24 / 0.8091 | 4 / 0.9475 | 62 / -2.2140 | 0 |
| illiquid | 24 / -0.0000 | 4 / 0.0000 | 47 / -0.0000 | 0 |

All scenarios had 63 non-overlapping decision opportunities per model. Results include non-trading observations. Zero trades are insufficient evidence, not zero-risk profitability. The simple council lost money in multiple diagnostic scenarios; no candidate has been promoted.

The weighted/equal/cost-aligned boards admitted no trades in this diagnostic run. OOS rejection is the dominant hard-veto bottleneck. Current guard PnL proxies are long-only one-bar price returns and do not establish the edge of the strategy actually proposed. Correcting that evidence contract requires real strategy-return data, not loosening risk vetoes until synthetic tests trade.

The runner also produces per-member weight ablations, cost-aligned diagnostics, vote/proposal traces, confidence bins and purged chronological walk-forward results. Hard risk vetoes remain active in ablations. Historical input is supported but was not available because the environment proxy denied Binance access.

Regenerate using `npm run evaluate`; full machine-readable results: `data/evaluation/latest.json`. The inputs are seeded and hashed. These numbers are diagnostic fixtures and must not be presented as historical trading performance.
