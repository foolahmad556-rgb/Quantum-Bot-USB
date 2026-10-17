# Webhook Validation Guide

## Automated Tests (Local)

All webhook tests pass automatically:

```bash
npm test -- WebhookEndpoint.test.ts
```

Status: ✅ 16 comprehensive tests
- POST /webhook validation
- Bearer token authentication
- Request/response formats
- Error handling
- Rate limiting

---

## Manual Validation (After Deployment)

### 1. **Verify Webhook Endpoint Accessibility**

```bash
# Test from TradingView or curl (replace DOMAIN with your backend)
curl -X POST https://5uq4nr.bot-keep.xyz/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
  -d '{
    "symbol": "BTCUSDT",
    "action": "buy",
    "price": 43000,
    "quantity": 0.1,
    "timestamp": '$(date +%s)'000
  }'

# Expected response (200):
{
  "success": true,
  "message": "Signal queued",
  "signalId": "sig_1729174559000_abc123"
}
```

### 2. **Test Rate Limiting**

```bash
# Send 5 rapid requests to same endpoint
for i in {1..5}; do
  curl -X POST https://5uq4nr.bot-keep.xyz/webhook \
    -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
    -d '{"symbol":"BTCUSDT","action":"buy","price":43000}'
  sleep 0.1
done

# Expected: All 200s (15 req/min per IP is the limit)
```

### 3. **Monitor Webhook Queue**

**In TradingView or your signal source:**
1. Send 3-5 test signals
2. Check bot logs:
   ```bash
   tail -f /path/to/bot/logs/webhook.log
   ```
3. Verify signals appear as: `"Signal queued: BUY BTCUSDT @ 43000"`

### 4. **Check Telegram Notifications**

If Telegram configured:
1. Send webhook signal
2. Verify message in Telegram channel within 2 seconds
3. Format: `📊 BUY BTCUSDT @ 43,000 USDT (0.1 qty)`

### 5. **Validate Error Handling**

```bash
# Missing token header (should fail 401)
curl -X POST https://5uq4nr.bot-keep.xyz/webhook \
  -d '{"symbol":"BTCUSDT","action":"buy"}'
# Expected: 401 Unauthorized

# Invalid JSON (should fail 400)
curl -X POST https://5uq4nr.bot-keep.xyz/webhook \
  -H "Authorization: Bearer TOKEN" \
  -d 'invalid json'
# Expected: 400 Bad Request
```

---

## Post-Deployment Checklist

- [ ] Endpoint responds to POST /webhook (200 OK)
- [ ] Bearer token auth enforced (401 without token)
- [ ] Test signal appears in bot logs
- [ ] Telegram notification sent (if configured)
- [ ] Rate limiting working (>15 req/min = 429)
- [ ] Multiple signals queue correctly
- [ ] No signals lost in processing

---

## Troubleshooting

**Signal not received?**
1. Check Bearer token is valid
2. Check webhook URL is correct (https://, not http://)
3. Check server logs: `tail -f server.log`
4. Verify firewall allows inbound on port 443 (HTTPS)

**Getting 401 Unauthorized?**
- Token in header must be: `Authorization: Bearer YOUR_TOKEN`
- Not `Bearer: YOUR_TOKEN` ❌
- Not `Token YOUR_TOKEN` ❌

**Getting 429 Too Many Requests?**
- Rate limit: 15 requests per minute per IP
- Wait 1 minute, try again
- Stagger requests if needed
