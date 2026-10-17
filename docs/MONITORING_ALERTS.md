# Monitoring & Alerts Setup

## Real-time Status Monitoring

### 1. Health Check Script

```bash
#!/bin/bash
# health-check.sh - Monitor bot status every 60 seconds

API_URL="https://5uq4nr.bot-keep.xyz/api/live-status"
TELEGRAM_BOT_TOKEN=[REDACTED]
TELEGRAM_CHAT_ID=[REDACTED]

send_alert() {
  local message="$1"
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_CHAT_ID" \
    -d "text=$message" \
    -d "parse_mode=HTML" > /dev/null
}

while true; do
  RESPONSE=$(curl -s "$API_URL")
  
  # Extract fields
  IS_RUNNING=$(echo $RESPONSE | grep -o '"isRunning":[^,}]*' | cut -d':' -f2)
  KILLSWITCH=$(echo $RESPONSE | grep -o '"killSwitchLevel":"[^"]*' | cut -d'"' -f4)
  EQUITY=$(echo $RESPONSE | grep -o '"totalEquity":[^,}]*' | cut -d':' -f2)
  POSITIONS=$(echo $RESPONSE | grep -o '"positions":\[\{' | wc -l)
  
  # Alert conditions
  if [ "$IS_RUNNING" != "true" ]; then
    send_alert "⚠️ <b>Bot Stopped!</b>\nKillSwitch: $KILLSWITCH\nEquity: \$$EQUITY"
  fi
  
  if [ "$KILLSWITCH" == "HARD_HALT" ]; then
    send_alert "🛑 <b>HARD_HALT Triggered!</b>\nEquity: \$$EQUITY\nPositions: $POSITIONS"
  fi
  
  # Log status
  echo "[$(date)] Running: $IS_RUNNING | KillSwitch: $KILLSWITCH | Equity: \$$EQUITY | Positions: $POSITIONS"
  
  sleep 60
done
```

### 2. Equity Tracking

Monitor daily PnL and alert on losses:

```bash
#!/bin/bash
# equity-tracker.sh

LAST_EQUITY_FILE="/tmp/last_equity.txt"
LOSS_THRESHOLD=50  # Alert if loss > $50

API_URL="https://5uq4nr.bot-keep.xyz/api/live-status"
TELEGRAM_BOT_TOKEN=[REDACTED]
TELEGRAM_CHAT_ID=[REDACTED]

send_alert() {
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_CHAT_ID" \
    -d "text=$1" \
    -d "parse_mode=HTML" > /dev/null
}

RESPONSE=$(curl -s "$API_URL")
CURRENT_EQUITY=$(echo $RESPONSE | grep -o '"totalEquity":[^,}]*' | cut -d':' -f2)
DAILY_PNL=$(echo $RESPONSE | grep -o '"dailyPnl":[^,}]*' | cut -d':' -f2)

if [ -f "$LAST_EQUITY_FILE" ]; then
  LAST_EQUITY=$(cat "$LAST_EQUITY_FILE")
  CHANGE=$(echo "$CURRENT_EQUITY - $LAST_EQUITY" | bc)
  
  if (( $(echo "$CHANGE < -$LOSS_THRESHOLD" | bc -l) )); then
    send_alert "📉 <b>Large Loss Detected!</b>\nChange: \$$CHANGE\nCurrent Equity: \$$CURRENT_EQUITY\nDaily PnL: \$$DAILY_PNL"
  fi
fi

echo $CURRENT_EQUITY > "$LAST_EQUITY_FILE"
```

---

## Telegram Bot Alerts

### Alert Types

| Alert | Condition | Action |
|-------|-----------|--------|
| 🛑 HARD_HALT | KillSwitch triggered | Check risk engine logs |
| ⚠️ Bot Stopped | isRunning = false | Restart via API or manual |
| 📉 Large Loss | dailyPnl < -$50 | Review trades, check market |
| 💼 Position Opened | New position | Log entry price, risk |
| 🎯 Position Closed | Position reduced | Log exit price, PnL |
| ❌ Connection Failed | API unreachable | Check backend status |

### Setup Telegram Alert

1. Create bot via BotFather: `t.me/BotFather`
2. Get token: `[REDACTED]`
3. Get chat ID: Message bot, then:
   ```bash
   curl -s "https://api.telegram.org/bot[TOKEN]/getUpdates" | grep chat_id
   ```
4. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=[REDACTED]
   TELEGRAM_CHAT_ID=[REDACTED]
   ```

---

## Dashboard Metrics

### Key Metrics to Track

**Performance:**
- Total trades executed
- Win rate (%)
- Avg win/loss ratio
- Max drawdown
- Sharpe ratio

**Execution:**
- Order fill rate (%)
- Avg fill time (ms)
- Slippage (bps)
- Commission paid

**Risk:**
- Current margin level
- Liquidation distance
- Max leverage used
- Portfolio concentration

**Availability:**
- Uptime (%)
- API latency (ms)
- Data stale alerts
- Reconnect frequency

### Monitor via Status Endpoint

```bash
curl -s "https://5uq4nr.bot-keep.xyz/api/live-status" | jq '
{
  status: .isRunning,
  mode: .executionMode,
  equity: .balance.totalEquity,
  daily_pnl: .balance.dailyPnl,
  margin: .balance.marginLevel,
  positions: (.positions | length),
  killswitch: .killSwitchLevel
}'
```

---

## Production Monitoring Checklist

- [ ] Health check script running on cron every minute
- [ ] Equity tracker monitoring daily losses
- [ ] Telegram alerts configured with valid token/chat ID
- [ ] All thresholds tuned to acceptable ranges
- [ ] Logs rotated (daily, compress old)
- [ ] Backup monitoring (failover bot ready)
- [ ] Weekly manual audit of trades
- [ ] Monthly deep-dive review (drawdown, risk metrics)
