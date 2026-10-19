# Operations: Pages → Botkeep → Worker/D1

## Ownership and environments

Pages contains static UI only (`dist`). Botkeep runs `build/server.cjs` and is the only component that submits exchange orders. The Worker authenticates D1 operations and accepts Telegram status commands. Use separate staging/production Workers, D1 databases, Pages projects, Botkeep services, Telegram bots and exchange credentials.

All replicas for the same exchange account MUST use the same non-secret `EXCHANGE_ACCOUNT_ID` and the same D1 database. A 30-second Worker lease is renewed every 5 seconds; the server stops admitting entries after a conservative 20-second local deadline and halts on renewal/storage failure. Recheck the lease immediately before exchange submission. This reduces overlapping execution but is not exchange-enforced fencing or a multi-region exactly-once guarantee. Do not run rolling overlapping replicas without a staging failover exercise. Reduce-only exits remain possible when entry permission is lost.

## Local commands

Build the runtime with `docker build -t quantum-bot:review .`. In a managed proxy environment, forward the existing proxy variables with `--build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY`. If your organization provides a trusted CA file, mount it only during dependency installation with `--secret id=build_ca,src="$NODE_EXTRA_CA_CERTS"`. A builder that cannot resolve the configured proxy may need an administrator-provided `--add-host` mapping. Do not hard-code an environment's proxy IP into the Dockerfile or disable certificate verification.

```sh
npm ci
npm run check
npm run test:parity
npm run evaluate
```

The evaluation command writes `data/evaluation/latest.json`. It does not contact an exchange or promote strategy parameters. For an existing regular OHLCV JSON dataset:

```sh
npm run evaluate -- --input data/historical/BTCUSDT_1h/candles.json --interval-ms 3600000
```

Without input it uses deterministic synthetic scenarios, explicitly labeled diagnostic. Historical provenance, exchange-specific funding, intrabar stops, liquidity and exchange execution parity require separate validation. `npm run data:fetch` currently downloads Binance **spot** candles; do not label them Futures execution evidence. Network access to `api.binance.com` is needed. Proxy-restricted environments may require supported Node proxy settings; never disable TLS verification.

## Runtime settings

Set real secrets in platform/GitHub environment settings, never in this repository or chat. `.env.example` is the configuration inventory.

| Setting | Purpose |
| --- | --- |
| `JWT_SECRET` | Stable signing key, at least 32 characters |
| `OPERATOR_SECRET` | Account provisioning/headless operator authentication |
| `ADMIN_EMAILS` | Explicit operator email allowlist; removing an address denies its JWTs |
| `AUTH_DB_PATH` | SQLite file on a persistent Botkeep volume, outside `dist`/`build` |
| `APP_URL` | Exact frontend origin allowed by CORS |
| `VITE_API_URL` | Backend origin at **frontend build time**; absent means same origin |
| `D1_API_URL`, `D1_API_SECRET` | Worker endpoint and matching authenticated storage credential |
| `EXCHANGE_ACCOUNT_ID` | Stable lease key shared by every replica for the account |
| `EXECUTION_MODE` | `PAPER` by default; separately validate `TESTNET` before any LIVE rollout |
| `AUTO_START_TRADING`, `AUTOSTART_TRADING` | Both false during migration/staging validation |
| `CONFIRM_LIVE_TRADING` | Explicit LIVE entry interlock; keep false until release criteria pass |
| `EXCHANGE_API_KEY`, `EXCHANGE_API_SECRET` | Exchange credentials for the selected environment |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | Notification destination |
| `TELEGRAM_WEBHOOK_SECRET` | Same value on Worker, backend and Telegram webhook configuration |
| `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated exact allowed Telegram IDs |
| `TRUST_PROXY_HOPS` | Default 0; set only after verifying the actual ingress topology |

Botkeep persistent-volume support and mount ownership must be checked on the actual platform. The image runs as the `node` user. A filesystem path inside an ephemeral container is not durable storage. If persistent volumes are unavailable, shared authentication storage must be implemented before production; do not silently fall back to lost accounts after each deployment.

### Existing accounts

1. Stop the old service and confirm no SQLite writer is active.
2. Take a recoverable backup of its `users.db` and any `-wal`/`-shm` files using SQLite backup/checkpoint facilities.
3. Migrate into the configured persistent `AUTH_DB_PATH`, preserving any existing destination; do not overwrite it blindly.
4. Start the updated backend, confirm the DB initialization log, and test an allowlisted account.
5. Verify `/users.db`, `/server.cjs`, `/server.cjs.map` return 404. Remove exposed legacy copies from the old public deployment after the backup is verified.

For a new account, set `USER_EMAIL`, `USER_PASSWORD`, `OPERATOR_SECRET` and `API_BASE_URL` securely, then run `npx tsx scripts/provision-operator.ts`. The email must already be in `ADMIN_EMAILS`. Public sign-up is disabled; tokens/passwords are not printed by the script.

### Health and control

- `/api/health`: liveness only, HTTP 200 does not mean trading is ready.
- `/api/ready`: HTTP 200 only after authentication DB and D1 schema probes succeed; 503 is expected without D1. Configure readiness monitoring here.
- `/api/system-health`, `/api/live-status`, board/history/control APIs require an operator bearer token.
- `/brain-ws` requires a first JSON message `{ "token": "..." }` within 5 seconds; never put tokens in query strings.
- Manual orders require an `Idempotency-Key` (16–100 alphanumeric/underscore/hyphen characters). Reuse the same key and identical body after an uncertain response. A claimed or pending order is **not executed**. Reconcile the stable exchange client ID before any manual retry under a new key.
- `/api/board/learn` rejects externally supplied outcomes. Current price-estimated outcomes do not mutate live learning weights or policy. Post-mortems are observations, not fabricated successful validation trials.

## Worker/D1 migration and Telegram

Apply migrations in order using Wrangler: `npx wrangler@4 d1 migrations apply DB --remote --config api/wrangler.toml`. That configuration identifies the existing database; staging must use its own generated configuration, not the production ID. The deployment workflow generates `wrangler.deploy.json` from environment-specific GitHub variables.

The client/Worker contract intentionally does not support arbitrary `/d1/query` or `/d1/exec`. Supported operations cover trades, prices, state, balances, signals, shadow reports, manual order records, and account leases. Contract tests run Worker SQL against SQLite; hosted Cloudflare D1 still needs staging validation.

The Worker ingress is `/webhook/telegram`, handling `/start` and `/status` only. It requires the Telegram secret and both sender/chat allowlists. Successful updates are deduplicated in D1. Delivery retries are at least once: a timeout after the backend sends a notification can duplicate that notification; no financial command is accepted here. Direct backend ingress also checks secret and allowlists.

After deploying and verifying both services, explicitly run `npx tsx scripts/configure-telegram.ts` with the intended environment's settings. No install, test or deployment script silently registers a live webhook.

## GitHub and release order

Create GitHub Environments `staging` and `production`. Protect production with required reviewers and branch rules. The dispatch workflows default to staging and run the reusable CI workflow first; CI runs typecheck, the tests, replay parity, full build, production dependency audit and synthetic evaluation artifacts.

Environment variables: `BOTKEEP_URL`, `D1_API_URL`, `D1_DATABASE_NAME`, `D1_DATABASE_ID`, `WORKER_NAME`, `CLOUDFLARE_PAGES_PROJECT`, Telegram allowed IDs. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_API_SECRET`, `TELEGRAM_WEBHOOK_SECRET`; Botkeep runtime also needs the settings above. `VITE_API_URL` comes from that environment's `BOTKEEP_URL` during Pages build.

1. Record the current D1 recovery point and verify an export/restore into a separate staging database. Never restore over live data as an experiment.
2. Apply additive migrations and deploy the Worker; authenticated `/d1/health` must pass and unauthenticated access must return 401.
3. Build/push the immutable Git SHA image using the Botkeep image workflow. **The workflow does not deploy Botkeep.** Configure the service to use that tag through its supported platform deployment mechanism, then verify the running version and `/api/ready`.
4. Deploy Pages with the correct backend origin, then test login, protected status and rejection of unauthorized controls from a browser.
5. Configure Telegram, verify an allowed user's `/status`, and verify an unlisted sender is rejected.
6. Exercise lease contention, storage loss, process kill/restart, exchange disconnect/reconnect, partial fills and order reconciliation in Testnet.
7. Promote only after operational tests and independently reviewed historical/out-of-sample evaluation pass. Keep previous immutable image and frontend/Worker versions for rollback. Roll back code compatibly with additive schema; never drop production tables as an automatic rollback.

Data retention/backup jobs, hosted alert routing, a verified-fill learning ledger, full browser E2E coverage and platform-specific zero-downtime rollout remain follow-up work. Do not interpret a successful local build or synthetic evaluation as completion of these hosted checks.
