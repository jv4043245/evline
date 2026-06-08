ALTER TABLE leads ADD COLUMN gbraid TEXT;
ALTER TABLE leads ADD COLUMN wbraid TEXT;

ALTER TABLE orders ADD COLUMN gbraid TEXT;
ALTER TABLE orders ADD COLUMN wbraid TEXT;

CREATE TABLE IF NOT EXISTS google_ads_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO google_ads_settings (key, value, updated_at) VALUES
('customer_id', '4028488894', datetime('now')),
('currency_code', 'UAH', datetime('now')),
('lead_conversion_action_name', 'EVLine Lead', datetime('now')),
('paid_conversion_action_name', 'EVLine Paid Order', datetime('now')),
('completed_conversion_action_name', 'EVLine Completed Order', datetime('now'));

CREATE TABLE IF NOT EXISTS google_ads_conversion_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  lead_id TEXT,
  event_type TEXT NOT NULL,
  crm_status TEXT NOT NULL,
  google_ads_customer_id TEXT,
  conversion_action TEXT,
  conversion_action_name TEXT,
  conversion_time TEXT NOT NULL,
  conversion_value REAL NOT NULL DEFAULT 0,
  gross_profit_uah REAL NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'UAH',
  order_id_for_google TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  has_click_id INTEGER NOT NULL DEFAULT 0,
  has_customer_identifier INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT,
  google_upload_response TEXT,
  last_error TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_ads_conversion_events_unique
  ON google_ads_conversion_events(order_id, event_type);

CREATE INDEX IF NOT EXISTS idx_google_ads_conversion_events_status
  ON google_ads_conversion_events(status, created_at);

CREATE INDEX IF NOT EXISTS idx_google_ads_conversion_events_order_id
  ON google_ads_conversion_events(order_id);

CREATE INDEX IF NOT EXISTS idx_google_ads_conversion_events_campaign
  ON google_ads_conversion_events(source, campaign);
