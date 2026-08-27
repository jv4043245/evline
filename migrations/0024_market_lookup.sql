CREATE TABLE IF NOT EXISTS market_lookup_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  car TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  part_number TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  exact_offer_count INTEGER NOT NULL DEFAULT 0,
  offer_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  source_status_json TEXT NOT NULL DEFAULT '[]',
  offers_json TEXT NOT NULL DEFAULT '[]',
  linked_order_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_market_lookup_runs_created
  ON market_lookup_runs(created_at DESC);
