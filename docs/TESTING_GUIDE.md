# Testing Guide

## Test Suite Overview

### Levels

1. **Unit Tests** - Individual functions
2. **Integration Tests** - API endpoints + database
3. **Scenario Tests** - Market conditions (trending, sideways, volatile)
4. **Backtesting** - Historical data performance

---

## Running Tests

### 1. Unit Tests

```bash
npm run test
```

Tests files: `src/**/*.test.ts`

---

## 2. Integration Tests

### Authentication Tests

```bash
# Test register endpoint
curl -X POST "https://5uq4nr.bot-keep.xyz/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test'$(date +%s)'@example.com",
    "password": "testpass123"
  }'

# Expected: success=true, token returned
```

### Trading Endpoints Tests

```bash
# 1. Get valid token
TOKEN=$(curl -s -X POST "https://5uq4nr.bot-keep.xyz/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"hermes@ai.com","password":"217446217"}' | \
  grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 2. Test live status
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '.'

# 3. Test trading start/stop
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/trading/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# 4. Verify status changed
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '.isRunning'

# 5. Test trading stop
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/trading/stop" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### KillSwitch Tests

```bash
# Test reset
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/killswitch/reset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Verify NORMAL status
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '.killSwitchLevel'

# Test trigger (EMERGENCY ONLY)
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/killswitch/trigger" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"HARD_HALT","reason":"Test trigger"}'

# Verify HARD_HALT
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '.killSwitchLevel'
```

---

## 3. Scenario Testing

### Scenario 1: Trending Market (UP)

**Conditions:**
- Prices continuously rising
- RSI > 65
- Moving average uptrend
- Volume increasing

**Expected Bot Behavior:**
- Open LONG positions
- Scale into winners
- High confidence signals
- Close shorts

**Test Steps:**
```bash
# Monitor live-status during trending period
watch -n 5 'curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq "{positions:.positions,confidence:.confidence,dailyPnl:.balance.dailyPnl}"'
```

**Success Criteria:**
- ✅ Positions opened in direction
- ✅ Win rate > 60%
- ✅ PnL positive
- ✅ Confidence rising

---

### Scenario 2: Sideways Market

**Conditions:**
- Price oscillates within range
- RSI 40-60
- Low volatility
- No directional bias

**Expected Bot Behavior:**
- Reduce position size
- Wait for breakout
- Tighter stops
- Low confidence

**Test Steps:**
```bash
# Check that bot is cautious
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '.balance | {margin, positions: (.usedMargin)}'
```

**Success Criteria:**
- ✅ Few new positions
- ✅ Confidence low (< 35%)
- ✅ Margin usage low
- ✅ No large losses

---

### Scenario 3: Volatile Market (Flash Crash)

**Conditions:**
- Sudden 10%+ price drop
- High volatility
- Gap down open
- Liquidations visible

**Expected Bot Behavior:**
- Trigger KillSwitch if equity drops > 5%
- Close losing positions
- Reduce leverage
- Lock in profits

**Test Steps:**
```bash
# Monitor equity during crash
while true; do
  curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '{equity:.balance.totalEquity, pnl:.balance.dailyPnl, killswitch:.killSwitchLevel}'
  sleep 2
done
```

**Success Criteria:**
- ✅ KillSwitch triggered if needed
- ✅ Equity preserved
- ✅ Losses capped
- ✅ No liquidations

---

### Scenario 4: Connection Loss

**Conditions:**
- Backend unreachable
- Binance API timeout
- Network partition

**Expected Bot Behavior:**
- Retry connection
- Alert via Telegram
- Hold positions (no panic sells)
- Reconnect gracefully

**Test Steps:**
```bash
# Simulate backend down
docker stop quantum-bot-backend 2>/dev/null || echo "Container not running"

# Monitor alerts
sleep 30

# Restart
docker start quantum-bot-backend 2>/dev/null || npm start &
```

**Success Criteria:**
- ✅ Telegram alert sent
- ✅ Positions held (not closed)
- ✅ Auto-reconnect successful
- ✅ Trading resumes

---

## 4. Backtesting

### Run Historical Backtest

```bash
npm run backtest:full
```

This runs against historical Binance data for all major pairs.

**Output:**
```
Backtest Results:
├─ Period: 2024-01-01 to 2026-10-17
├─ Total Trades: 2,547
├─ Win Rate: 62.3%
├─ Profit Factor: 2.14
├─ Max Drawdown: -8.5%
├─ Sharpe Ratio: 1.87
├─ Monthly Return: 5.2%
└─ Slippage Impact: -0.8%
```

### Parity Test (Live vs Backtest)

```bash
npm run test:parity
```

Compares live trading performance vs historical backtest.

**Threshold Checks:**
- Live win rate within ±5% of backtest
- Live PnL factor within ±10% 
- No systematic underperformance

---

## Test Checklist

### Pre-Deployment

- [ ] All unit tests pass (`npm test`)
- [ ] No TypeScript errors (`npm run lint`)
- [ ] Build succeeds (`npm run build:full`)
- [ ] Live status endpoint responds
- [ ] Auth endpoints working (register/login/validate)
- [ ] Trading start/stop endpoints functional
- [ ] KillSwitch reset working

### Post-Deployment

- [ ] Dashboard loads (`https://quantumbot-dashboard.pages.dev`)
- [ ] Login successful with test credentials
- [ ] Live status showing correct data
- [ ] Telegram alerts configured
- [ ] Health check script running
- [ ] First trade executed without error
- [ ] PnL calculation accurate

### Weekly

- [ ] Run full backtest suite
- [ ] Check parity vs live
- [ ] Review all alert triggers
- [ ] Analyze trade quality
- [ ] Check for drift in signals

### Monthly

- [ ] Deep review of drawdown periods
- [ ] Correlation analysis with market
- [ ] Slippage impact assessment
- [ ] Confidence calibration check
- [ ] Risk metrics review

---

## Known Issues & Workarounds

### Issue: KillSwitch Stuck in HARD_HALT

**Workaround:**
```bash
TOKEN=$(curl -s -X POST "..." | grep -o '"token":"[^"]*' | cut -d'"' -f4)
curl -X POST "https://5uq4nr.bot-keep.xyz/api/protected/killswitch/reset" \
  -H "Authorization: Bearer $TOKEN"
```

### Issue: Confidence Too Low

**Cause:** Sideways market, weak signals
**Workaround:** Wait for trend, or manually adjust thresholds in risk engine

### Issue: Connection Timeouts

**Cause:** Network latency or backend overload
**Workaround:** Retry endpoint, check Botkeep logs, restart if needed

