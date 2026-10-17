# Port Configuration Guide

## Overview

The system uses **two separate ports** intentionally for different purposes. This is NOT a conflict.

| Port | Service | Purpose | Listener |
|------|---------|---------|----------|
| **8080** | Webhook API | Receive TradingView signals + API endpoints | server.ts |
| **3000** | UI Server | Frontend static assets (development only) | Dockerfile EXPOSE |

---

## Port 8080 - Webhook & API

**Primary application server**

```typescript
// server.ts
const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, '0.0.0.0', async () => { ... });
```

**Serves:**
- ✅ POST /webhook (receive TradingView signals)
- ✅ POST /api/auth/register (user registration)
- ✅ POST /api/auth/login (authentication)
- ✅ GET /api/health (health check)
- ✅ GET /api/status (trading status)
- ✅ All other API routes

**Used by:**
- TradingView webhooks
- Frontend API calls (via backend proxy)
- Monitoring systems

**Network exposure:**
- Production: 0.0.0.0:8080 (inside container/VPS)
- Behind: Cloudflare Worker proxy (if needed)
- Direct access via: https://5uq4nr.bot-keep.xyz

---

## Port 3000 - Docker Frontend Exposure

**Container build configuration**

```dockerfile
# Dockerfile
EXPOSE 3000
```

**Purpose:** Docker metadata only
- ℹ️ Informs container orchestrators that port 3000 is "exposed"
- ℹ️ Does NOT automatically expose port 3000
- ℹ️ Purely documentation for deployment tools

**Why 3000?**
- Botkeep convention: standard Node.js server port
- Docker deployment expects port 3000
- Easy to remember (common in dev/ops)

**Used by:**
- Kubernetes/Docker Compose for port mapping
- Botkeep orchestration layer

**How it works:**
```yaml
# Example: Docker Compose mapping
services:
  bot:
    image: quantum-bot:latest
    ports:
      - "3000:8080"  # Host port 3000 → Container port 8080
```

---

## Network Flow (Production)

```
┌──────────────────────────────────────────────────────┐
│ TradingView                                          │
│ (sends webhooks to: https://5uq4nr.bot-keep.xyz)    │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│ Botkeep Edge (Proxy Layer)                           │
│ - Port 443 (HTTPS)                                   │
│ - Routes to internal Node.js server                  │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│ Docker Container                                     │
│ - server.ts listening on 0.0.0.0:8080                │
│ - Receives: POST /webhook                            │
│ - EXPOSE 3000 (metadata only)                        │
└──────────────────────────────────────────────────────┘
```

---

## Local Development (Port Conflicts - SOLVED)

**Problem:** If running multiple services locally

**Solution:**
```bash
# Override the port
PORT=8888 npm run dev
```

**Or:** Use different services on different ports:
- Webhook server: PORT=8080
- Frontend dev server: PORT=3000
- Separate processes entirely

---

## Verification

**Check which port server.ts uses:**
```bash
grep -n "const PORT\|app.listen" server.ts
```

Expected output:
```
44: const PORT = parseInt(process.env.PORT || '8080', 10);
758: app.listen(PORT, '0.0.0.0', async () => {
```

**Check Dockerfile exposure:**
```bash
grep "^EXPOSE" Dockerfile
```

Expected output:
```
EXPOSE 3000
```

---

## Summary

✅ **Port 8080**: Actual application server (webhook + API)
✅ **Port 3000**: Docker metadata (for orchestration only)
✅ **No conflict**: Each serves a different purpose
✅ **Production**: Only port 8080 matters
✅ **Docker**: Maps whatever port needed (usually 3000 → 8080)
