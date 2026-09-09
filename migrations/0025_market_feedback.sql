CREATE TABLE IF NOT EXISTS market_offer_feedback (
  comparison_key TEXT PRIMARY KEY,
  rejected INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
