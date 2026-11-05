CREATE TABLE IF NOT EXISTS trade_fills (
  id TEXT PRIMARY KEY,
  parent_trade_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id, fill_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_fills_parent_trade
  ON trade_fills(parent_trade_id);

CREATE INDEX IF NOT EXISTS idx_trade_fills_order
  ON trade_fills(order_id);

CREATE INDEX IF NOT EXISTS idx_trade_fills_created_at
  ON trade_fills(created_at);
