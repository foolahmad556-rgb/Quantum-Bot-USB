# Implementation status — 2026-10-19

## Implemented in the working tree

- Operator-only registration and server-side allowlist checks; bounded auth rate limits; JWT algorithm pinning; structured control-action audit events.
- Auth database outside public assets; public static allowlist; separate frontend `dist` and backend `build`; non-root Docker runtime and secret/data exclusions.
- Same-origin local API default, environment-specific Pages builds, corrected frontend route names and authenticated board/status calls.
- Actual D1 readiness probes and bounded requests; readable Worker contract, three additive migrations and executable SQL contract tests. Arbitrary remote SQL was removed rather than exposed.
- Durable manual-order claims, stable client IDs, accurate REJECTED/PENDING/FILLED responses and serialized order-event persistence. Unknown claims require reconciliation rather than blind resubmission.
- Account execution lease with expiry, entry gating and shutdown release; storage/lease failure halts entries while retaining reduce-only capability.
- Telegram Worker/backend secret and sender checks; durable successful-update deduplication; no trading commands over Telegram ingress.
- SQLite upgraded to 6.x; drizzle-kit moved to development dependencies. Production npm audit reported zero findings on this run.
- Strategy veto and invalid-data handling; council stale/gapped data abstention; missing-data guards no longer fabricate positive PnL.
- Isolated seeded board evaluation; adaptive/mean-reversion/candle-council/simple-filter/weighted-board/equal-board/cost-aligned comparisons; per-member weight ablations preserve hard risk vetoes.
- Non-overlapping fixed-horizon diagnostics with next-open execution assumptions, fees/spread/slippage/funding charges and participation cap. Chronological walk-forward selection uses validation only with a horizon purge before test windows.
- Decision/vote traces, rejection attribution, sample counts, net returns, drawdown and confidence diagnostics in a reproducible report.
- Removed fabricated post-mortem timing/profit/trial-success claims and automatic policy adoption. Estimated outcomes cannot train live weights. This is a deliberate safety boundary until verified-fill attribution exists.
- CI gates and explicit staging/production release workflows; immutable Botkeep image tags; operating/migration/rollback instructions.

## Local validation

The Node 22 Alpine Docker image built successfully and ran as UID 1000. Both the rebuilt local server and the container returned health 200, UI 200, readiness 503 without D1 configuration, and 404 for private database/server downloads. The temporary container was removed after verification. The local preview runs with autostart disabled.

`npm run check`: typecheck, 55 test files and full frontend/backend build passed. New tests exercise the actual Express process, SQLite-backed Worker SQL, order deduplication, lease failure, Telegram ingress and strategy evaluation. Existing mocked exchange tests remain offline contracts. `npm run test:testnet` formally skipped its two checks without opt-in credentials. `npm run test:parity` verifies offline decision replay only.

`npm run evaluate` produced six synthetic scenario comparisons and chronological walk-forward diagnostics. The original weighted board admitted no trades in the tested scenarios; the report marks this as insufficient evidence, not a successful strategy. Rejection attribution showed the existing OOS guard rejecting the sampled windows. Its proxy tests a long-only price-return stream, not the actual strategy's independently measured net trade returns; a verified strategy-return validation contract is still needed. No live threshold was relaxed to force trades or make a report look better.

Reports are generated under ignored `data/evaluation/`; a compact checked-in review summary is in `docs/EVALUATION_RESULTS.md`. Synthetic performance is not a profitability claim.

## External blockers and remaining milestones

- Historical download failed: the environment's proxy returned 403 for Binance; direct Node fetch also failed DNS. Allowed-domain additions were saved to the cloud environment draft, but saving is not runtime activation or publication.
- D1/Cloudflare, Botkeep, Telegram and Testnet endpoint/credential bindings are absent from this machine. No deployment or live trade was performed.
- Actual Botkeep persistent storage, image rollout, hosted readiness, Telegram delivery, Cloudflare-hosted D1 behavior and fault recovery must be verified in staging.
- No claim of 24/7 reliability or improved financial performance: real historical datasets, exchange execution tests and a continuous staging observation period remain required.

## Next GitHub milestones

1. **Staging integration:** configure GitHub Environments and service settings from OPERATIONS.md, migrate/backup auth data, apply D1 migrations, deploy immutable backend/UI/Worker versions and run the integration checklist.
2. **Verified execution ledger:** persist exchange fill IDs, realized PnL, fees/assets and decision linkage; reconcile partial/external closes and restarts; make repeated outcomes idempotent before enabling any learning.
3. **Evidence-driven council:** replace guard price-return proxies with independently produced strategy-return samples; calibrate probabilities on validation data; evaluate diversity/correlated votes and stable improvements on untouched historical periods.
4. **Operations completion:** backup/restore drills, retention jobs, external alert delivery, secret scanning configuration, browser E2E, sustained Testnet failover and monitoring.
5. **Controlled promotion:** explicit risk limits and reviewed promotion/rollback artifacts; PAPER → Testnet → limited LIVE only after the previous milestones pass.

Changes are implemented locally and ready for code review. Pushing/merging, creating remote GitHub milestones, applying hosted settings and publishing are distinct actions, not implied by this status document.
