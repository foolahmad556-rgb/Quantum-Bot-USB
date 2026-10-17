# Basel AlgoCore - Startup Guide

## Prerequisites

- Node.js 18+
- SQLite3
- Binance Testnet API Keys
- Cloudflare D1 Database
- Telegram Bot Token

## Environment Setup

### 1. Create `.env` file

```env
# Binance
BINANCE_API_KEY=[REDACTED]
BINANCE_API_SECRET=[REDACTED]
BINANCE_TESTNET=true

# Telegram
TELEGRAM_BOT_TOKEN=[REDACTED]
TELEGRAM_CHAT_ID=[REDACTED]

# JWT Authentication
JWT_SECRET=[REDACTED]

# Cloudflare D1
D1_DATABASE_ID=[REDACTED]
D1_TOKEN=[REDACTED]

# App URL
APP_URL=https://quantumbot-dashboard.pages.dev
API_BASE_URL=https://5uq4nr.bot-keep.xyz

# Execution
APEX_RUN_CYCLES=0
NODE_ENV=production
```

### 2. Initialize Database

```bash
npm run build:full
npm start
```

Server will create `dist/users.db` automatically.

---

## Quick Start

### Development

```bash
npm run dev
```

Server runs on `http://localhost:3000` (or configured PORT)

### Production (Botkeep)

Deployment automatic via GitHub Actions:
- Push to `master` branch
- Workflows trigger: CI, Cloudflare Pages, Botkeep deploy
- No manual intervention needed

---

## Authentication Flow

### 1. Register New User

```bash
curl -X POST "https://5uq4nr.bot-keep.xyz/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepass123"
  }'
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGc...",
  "user": {
    "userId": "user_1792235827706_p2w4aa7",
    "email": "user@example.com"
  }
}
```

### 2. Login

```bash
curl -X POST "https://5uq4nr.bot-keep.xyz/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepass123"
  }'
```

### 3. Validate Token

```bash
curl -X GET "https://5uq4nr.bot-keep.xyz/api/auth/validate" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Bot Control Endpoints

### Start Trading

**Requires:** Valid JWT token

```bash
TOKEN=$(curl -s -X POST "https://5uq4nr.bot-keep.xyz/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"hermes@ai.com","password":"217446217"}' | \
  grep -o '"token":"[^"]*' | cut -d'"' -f4)

curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/trading/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "isRunning": true
}
```

### Stop Trading

```bash
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/trading/stop" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### Reset KillSwitch

```bash
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/killswitch/reset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "reset": true
}
```

### Trigger KillSwitch (Emergency Stop)

```bash
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/killswitch/trigger" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"HARD_HALT","reason":"Manual emergency stop"}'
```

---

## Monitor Live Status

```bash
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status"
```

Response:
```json
{
  "success": true,
  "isRunning": true,
  "executionMode": "TESTNET",
  "killSwitchLevel": "NORMAL",
  "balance": {
    "totalEquity": 4583.37,
    "availableCash": 4581.45,
    "usedMargin": 5,
    "marginLevel": 917.37,
    "freeMargin": 4578.37,
    "unrealizedPnl": 1.91,
    "realizedPnl": 0,
    "dailyPnl": 0,
    "currency": "USDT"
  },
  "positions": [
    {
      "symbol": "SUN/USDT",
      "size": -1818,
      "entryPrice": 0.016496,
      "currentPrice": 0.016496,
      "unrealizedPnl": -0.139986,
      "leverage": 20
    }
  ],
  "timestamp": 1792235879994
}
```

---

## Dashboard Access

**Frontend:** `https://quantumbot-dashboard.pages.dev`
**Backend:** `https://5uq4nr.bot-keep.xyz`

Login with credentials:
- Email: `hermes@ai.com`
- Password: `217446217`

---

## Troubleshooting

### Issue: "Invalid email or password"
- Ensure account exists in database
- Check password hashing (bcryptjs)
- Verify email matches exactly

### Issue: "Invalid or expired token"
- Token expires after ~24 hours
- Get new token via login endpoint
- Verify token in Authorization header format: `Bearer <token>`

### Issue: "KillSwitch HARD_HALT"
- Call `/api/protected/killswitch/reset`
- Check error logs for trigger reason
- May be automatic: risk limit breached, equity loss, or invalid balance

### Issue: "Trading Allowed: ❌"
- Confidence too low (< 35%)
- Market conditions unfavorable
- Check market regime in status

---

## Deployment

### GitHub Actions Workflows

All automatic on `git push origin master`:

1. **Basel Quantum CI** - Build & test
2. **Deploy to Cloudflare Pages** - Frontend
3. **Deploy to BOTKEEP.CLOUD** - Backend

View status:
```bash
gh run list --limit 5
```

---

## Logs & Debugging

### Server Logs (Botkeep)
Available in Botkeep dashboard under "Logs" tab.

### Local Development
```bash
npm run dev 2>&1 | tail -50
```

### Watch Specific Component
```bash
grep -i "trading\|error\|killswitch" logs.txt
```

---

## Key Files

- `server.ts` - Main Express server + API endpoints
- `src/contexts/AuthContext.tsx` - Frontend auth logic
- `src/app/TradingPipeline.ts` - Core trading engine
- `src/risk/RiskEngine.ts` - Risk management
- `src/lib/jwt-auth.ts` - JWT generation/verification
- `.env` - Secrets (never commit)
