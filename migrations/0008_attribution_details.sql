ALTER TABLE leads ADD COLUMN page_url TEXT;
ALTER TABLE leads ADD COLUMN form_id TEXT;
ALTER TABLE leads ADD COLUMN form_name TEXT;
ALTER TABLE leads ADD COLUMN submitted_at TEXT;
ALTER TABLE leads ADD COLUMN tracking_captured_at TEXT;
ALTER TABLE leads ADD COLUMN attribution_type TEXT;

ALTER TABLE orders ADD COLUMN page_url TEXT;
ALTER TABLE orders ADD COLUMN form_id TEXT;
ALTER TABLE orders ADD COLUMN form_name TEXT;
ALTER TABLE orders ADD COLUMN submitted_at TEXT;
ALTER TABLE orders ADD COLUMN tracking_captured_at TEXT;
ALTER TABLE orders ADD COLUMN attribution_type TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_attribution_type ON leads(attribution_type);
CREATE INDEX IF NOT EXISTS idx_orders_attribution_type ON orders(attribution_type);
CREATE INDEX IF NOT EXISTS idx_orders_gclid ON orders(gclid);
CREATE INDEX IF NOT EXISTS idx_leads_gclid ON leads(gclid);
