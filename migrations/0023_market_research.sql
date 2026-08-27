CREATE TABLE IF NOT EXISTS market_research_runs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fingerprint TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  exact_offer_count INTEGER NOT NULL DEFAULT 0,
  offer_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  source_status_json TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_research_offers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  title TEXT NOT NULL,
  price_uah REAL NOT NULL,
  availability TEXT NOT NULL DEFAULT 'unknown',
  availability_text TEXT NOT NULL DEFAULT '',
  lead_time_min INTEGER,
  lead_time_max INTEGER,
  part_type TEXT NOT NULL DEFAULT 'unknown',
  match_type TEXT NOT NULL DEFAULT 'probable',
  part_number TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (run_id) REFERENCES market_research_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_market_research_runs_order
  ON market_research_runs(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_research_offers_run
  ON market_research_offers(run_id, item_key);
