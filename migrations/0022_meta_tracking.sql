ALTER TABLE leads ADD COLUMN fbp TEXT;
ALTER TABLE leads ADD COLUMN fbc TEXT;
ALTER TABLE leads ADD COLUMN meta_event_id TEXT;
ALTER TABLE leads ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN marketing_consent_at TEXT;
ALTER TABLE leads ADD COLUMN consent_version TEXT;

ALTER TABLE orders ADD COLUMN fbp TEXT;
ALTER TABLE orders ADD COLUMN fbc TEXT;
ALTER TABLE orders ADD COLUMN meta_event_id TEXT;
ALTER TABLE orders ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN marketing_consent_at TEXT;
ALTER TABLE orders ADD COLUMN consent_version TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_meta_event_id
  ON leads(meta_event_id)
  WHERE meta_event_id IS NOT NULL AND meta_event_id <> '';

CREATE INDEX IF NOT EXISTS idx_leads_fbc ON leads(fbc);
CREATE INDEX IF NOT EXISTS idx_orders_fbc ON orders(fbc);
