CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_updated_at ON trades(updated_at);

CREATE TABLE IF NOT EXISTS trade_fills (
  id TEXT PRIMARY KEY,
  parent_trade_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id, fill_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_fills_parent_trade ON trade_fills(parent_trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_fills_order ON trade_fills(order_id);
CREATE INDEX IF NOT EXISTS idx_trade_fills_created_at ON trade_fills(created_at);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balance_created_at ON balance_snapshots(created_at);

CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prices_symbol_created_at ON prices(symbol, created_at);

CREATE TABLE IF NOT EXISTS council_shadow (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_council_shadow_created_at ON council_shadow(created_at);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
