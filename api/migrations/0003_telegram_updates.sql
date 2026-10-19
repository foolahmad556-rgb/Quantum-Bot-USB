CREATE TABLE IF NOT EXISTS telegram_updates (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','DONE','FAILED')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_time ON telegram_updates(updated_at);
