CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  dashboard_access_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppliers_display_name_nocase ON suppliers(display_name COLLATE NOCASE);

INSERT OR IGNORE INTO suppliers (id, display_name, dashboard_access_token, created_at, updated_at) VALUES
  ('supplier_zeekr', 'Zeekr', lower(hex(randomblob(32))), datetime('now'), datetime('now')),
  ('supplier_byd', 'BYD', lower(hex(randomblob(32))), datetime('now'), datetime('now')),
  ('supplier_buble', 'Buble', lower(hex(randomblob(32))), datetime('now'), datetime('now'));

UPDATE supplier_requests
SET supplier_id = CASE lower(trim(supplier_name))
  WHEN 'zeekr' THEN 'supplier_zeekr'
  WHEN 'byd' THEN 'supplier_byd'
  WHEN 'buble' THEN 'supplier_buble'
  ELSE supplier_id
END
WHERE supplier_id NOT LIKE 'supplier_%';

UPDATE supplier_quotes
SET supplier_id = CASE lower(trim(supplier_id))
  WHEN 'zeekr' THEN 'supplier_zeekr'
  WHEN 'byd' THEN 'supplier_byd'
  WHEN 'buble' THEN 'supplier_buble'
  ELSE supplier_id
END
WHERE supplier_id NOT LIKE 'supplier_%';

UPDATE supplier_tracking_events
SET supplier_id = CASE lower(trim(supplier_id))
  WHEN 'zeekr' THEN 'supplier_zeekr'
  WHEN 'byd' THEN 'supplier_byd'
  WHEN 'buble' THEN 'supplier_buble'
  ELSE supplier_id
END
WHERE supplier_id NOT LIKE 'supplier_%';
