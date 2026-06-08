ALTER TABLE orders ADD COLUMN tracking_last_checked_at TEXT;
ALTER TABLE orders ADD COLUMN tracking_last_event_id TEXT;
ALTER TABLE orders ADD COLUMN tracking_status_code TEXT;
ALTER TABLE orders ADD COLUMN tracking_status_text TEXT;
ALTER TABLE orders ADD COLUMN tracking_status_location TEXT;
ALTER TABLE orders ADD COLUMN tracking_status_at TEXT;
ALTER TABLE orders ADD COLUMN tracking_sync_error TEXT;
ALTER TABLE orders ADD COLUMN carrier_estimated_delivery_at TEXT;

ALTER TABLE shipping_carriers ADD COLUMN tracking_provider TEXT;
ALTER TABLE shipping_carriers ADD COLUMN tracking_auto_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_tracking_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  carrier_id TEXT,
  tracking_number TEXT NOT NULL,
  carrier_event_id TEXT NOT NULL,
  occurred_at TEXT,
  country TEXT,
  city TEXT,
  status_code TEXT,
  status_text TEXT,
  status_description TEXT,
  raw_payload_json TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_tracking_events_unique
  ON order_tracking_events(order_id, carrier_event_id);

CREATE INDEX IF NOT EXISTS idx_order_tracking_events_order_id
  ON order_tracking_events(order_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_last_checked_at
  ON orders(tracking_last_checked_at);

UPDATE shipping_carriers
SET
  tracking_provider = 'meest-china',
  tracking_auto_enabled = 1,
  tracking_url_template = 'https://cab.meest.cn/'
WHERE id = 'mist-china';

UPDATE shipping_carriers
SET
  tracking_provider = 'manual',
  tracking_auto_enabled = 0,
  tracking_url_template = 'https://ukr-china.com/treking-vantazhiv/'
WHERE id = 'ukr-china';
