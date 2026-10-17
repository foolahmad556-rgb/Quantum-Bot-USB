# GitHub Secrets Setup Guide

## Required Secrets for GitHub Actions Workflows

GitHub Actions workflows require these secrets configured in the repository.

### 1. Cloudflare Secrets (required for Pages & D1 deployment)

**Location:** https://github.com/palc88-stack/Quantum-Bot-USB/settings/secrets/actions

#### CLOUDFLARE_API_TOKEN
- **Purpose:** Authenticate with Cloudflare API
- **Where to get:** https://dash.cloudflare.com/profile/api-tokens
  1. Click "Create Token"
  2. Choose "Edit Cloudflare Workers" template (or custom)
  3. Permissions needed:
     - Account.Workers Scripts (Edit)
     - Account.Workers Routes (Edit)
     - Cloudflare Pages (Edit)
     - Zone.Zone (Read)
  4. Copy the token

#### CLOUDFLARE_ACCOUNT_ID
- **Purpose:** Identify your Cloudflare account
- **Where to get:** https://dash.cloudflare.com/
  1. Right sidebar, look for "Account ID"
  2. Copy it (looks like: `abc123def456789`)

#### CLOUDFLARE_PAGES_PROJECT
- **Value:** `quantumbot-dashboard`
- **Status:** Already hardcoded in workflows ✓

### 2. Database Secrets (required for D1 deployment)

#### D1_API_SECRET
- **Purpose:** Authentication for D1 API calls
- **Value:** Generate a strong random string
  ```bash
  openssl rand -base64 32
  ```
- **Status:** Optional (workflow continues without it)

### 3. Application Secrets (required for server.ts runtime)

These go in `.env` file (DO NOT commit):

```bash
# .env file (local development only)
JWT_SECRET=your-super-secret-key-min-32-chars-long
OPERATOR_SECRET=your-operator-api-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHANNEL_ID=your-channel-id
```

For **GitHub Actions** (if needed as env vars):

**Location:** https://github.com/palc88-stack/Quantum-Bot-USB/settings/secrets/actions

- JWT_SECRET (recommended 32+ chars)
- OPERATOR_SECRET (for headless operation)
- TELEGRAM_BOT_TOKEN (optional)
- TELEGRAM_CHANNEL_ID (optional)

---

## Setup Checklist

- [ ] Create CLOUDFLARE_API_TOKEN in GitHub Secrets
- [ ] Create CLOUDFLARE_ACCOUNT_ID in GitHub Secrets
- [ ] (Optional) Create D1_API_SECRET in GitHub Secrets
- [ ] Create local `.env` file with JWT_SECRET
- [ ] Test workflows: push to master branch
- [ ] Verify deployment in Cloudflare Dashboard

---

## Troubleshooting

**Error: "Cloudflare Pages project mismatch or inaccessible"**
- Check CLOUDFLARE_API_TOKEN validity
- Check CLOUDFLARE_ACCOUNT_ID correctness
- Verify Pages project exists: https://dash.cloudflare.com/?to=/:account/pages

**Error: "D1_API_SECRET not configured"**
- This is OK - D1 will work without it (optional)

**Error: "Deploy Worker failed"**
- Check wrangler.toml exists in repo root
- Ensure CLOUDFLARE_API_TOKEN has Worker permissions
