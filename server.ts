/** Botkeep owns the execution engine; Pages hosts the UI; the Worker owns D1.
 * User authentication persists in D1; AUTH_DB_PATH is a legacy migration source.
 * Account provisioning uses OPERATOR_SECRET; JWT operators must be in ADMIN_EMAILS.
 */

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import expressWs from 'express-ws';
import path from 'path';
import fs from 'fs';
import { AuthStore } from './src/storage/AuthStore.ts';
import { randomUUID } from 'node:crypto';
import { getFuturesEndpoints } from './src/lib/marketEndpoints.ts';
import { RuntimeSupervisor } from './src/server/RuntimeSupervisor.ts';
import { submitManualOrder } from './src/server/manualOrders.ts';
import { secretEquals, isOperator, rateLimit } from './src/server/security.ts';
// __dirname exists in bundled CJS; dev mode uses project working directory.
declare const __dirname: string | undefined;
const serverDir: string =
  typeof __dirname === 'string' && __dirname
    ? __dirname
    : process.cwd();

import { TradingPipeline } from './src/app/TradingPipeline.ts';
import { BoardOfDirectorsEngine } from './src/strategies/BoardOfDirectorsEngine.ts';

import { TelegramService } from './src/services/TelegramService.ts';
import { D1DatabaseService } from './src/storage/D1DatabaseService.ts';
import { BacktestEngine } from './src/backtest/BacktestEngine.ts';
import { generateToken, verifyToken, hashPassword, comparePassword } from './src/lib/jwt-auth.ts';

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const OPERATOR_SECRET = (process.env.OPERATOR_SECRET || process.env.ADMIN_API_KEY || '').trim();
if (OPERATOR_SECRET && OPERATOR_SECRET.length < 32) throw new Error('OPERATOR_SECRET must be at least 32 characters');
const configuredJwtSecret = process.env.JWT_SECRET?.trim();
if (!configuredJwtSecret || configuredJwtSecret.length < 32 || configuredJwtSecret === 'dev-secret-change-in-production') {
  throw new Error('JWT_SECRET must be configured with a strong production secret');
}
const JWT_SECRET: string = configuredJwtSecret;
const AUTOSTART = String(process.env.AUTOSTART_TRADING || process.env.AUTO_START_TRADING || '').toLowerCase() === 'true';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Try method names in order on an `any` target; return {called, value}. */
async function callAny(target: any, names: string[], args: any[] = []): Promise<{ called: boolean; value: any }> {
  if (!target) return { called: false, value: undefined };
  for (const n of names) {
    try {
      const fn = target[n];
      if (typeof fn === 'function') {
        const v = await fn.apply(target, args);
        return { called: true, value: v };
      }
    } catch {
      /* try next alias */
    }
  }
  return { called: false, value: undefined };
}

function getAny(target: any, names: string[]): any {
  if (!target) return undefined;
  for (const n of names) {
    try {
      const v = target[n];
      if (v !== undefined && v !== null) return typeof v === 'function' ? v.bind(target) : v;
    } catch {
      /* next */
    }
  }
  return undefined;
}

const ok = (res: Response, data: Record<string, any> = {}) =>
  res.json({ success: true, ...data });

const fail = (res: Response, code: number, error: string, extra: Record<string, any> = {}) =>
  res.status(code).json({ success: false, error, ...extra });

/* ------------------------------------------------------------------ */
/* app bootstrap                                                       */
/* ------------------------------------------------------------------ */

const app = express();
expressWs(app as any);
app.disable('x-powered-by');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use('/api/auth', rateLimit(20, 60_000));
app.use(express.json({ limit: '1mb' }));

// AUTH_DB_PATH is only a legacy migration source. D1 owns account persistence.
const dbPath = path.resolve(process.env.AUTH_DB_PATH || 'data/auth/users.db');
const publicDir = path.resolve(process.env.FRONTEND_DIST_DIR || 'dist');
if (dbPath === publicDir || dbPath.startsWith(publicDir + path.sep)) {
  throw new Error('AUTH_DB_PATH must be outside FRONTEND_DIST_DIR');
}
let authDbReady = false;
const authStore = new AuthStore();

// Manual CORS (no extra dep — free-tier image stays small).
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = [
    'https://quantumbot-dashboard.pages.dev',
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.APP_URL,
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, x-telegram-bot-api-secret-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ------------------------- core singletons ------------------------ */

const telegramService = new TelegramService();
const pipeline: any = new TradingPipeline(telegramService as any);
const board: any = BoardOfDirectorsEngine.getInstance();


// Persistent storage: Cloudflare D1 is mandatory for server operation.
let cloudDb: D1DatabaseService | null = null;
let cloudStorageOk = false;
let storageInitError: Error | null = null;
try {
  console.log(`🔐 D1 env: URL=${process.env.D1_API_URL ? 'set' : 'missing'} SECRET=${process.env.D1_API_SECRET ? 'set' : 'missing'}`);
  if (process.env.STORAGE_BACKEND === 'd1' || process.env.D1_API_URL) {
    cloudDb = new D1DatabaseService() as any;
    const maybe = (pipeline as any).setDatabase;
    if (typeof maybe === 'function') maybe.call(pipeline, cloudDb);
    cloudStorageOk = false; // Set only after an authenticated database readiness probe.
    console.log('✅ External storage: Cloudflare D1');
  } else {
    throw new Error('Cloudflare D1 is required: set STORAGE_BACKEND=d1 and D1_API_URL');
  }
} catch (e) {
  storageInitError = e as Error;
  console.error('❌ D1 storage initialization failed:', storageInitError.message);
}

async function checkStorage(): Promise<boolean> {
  try {
    cloudStorageOk = !!cloudDb && (await cloudDb.ping()).ok === true;
  } catch { cloudStorageOk = false; }
  return cloudStorageOk;
}

async function requireCloudStorage(res: Response): Promise<boolean> {
  if (await checkStorage()) return true;
  fail(res, 503, 'Persistent storage is unavailable');
  return false;
}

const supervisor = cloudDb ? new RuntimeSupervisor(cloudDb, process.env.EXCHANGE_ACCOUNT_ID || '', async (reason) => {
  pipeline.getKillSwitch().trigger('HARD_HALT', reason, 'HEALTH_HEARTBEAT_LOSS');
  await pipeline.stop();
}) : null;
pipeline.setRuntimeSafetyGuard(() => !!pipeline.isRunning && !!supervisor?.canEnter());
let startInProgress: Promise<void> | null = null;
let autostartRetryTimer: ReturnType<typeof setTimeout> | null = null;
let autostartRetryAttempt = 0;
let autostartEnabled = AUTOSTART;
async function startTrading() {
  if (pipeline.isRunning) return;
  if (startInProgress) return startInProgress;
  startInProgress = (async () => {
    if (!supervisor) throw new Error('Storage and execution lease are required');
    await supervisor.start();
    try { await pipeline.startAutonomousTrading(); }
    catch (error) { await supervisor.stop(); throw error; }
  })();
  try { await startInProgress; } finally { startInProgress = null; }
}
function scheduleAutostartRetry(error: unknown) {
  if (!autostartEnabled || pipeline.isRunning || autostartRetryTimer) return;
  const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(autostartRetryAttempt, 3));
  autostartRetryAttempt += 1;
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`❌ Trading start failed; retrying in ${Math.ceil(delayMs / 1000)}s: ${detail}`);
  autostartRetryTimer = setTimeout(async () => {
    autostartRetryTimer = null;
    if (!autostartEnabled || pipeline.isRunning) return;
    try {
      await startTrading();
      autostartRetryAttempt = 0;
      console.log('✅ TradingPipeline started after an automatic retry.');
    } catch (retryError) {
      scheduleAutostartRetry(retryError);
    }
  }, delayMs);
}

// Persist order status events in order, including acknowledgments and partial fills.
let orderWrites: Promise<unknown> = Promise.resolve();
function persistOrder(order: any): Promise<unknown> {
  const snapshot = JSON.parse(JSON.stringify(order));
  const write = orderWrites.then(() => cloudDb!.saveOrder(snapshot));
  orderWrites = write.catch(() => {
    cloudStorageOk = false;
    pipeline.getKillSwitch().trigger('HARD_HALT', 'Order persistence failed', 'AUTO_RISK_ENGINE');
  });
  return write;
}
pipeline.getOrderGateway().subscribeOrders((order: any) => {
  if (!cloudDb) return;
  void persistOrder(order).catch(() => {});
});

/* ----------------------------- auth -------------------------------- */
function authorize(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET') res.once('finish', () => {
    const event = { id: randomUUID(), at: Date.now(), actor: (req as any).user?.userId,
      method: req.method, path: req.path, status: res.statusCode };
    console.log(JSON.stringify({ audit: event }));
    if (cloudDb) void cloudDb.saveState(`audit:${event.id}`, event).catch(() => console.error('Audit persistence failed'));
  });
  next();
}
// Protected routes: OPERATOR_SECRET match (VPS/headless) OR valid JWT token.
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (secretEquals(token, OPERATOR_SECRET)) { (req as any).user = { userId: 'operator-service' }; return authorize(req, res, next); }
  if (token) {
    try {
      const decoded = verifyToken(token, JWT_SECRET);
      if (!isOperator(decoded.email)) return fail(res, 403, 'Operator access required');
      (req as any).user = decoded;
      return authorize(req, res, next);
    } catch (e: any) {
      return fail(res, 401, 'Invalid or expired token');
    }
  }
  return fail(res, 401, 'Unauthorized: valid Bearer token required.');
}

/* ------------------------------------------------------------------ */
/* public: health / status                                             */
/* ------------------------------------------------------------------ */

const bootTime = Date.now();

/* ------------------------------------------------------------------ */
/* auth endpoints (public)                                             */
/* ------------------------------------------------------------------ */

app.post('/api/auth/register', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!authDbReady) return fail(res, 503, 'Authentication storage unavailable');
    const { password } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (typeof email !== 'string' || !email.includes('@')) {
      return fail(res, 400, 'Valid email required');
    }
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      return fail(res, 400, 'Password must be 12 or more characters and at most 72 UTF-8 bytes');
    }

    if (!isOperator(email)) return fail(res, 403, 'Account must be listed in ADMIN_EMAILS');

    if (await authStore.find(email)) return fail(res, 409, 'Email already registered');
    const userId = randomUUID();
    const created = await authStore.create({ id: userId, email, password_hash: await hashPassword(password), created_at: Date.now() });
    if (!created) return fail(res, 409, 'Email already registered');

    const token = generateToken({ userId, email }, JWT_SECRET);
    return ok(res, {
      token,
      user: { userId, email },
      message: 'Registration successful'
    });
  } catch (err: any) {
    console.error('Register error:', err.message);
    return fail(res, 503, 'Authentication storage unavailable');
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    if (!authDbReady) return fail(res, 503, 'Authentication storage unavailable');
    const { password } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (typeof email !== 'string' || typeof password !== 'string') {
      return fail(res, 400, 'Email and password required');
    }

    if (!isOperator(email)) return fail(res, 401, 'Invalid email or password');

    const user = await authStore.find(email);
    if (!user || !await comparePassword(password, user.password_hash)) return fail(res, 401, 'Invalid email or password');
    const token = generateToken({ userId: user.id, email: user.email }, JWT_SECRET);
    return ok(res, { token, user: { userId: user.id, email: user.email } });
  } catch (err: any) {
    console.error('Login error:', err.message);
    return fail(res, 503, 'Authentication storage unavailable');
  }
});

app.get('/api/auth/validate', async (req: Request, res: Response) => {
  try {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      return fail(res, 401, 'No token provided');
    }

    const decoded = verifyToken(token, JWT_SECRET);
    if (!isOperator(decoded.email)) return fail(res, 403, 'Operator access required');
    return ok(res, { userId: decoded.userId, email: decoded.email });
  } catch (err: any) {
    return fail(res, 401, 'Invalid or expired token');
  }
});

/* ------------------------------------------------------------------ */
/* public: health / status                                             */
/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => res.json({ status: 'alive', tradingRunning: !!pipeline.isRunning, autostart: AUTOSTART }));
app.get('/api/ready', async (_req, res) => {
  const storage = await checkStorage();
  const executionOwner = !pipeline.isRunning || !!supervisor?.canEnter();
  const tradingReady = !autostartEnabled || !!pipeline.isRunning;
  const ready = authDbReady && storage && executionOwner && tradingReady;
  res.status(ready ? 200 : 503).json({ ready, auth: authDbReady, storage, executionOwner, tradingRunning: !!pipeline.isRunning, tradingReady });
});

app.get('/api/system-health', requireAuth, async (_req: Request, res: Response) => {
  const health = await callAny(pipeline, ['getLastHealth', 'checkHealth', 'getHealth']);
  const risk = await callAny(pipeline, ['getRiskState', 'getRiskMetrics']);
  ok(res, {
    lastHealth: health.called ? health.value : null,
    risk: risk.called ? risk.value : null,
    uptimeSec: Math.floor((Date.now() - bootTime) / 1000),
  });
});

app.get('/api/live-status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const uds = getAny(pipeline, ['userDataStream', 'getUserDataStream']);
    const gw = getAny(pipeline, ['orderGateway', 'getOrderGateway']);
    const ks = getAny(pipeline, ['killSwitch', 'getKillSwitch']);

    const balance = uds && typeof uds.getBalance === 'function' ? uds.getBalance() : null;
    const positions = uds && typeof uds.getPositions === 'function' ? uds.getPositions() : [];
    const orders = gw && typeof gw.getOrders === 'function' ? gw.getOrders() : [];
    const ksLevel = ks && typeof ks.getLevel === 'function' ? ks.getLevel() : ks?.level ?? 'NORMAL';

    res.json({
      success: true,
      isRunning: !!pipeline.isRunning,
      executionMode: (() => {
        const mode = String(pipeline.config?.executionMode ?? process.env.EXECUTION_MODE ?? '').trim().toUpperCase();
        return ['PAPER', 'PAPER_TRADING', 'TESTNET', 'TESTNET_EXCHANGE', 'LIVE'].includes(mode) ? mode : 'UNKNOWN';
      })(),
      balance,
      positions: Array.isArray(positions) ? positions : [],
      orders: Array.isArray(orders) ? orders : [],
      killSwitchLevel: ksLevel,
      killSwitchEvent: ks.getHistory()[0] ?? null,
      boardOfDirectors: { ...board.getStatusReport(), councilMembers: board.getCouncilStructure() },
      prices: pipeline.getMarketData().getAllPrices(),
      timestamp: Date.now(),
    });
  } catch (e: any) {
    fail(res, 500, e?.message || 'live-status failed');
  }
});

app.post('/api/protected/trading/start', requireAuth, async (_req: Request, res: Response) => {
  try {
    autostartEnabled = true;
    await startTrading();
    return ok(res, { isRunning: !!pipeline.isRunning });
  } catch (e: any) {
    scheduleAutostartRetry(e);
    return fail(res, 409, e?.message || 'trading start failed');
  }
});

app.post('/api/protected/trading/stop', requireAuth, async (_req: Request, res: Response) => {
  try {
    autostartEnabled = false;
    if (autostartRetryTimer) {
      clearTimeout(autostartRetryTimer);
      autostartRetryTimer = null;
    }
    autostartRetryAttempt = 0;
    await pipeline.stop();
    await supervisor?.stop();
    return ok(res, { isRunning: false });
  } catch (e: any) {
    return fail(res, 500, e?.message || 'trading stop failed');
  }
});

app.get('/api/binance/tickers', requireAuth, async (req: Request, res: Response) => {
  try {
    const symbols = typeof req.query.symbols === 'string' ? req.query.symbols.split(',') : null;
    const baseUrl = String(process.env.EXECUTION_MODE || '').toUpperCase() === 'TESTNET'
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
    const r = await fetch(`${baseUrl}/fapi/v1/ticker/24hr`);
    if (!r.ok) throw new Error(`Binance Futures ${r.status}`);
    const all: any[] = await r.json();
    const filtered = symbols ? all.filter((t: any) => symbols.includes(t.symbol)) : all;
    res.json({ success: true, tickers: filtered.slice(0, 200) });
  } catch (e: any) {
    fail(res, 502, e?.message || 'binance proxy failed');
  }
});

for (const resource of ['klines', 'depth'] as const) {
  app.get(`/api/binance/${resource}`, requireAuth, async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : '';
    const limit = Number(req.query.limit ?? (resource === 'depth' ? 10 : 25));
    if (!/^[A-Z0-9]{2,24}$/.test(symbol) || !Number.isInteger(limit) || limit < 1 || limit > 500
      || (resource === 'depth' && ![5, 10, 20, 50, 100, 500].includes(limit))
      || (resource === 'klines' && req.query.interval !== undefined && req.query.interval !== '1m')) {
      return fail(res, 400, 'Invalid market data request');
    }
    try {
      const { rest } = getFuturesEndpoints(pipeline.getOrderGateway().getExecutionMode());
      const query = new URLSearchParams({ symbol, limit: String(limit) });
      if (resource === 'klines') query.set('interval', '1m');
      const response = await fetch(`${rest}/fapi/v1/${resource}?${query}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return fail(res, 502, `Binance Futures ${response.status}`);
      res.json(await response.json());
    } catch { fail(res, 502, 'Market data unavailable'); }
  });
}

/* ------------------------------------------------------------------ */
/* board of directors                                                  */
/* ------------------------------------------------------------------ */

app.post('/api/board/hold-meeting', requireAuth, rateLimit(30, 60_000), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const decision = await board.holdMeeting({
      symbol: body.symbol || 'BTC/USDT',
      candles: Array.isArray(body.candles) ? body.candles : [{ close: body.price || 0 }],
      candlesMap: body.candlesMap,
      signals: Array.isArray(body.signals) ? body.signals : [],
      features: body.features,
      regime: body.regime,
      capital: typeof body.capital === 'number' ? body.capital : undefined,
      latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
    });
    broadcastBrain({ type: 'board-decision', decision, at: Date.now() });
    ok(res, { decision });
  } catch (e: any) {
    fail(res, 500, e?.message || 'hold-meeting failed');
  }
});

// Outcomes are accepted only from reconciled fills inside the engine. UI-supplied
// PnL cannot establish a closed trade or safely credit an agent.
app.post('/api/board/learn', requireAuth, (_req, res) => {
  fail(res, 409, 'External learning disabled; learning requires a reconciled trade outcome');
});

app.get('/api/council/shadow-report', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!cloudDb) return fail(res, 503, 'Persistent D1 storage unavailable');
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const comparisons = await cloudDb.getShadowComparisons(Number.isFinite(limit) ? limit : 100);
    const report = board.buildShadowReport(comparisons);
    ok(res, { report, comparisons });
  } catch (e: any) {
    fail(res, 500, e?.message || 'shadow report failed');
  }
});

app.get('/api/board/sessions', requireAuth, async (_req: Request, res: Response) => {
  const s = await callAny(board, ['getDeliberationSessions', 'getSessions', 'getHistory']);
  ok(res, { sessions: s.called ? s.value : [] });
});



/* ------------------------------------------------------------------ */
/* telegram                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/telegram/status', requireAuth, async (_req: Request, res: Response) => {
  const s = await callAny(telegramService, ['getConfigStatus']);
  ok(res, { status: s.called ? s.value : { configured: !!process.env.TELEGRAM_BOT_TOKEN } });
});

app.post('/api/telegram/config', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    await (telegramService as any).updateConfig(
      String(b.chatId || b.channelId || ''),
      b.isEnabled ?? true,
      b.botToken,
      b.heartbeatEnabled,
      b.intervalMinutes,
    );
    try {
      if (cloudDb) await cloudDb.saveState('telegram_config', { chatId: b.chatId || '', updatedAt: Date.now() });
    } catch {
      /* never fail on persistence */
    }
    ok(res, {});
  } catch (e: any) {
    fail(res, 500, e?.message || 'telegram config failed');
  }
});

async function telegramHeartbeat(_req: Request, res: Response) {
  try {
    const sent = await (telegramService as any).sendMessage(
      `💓 <b>Quantum Bot heartbeat</b>\n⏱ ${new Date().toISOString()}\n🤖 running=${!!pipeline.isRunning}`,
    );
    ok(res, { sent: !!sent });
  } catch (e: any) {
    fail(res, 500, e?.message || 'heartbeat failed');
  }
}
app.post('/api/telegram/heartbeat/send-now', requireAuth, telegramHeartbeat);
app.post('/api/telegram/test', requireAuth, telegramHeartbeat);

// Telegram webhook ingress (Worker forwards here; optional shared secret).
app.post('/webhook/telegram', async (req: Request, res: Response) => {
  try {
    const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (!expected) return fail(res, 503, 'telegram webhook secret is not configured');
    const got = req.header('x-telegram-bot-api-secret-token') || '';
    if (!secretEquals(got, expected)) return fail(res, 403, 'bad webhook secret');
    const update = req.body || {};
    const msg = update.message || update.edited_message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id;
    const chats = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim());
    const users = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim());
    if (!chats.includes(String(chatId)) || !users.includes(String(msg?.from?.id))) {
      return fail(res, 403, 'Telegram sender is not authorized');
    }
    if (chatId && /^\/start/i.test(text)) {
      await (telegramService as any).sendMessage(`✅ Quantum Bot linked.\nChat: ${chatId}\nSend /status for state.`);
    } else if (chatId && /^\/status/i.test(text)) {
      await (telegramService as any).sendMessage(
        `📊 running=${!!pipeline.isRunning} mode=${pipeline.config?.executionMode || '?'} storage=${cloudStorageOk ? 'cloud' : 'local'}`,
      );
    }
    try {
      if (cloudDb && update) await cloudDb.saveState(`tg_update_${update.update_id || Date.now()}`, update);
    } catch {
      /* best effort */
    }
    ok(res, {});
  } catch (e: any) {
    fail(res, 500, e?.message || 'webhook failed');
  }
});

/* ------------------------------------------------------------------ */
/* protected: trading operations                                       */
/* ------------------------------------------------------------------ */

app.get('/api/protected/order-history', requireAuth, async (req, res) => {
  try {
    if (!await requireCloudStorage(res)) return;
    ok(res, { orders: await cloudDb!.getOrders(Number(req.query.limit) || 200) });
  } catch { fail(res, 503, 'Order history unavailable'); }
});

app.post('/api/protected/manual-order', requireAuth, async (req, res) => {
  try {
    if (!await requireCloudStorage(res)) return;
    if (!pipeline.isRunning || !supervisor?.canEnter()) return fail(res, 409, 'Start the execution owner before submitting entries');
    const result = await submitManualOrder({ claimOrder: cloudDb!.claimOrder.bind(cloudDb), saveOrder: persistOrder }, pipeline.getOrderGateway(), req.header('Idempotency-Key') || '', req.body || {});
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    const message = (error as Error).message;
    fail(res, /Invalid order|Idempotency-Key/.test(message) ? 400 : 503,
      /Invalid order|Idempotency-Key/.test(message) ? message : 'Order outcome uncertain; reconcile the same idempotency key before retrying');
  }
});

app.post('/api/protected/positions/scale-up', requireAuth, async (req: Request, res: Response) => {
  const r = await callAny(pipeline, ['scaleUpCurrentPositions'], [Number(req.body?.targetMarginPerPosition) || 6.0]);
  if (!r.called) return fail(res, 503, 'scale-up unavailable');
  ok(res, r.value && typeof r.value === 'object' ? r.value : { result: r.value });
});

app.post('/api/protected/positions/close', requireAuth, async (req: Request, res: Response) => {
  try {
    const { symbol, reason } = req.body || {};
    if (typeof symbol !== 'string') return fail(res, 400, 'Body requires { symbol }');
    const r = await pipeline.closeSinglePositionOnExchange(symbol, String(reason || 'Manual / Target Exit'));
    ok(res, r && typeof r === 'object' ? r : { result: r });
  } catch (e: any) {
    fail(res, 500, e?.message || 'close failed');
  }
});

app.post('/api/protected/positions/close-all', requireAuth, async (_req: Request, res: Response) => {
  try {
    const uds = getAny(pipeline, ['userDataStream', 'getUserDataStream']);
    const positions: any[] = uds?.getPositions?.() || [];
    const results = [];
    for (const p of positions) {
      const sym = p?.symbol;
      if (!sym) continue;
      try {
        results.push({ symbol: sym, ...(await pipeline.closeSinglePositionOnExchange(sym, 'Close-all')) });
      } catch (e: any) {
        results.push({ symbol: sym, success: false, message: e?.message });
      }
    }
    ok(res, { results });
  } catch (e: any) {
    fail(res, 500, e?.message || 'close-all failed');
  }
});

app.post('/api/emergency/killswitch/reset', requireAuth, async (_req: Request, res: Response) => {

  try {
    const ks = getAny(pipeline, ['killSwitch', 'getKillSwitch']);
    const r = await callAny(ks, ['reset', 'resetKillSwitch', 'clear']);

    console.warn(`⚠️ Emergency KillSwitch reset executed via /api/emergency/killswitch/reset`);
    ok(res, {
      success: true,
      message: 'KillSwitch reset via emergency endpoint',
      reset: r.called
    });
  } catch (e: any) {
    fail(res, 500, `Emergency reset failed: ${e?.message}`);
  }
});

app.post('/api/protected/killswitch/reset', requireAuth, async (_req: Request, res: Response) => {
  const ks = getAny(pipeline, ['killSwitch', 'getKillSwitch']);
  const r = await callAny(ks, ['reset', 'resetKillSwitch', 'clear']);
  ok(res, { reset: r.called });
});

app.post('/api/protected/killswitch/trigger', requireAuth, async (req: Request, res: Response) => {
  const ks = getAny(pipeline, ['killSwitch', 'getKillSwitch']);
  const r = await callAny(ks, ['trigger', 'activate', 'trip'], [req.body?.level || 'SOFT_HALT', req.body?.reason || 'manual']);
  ok(res, { triggered: r.called, result: r.value ?? null });
});

app.post('/api/trades/reset-and-realign', requireAuth, async (_req: Request, res: Response) => {
  const r = await callAny(pipeline, ['resetAndRealignTrades', 'realignTrades', 'syncTradesWithExchange']);
  if (r.called) return ok(res, { result: r.value ?? null });
  ok(res, { realigned: false });
});

app.post('/api/backtest/run', requireAuth, async (req: Request, res: Response) => {
  try {
    const engine = new BacktestEngine(req.body || {});
    const result = await engine.run(req.body?.strategyParams);
    ok(res, { result });
  } catch (e: any) {
    fail(res, 500, e?.message || 'backtest failed');
  }
});



// JSON snapshot export (lightweight — no zip dep on free tier).
app.get('/api/download-zip', requireAuth, async (_req: Request, res: Response) => {
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      status: null,
    };
    res.header('Content-Disposition', 'attachment; filename="quantum-backup.json"');
    res.json(payload);
  } catch (e: any) {
    fail(res, 500, e?.message || 'export failed');
  }
});

/* ------------------------------------------------------------------ */
/* brain websocket (board learning stream)                             */
/* ------------------------------------------------------------------ */

const brainSockets = new Set<any>();
(app as any).ws('/brain-ws', (socket: any, req: Request) => {
  // Browser WebSockets cannot set Authorization; authenticate the first message.
  const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
  socket.once('message', (raw: any) => {
    try {
      const { token } = JSON.parse(String(raw));
      const user = verifyToken(token, JWT_SECRET);
      if (!isOperator(user.email)) throw new Error('Forbidden');
      clearTimeout(timer);
      brainSockets.add(socket);
      socket.send(JSON.stringify({ type: 'brain-hello', at: Date.now() }));
    } catch { socket.close(1008, 'Unauthorized'); }
  });
  socket.on('close', () => { clearTimeout(timer); brainSockets.delete(socket); });
});

function broadcastBrain(msg: Record<string, any>) {
  const text = JSON.stringify(msg);
  for (const s of brainSockets) {
    try {
      if (s.readyState === 1) s.send(text);
    } catch {
      /* drop */
    }
  }
}
setInterval(() => broadcastBrain({ type: 'brain-ping', at: Date.now() }), 30000);

/* ------------------------------------------------------------------ */
/* static frontend (vite dist) + SPA fallback                          */
/* ------------------------------------------------------------------ */

const distDir = publicDir;
// Only the bundled UI assets and HTML are public, never server/data files.
app.use('/assets', express.static(path.join(distDir, 'assets'), { dotfiles: 'deny', index: false, maxAge: '1h' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') ||
      req.path.startsWith('/brain-ws') || path.extname(req.path)) return next();
  if (fs.existsSync(path.join(distDir, 'index.html'))) return res.sendFile(path.join(distDir, 'index.html'));
  next();
});

// 404 for unknown API routes
app.use('/api/', (_req: Request, res: Response) => fail(res, 404, 'unknown api route'));

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

const httpServer = app.listen(PORT, process.env.HOST || '0.0.0.0', async () => {
  console.log(`🚀 Quantum Bot server listening on 0.0.0.0:${PORT}`);
  console.log(`   storage=${cloudStorageOk ? 'cloudflare-d1' : 'UNAVAILABLE'} autostart=${AUTOSTART}`);

  // Security check: warn if JWT_SECRET is using default
  if (JWT_SECRET === 'dev-secret-change-in-production') {
    console.warn('⚠️  [SECURITY] JWT_SECRET is using default value. Set JWT_SECRET env var for production!');
  }

  // Initialize durable accounts before starting the trading engine.
  try {
    await authStore.initialize(dbPath, isOperator);
    authDbReady = true;
    console.log('✅ D1 users DB ready');
  } catch (err: any) {
    console.error('❌ Authentication initialization failed:', err.message);
    process.exit(1);
  }

  if (!AUTOSTART) {
    console.log('⏸ Trading NOT autostarted (set AUTOSTART_TRADING=true to enable). API + UI live.');
    return;
  }
  try {
    await startTrading();
    console.log('✅ TradingPipeline started');
  } catch (e: any) {
    scheduleAutostartRetry(e);
  }
});

// Global error handlers
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('❌ [CRITICAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Don't exit - allow server to continue, but log for debugging
});

process.on('uncaughtException', (error: Error) => {
  console.error('❌ [CRITICAL] Uncaught Exception:', error.message);
  console.error('Stack:', error.stack);
  // Log then exit - uncaught sync errors are unrecoverable
  process.exit(1);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  pipeline.getKillSwitch().trigger('HARD_HALT', 'Process shutdown', 'MANUAL_OPERATOR');
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  httpServer.close();
  try {
    await pipeline.stop();
    await orderWrites;
    await supervisor?.stop();
    process.exit(0);
  } catch { process.exit(1); }
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
