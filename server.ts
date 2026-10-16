/**
 * Quantum Bot — Botkeep.Cloud production server (free-tier safe).
 *
 * Architecture (all state OUTSIDE server RAM):
 *  - Trading state / trades / balances  -> Google Cloud SQL (Postgres, via Drizzle) + Firestore
 *  - Auth / users                        -> Firebase Auth (Admin SDK verify)
 *  - Frontend                            -> Cloudflare Pages (static dist/)
 *  - Webhook ingress                     -> Cloudflare Worker -> POST /webhook/telegram
 *  - Alerts                              -> Telegram Bot API
 *  - This server (Botkeep, 2GB)          -> stateless compute only: orchestrates the
 *    TradingPipeline in-process, persists EVERYTHING to Cloud SQL / Firestore.
 *
 * Required env (Botkeep Environment, never committed):
 *  FIREBASE_CREDENTIALS_JSON, SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME
 *  OPERATOR_SECRET (or ADMIN_API_KEY), TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
 *  Optional: TELEGRAM_WEBHOOK_SECRET, EXECUTION_MODE, AUTOSTART_TRADING=true
 */

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import expressWs from 'express-ws';
import path from 'path';
import fs from 'fs';
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

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const OPERATOR_SECRET = (process.env.OPERATOR_SECRET || process.env.ADMIN_API_KEY || '').trim();
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
app.use(express.json({ limit: '1mb' }));

// Manual CORS (no extra dep — free-tier image stays small).
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-telegram-bot-api-secret-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
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
    cloudStorageOk = true;
    console.log('✅ External storage: Cloudflare D1');
  } else {
    throw new Error('Cloudflare D1 is required: set STORAGE_BACKEND=d1 and D1_API_URL');
  }
} catch (e) {
  storageInitError = e as Error;
  console.error('❌ D1 storage initialization failed:', storageInitError.message);
}

function requireCloudStorage(res: Response): boolean {
  if (cloudStorageOk && cloudDb) return true;
  fail(res, 503, `Persistent D1 storage unavailable: ${storageInitError?.message || 'not configured'}`);
  return false;
}

/* ----------------------------- auth -------------------------------- */
// Protected routes: OPERATOR_SECRET match (VPS/headless) OR Firebase ID token.
// When no OPERATOR_SECRET is configured the server fails OPEN only in
// non-production (dev); in production it fails CLOSED.
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (OPERATOR_SECRET && token === OPERATOR_SECRET) return next();
  if (token && !OPERATOR_SECRET && process.env.NODE_ENV !== 'production') return next();
  if (token) {
    try {
      const { adminAuth } = await import('./src/lib/firebase-admin.ts');
      const decoded = await adminAuth.verifyIdToken(token);
      (req as any).uid = decoded.uid;
      return next();
    } catch {
      /* fall through to 401 */
    }
  }
  return fail(res, 401, 'Unauthorized: valid Bearer token required.');
}

/* ------------------------------------------------------------------ */
/* public: health / status                                             */
/* ------------------------------------------------------------------ */

const bootTime = Date.now();

app.get('/api/health', (_req: Request, res: Response) => {
  ok(res, {
    status: 'ok',
    uptimeSec: Math.floor((Date.now() - bootTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
    tradingRunning: !!pipeline.isRunning,
    storage: cloudStorageOk ? 'cloudflare-d1' : 'unavailable',
    autostart: AUTOSTART,
  });
});

app.get('/api/system-health', async (_req: Request, res: Response) => {
  const health = await callAny(pipeline, ['getLastHealth', 'checkHealth', 'getHealth']);
  const risk = await callAny(pipeline, ['getRiskState', 'getRiskMetrics']);
  ok(res, {
    lastHealth: health.called ? health.value : null,
    risk: risk.called ? risk.value : null,
    uptimeSec: Math.floor((Date.now() - bootTime) / 1000),
  });
});

app.get('/api/live-status', async (_req: Request, res: Response) => {
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
      timestamp: Date.now(),
    });
  } catch (e: any) {
    fail(res, 500, e?.message || 'live-status failed');
  }
});

app.post('/api/protected/trading/start', requireAuth, async (_req: Request, res: Response) => {
  try {
    await pipeline.startAutonomousTrading();
    return ok(res, { isRunning: true });
  } catch (e: any) {
    return fail(res, 409, e?.message || 'trading start failed');
  }
});

app.post('/api/protected/trading/stop', requireAuth, async (_req: Request, res: Response) => {
  try {
    await pipeline.stop();
    return ok(res, { isRunning: false });
  } catch (e: any) {
    return fail(res, 500, e?.message || 'trading stop failed');
  }
});

app.get('/api/binance/tickers', async (req: Request, res: Response) => {
  try {
    const symbols = typeof req.query.symbols === 'string' ? req.query.symbols.split(',') : null;
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const all: any[] = await r.json();
    const filtered = symbols ? all.filter((t: any) => symbols.includes(t.symbol)) : all;
    res.json({ success: true, tickers: filtered.slice(0, 200) });
  } catch (e: any) {
    fail(res, 502, e?.message || 'binance proxy failed');
  }
});

/* ------------------------------------------------------------------ */
/* board of directors                                                  */
/* ------------------------------------------------------------------ */

app.post('/api/board/hold-meeting', async (req: Request, res: Response) => {
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

app.post('/api/board/learn', async (req: Request, res: Response) => {
  try {
    const { pnl, symbol } = req.body || {};
    if (typeof pnl !== 'number' || typeof symbol !== 'string') {
      return fail(res, 400, 'Body requires { pnl: number, symbol: string }');
    }
    const event = await board.learnFromOutcome(pnl, symbol);
    try {
      if (cloudDb) await cloudDb.saveSignal({ symbol, action: pnl >= 0 ? 'LEARN_WIN' : 'LEARN_LOSS', price: 0, confidence: 0 } as any);
    } catch {
      /* learning must never fail the request */
    }
    broadcastBrain({ type: 'board-learn', pnl, symbol, event, at: Date.now() });
    ok(res, { event: event ?? null });
  } catch (e: any) {
    fail(res, 500, e?.message || 'board-learn failed');
  }
});

app.get('/api/council/shadow-report', async (req: Request, res: Response) => {
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

app.get('/api/board/sessions', async (_req: Request, res: Response) => {
  const s = await callAny(board, ['getDeliberationSessions', 'getSessions', 'getHistory']);
  ok(res, { sessions: s.called ? s.value : [] });
});



/* ------------------------------------------------------------------ */
/* telegram                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/telegram/status', async (_req: Request, res: Response) => {
  const s = await callAny(telegramService, ['getStatus', 'getConfig']);
  ok(res, { status: s.called ? s.value : { configured: !!process.env.TELEGRAM_BOT_TOKEN } });
});

app.post('/api/telegram/config', async (req: Request, res: Response) => {
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
app.post('/api/telegram/heartbeat/send-now', telegramHeartbeat);
app.post('/api/telegram/test', telegramHeartbeat);

// Telegram webhook ingress (Worker forwards here; optional shared secret).
app.post('/webhook/telegram', async (req: Request, res: Response) => {
  try {
    const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (expected) {
      const got = req.header('x-telegram-bot-api-secret-token') || '';
      if (got !== expected) return fail(res, 403, 'bad webhook secret');
    }
    const update = req.body || {};
    const msg = update.message || update.edited_message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id;
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

app.get('/api/protected/order-history', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!requireCloudStorage(res)) return;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    let orders: any[] = [];
    if (cloudDb) {
      try {
        const open = await cloudDb.getOpenTrades();
        orders = Array.isArray(open) ? open : [];
      } catch {
        /* fall through */
      }
    }
    ok(res, { orders: orders.slice(-limit).reverse() });
  } catch (e: any) {
    fail(res, 500, e?.message || 'order-history failed');
  }
});

app.post('/api/protected/manual-order', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!requireCloudStorage(res)) return;
    const { symbol, side, type, quantity, price } = req.body || {};
    if (typeof symbol !== 'string' || (side !== 'BUY' && side !== 'SELL')) {
      return fail(res, 400, 'Body requires { symbol, side: BUY|SELL, quantity, [price] }');
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return fail(res, 400, 'quantity must be > 0');
    if (pipeline.orderGateway?.getExecutionMode?.() === 'LIVE' &&
        String(process.env.CONFIRM_LIVE_TRADING).toLowerCase() !== 'true') {
      return fail(res, 409, 'LIVE manual orders require CONFIRM_LIVE_TRADING=true');
    }

    const gw = getAny(pipeline, ['orderGateway', 'getOrderGateway']);
    if (gw && typeof gw.submitOrder === 'function') {
      const order = gw.submitOrder({
        symbol,
        side,
        type: type || 'MARKET',
        quantity: qty,
        ...(price !== undefined ? { price: Number(price) } : {}),
      });
      await cloudDb?.saveTrade({ symbol, side, price: Number(price) || 0, quantity: qty, status: 'SUBMITTED', strategyId: 'MANUAL_UI' } as any);
      return ok(res, { order, executed: true });
    }
    return fail(res, 503, 'Order gateway unavailable');
  } catch (e: any) {
    fail(res, 500, e?.message || 'manual-order failed');
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
app.get('/api/download-zip', async (_req: Request, res: Response) => {
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
(app as any).ws('/brain-ws', (socket: any) => {
  brainSockets.add(socket);
  try {
    socket.send(JSON.stringify({ type: 'brain-hello', at: Date.now() }));
  } catch {
    /* ignore */
  }
  socket.on('close', () => brainSockets.delete(socket));
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

const distDir = serverDir; // dist/server.cjs lives beside vite output
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') || req.path.startsWith('/brain-ws')) {
      return next();
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// 404 for unknown API routes
app.use('/api/', (_req: Request, res: Response) => fail(res, 404, 'unknown api route'));

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Quantum Bot server listening on 0.0.0.0:${PORT}`);
  console.log(`   storage=${cloudStorageOk ? 'cloudflare-d1' : 'UNAVAILABLE'} autostart=${AUTOSTART}`);
  if (!AUTOSTART) {
    console.log('⏸ Trading NOT autostarted (set AUTOSTART_TRADING=true to enable). API + UI live.');
    return;
  }
  try {
    await pipeline.start();
    console.log('✅ TradingPipeline started');
  } catch (e: any) {
    console.error('❌ Pipeline start failed (API still live):', e?.message || e);
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
