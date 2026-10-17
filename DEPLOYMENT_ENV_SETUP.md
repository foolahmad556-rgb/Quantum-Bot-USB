// DEPLOYMENT_ENV_SETUP.md
# Environment Configuration for Deployment

## 1. GitHub Repository
- **URL**: https://github.com/palc88-stack/Quantum-Bot-USB
- **Branch**: master (tracking origin/master)
- **Status**: 4 commits ahead, ready to push

## 2. Cloudflare Pages (Frontend)
- **Project**: quantum-bot-usb
- **Build Command**: `npm run build`
- **Build Output**: `dist/`
- **Domain**: https://quantumbot-dashboard.pages.dev
- **Files Modified**: None (build artifacts only)

## 3. Cloudflare Worker (Webhook)
- **Endpoint**: POST /webhook/telegram
- **Required Bindings**:
  - D1 Database: `DB` (Tareth D1)
  - Environment Variable: `JWT_SECRET`
- **Bearer Token**: Required in Authorization header
- **Handler**: src/app/demo.ts (bootstraps HourlyArchiver)

### Environment Variables for Worker:
```
JWT_SECRET=[REDACTED]
BINANCE_TESTNET_KEY=[REDACTED]
BINANCE_TESTNET_SECRET=[REDACTED]
TELEGRAM_BOT_TOKEN=[REDACTED]
```

## 4. Cloudflare D1 (Database)
- **Database Name**: Tareth D1
- **Tables Required**:
  - `users` (for email authentication)
  - `trades` (historical archive)
  - `signals` (signal history)
  - `positions` (position snapshots)

### D1 Schema:
```sql
-- Users table (for email login)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Trades archive (hourly batch writes)
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- Signals archive (hourly batch)
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL,
  confidence REAL NOT NULL,
  timestamp INTEGER NOT NULL
);

-- Positions snapshot (hourly batch)
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  size REAL NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  timestamp INTEGER NOT NULL
);
```

## 5. Botkeep Cloud
- **Container Image**: Built from Dockerfile
- **Port**: 3000 (exposed)
- **Environment Variables**:
  - `BINANCE_TESTNET_KEY=[REDACTED]`
  - `BINANCE_TESTNET_SECRET=[REDACTED]`
  - `TELEGRAM_BOT_TOKEN=[REDACTED]`
  - `CLOUDFLARE_D1_TOKEN=[REDACTED]`
  - `JWT_SECRET=[REDACTED]`

## Deployment Order
1. **GitHub**: `git push -u origin master` (push 4 commits)
2. **Cloudflare Pages**: Deploy frontend from dist/
3. **Cloudflare D1**: Verify schema, create tables
4. **Cloudflare Worker**: Deploy webhook handler
5. **Botkeep**: Build and deploy Docker container

## Post-Deployment Tests
- [ ] GitHub repo shows all 4 new commits
- [ ] Frontend loads at https://quantumbot-dashboard.pages.dev
- [ ] Webhook responds to POST /webhook/telegram with Bearer token
- [ ] D1 queries return user/trade/signal data
- [ ] Bot starts on Botkeep without errors
- [ ] Trading pipeline connects to Binance Testnet
- [ ] Signals flow through DurableStateManager to D1 archive

## Verification Commands

### Test Webhook:
```bash
curl -X POST https://5uq4nr.bot-keep.xyz/webhook/telegram \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTC/USDT","type":"ENTRY_LONG","confidence":75}'
```

### Test D1 Query:
```sql
SELECT COUNT(*) as trade_count FROM trades WHERE timestamp > datetime('now', '-1 day');
```

### Test Frontend:
```bash
curl -s https://quantumbot-dashboard.pages.dev | grep -c "<html"
# Should return: 1 (page loaded successfully)
```

## Success Criteria
- ✅ All 35 tests passing
- ✅ Build successful (no errors)
- ✅ Zero D1 write violations (<100k/day)
- ✅ Webhook endpoint responsive
- ✅ Trading signals 60%+ confidence
- ✅ 24/7 uptime achieved
