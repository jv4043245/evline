CREATE TABLE IF NOT EXISTS supplier_requests (
  id TEXT PRIMARY KEY,
  public_number TEXT UNIQUE,
  order_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  car TEXT,
  vin TEXT,
  item_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  request_text TEXT,
  manager_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_requests_order_id ON supplier_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_requests_supplier_id ON supplier_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_requests_access_token ON supplier_requests(access_token);
CREATE INDEX IF NOT EXISTS idx_supplier_requests_status ON supplier_requests(status);
CREATE INDEX IF NOT EXISTS idx_supplier_requests_created_at ON supplier_requests(created_at);

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id TEXT PRIMARY KEY,
  supplier_request_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  quote_type TEXT NOT NULL DEFAULT 'original',
  availability TEXT NOT NULL DEFAULT 'in_stock',
  price_cny REAL NOT NULL DEFAULT 0,
  purchase_days INTEGER NOT NULL DEFAULT 0,
  china_delivery_days INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  part_number TEXT,
  comment_cn TEXT,
  comment_translated TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_request_id) REFERENCES supplier_requests(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_request_id ON supplier_quotes(supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_order_id ON supplier_quotes(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier_id ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status ON supplier_quotes(status);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_created_at ON supplier_quotes(created_at);

CREATE TABLE IF NOT EXISTS supplier_request_images (
  id TEXT PRIMARY KEY,
  supplier_request_id TEXT NOT NULL,
  quote_id TEXT,
  image_url TEXT NOT NULL,
  image_type TEXT NOT NULL DEFAULT 'request',
  created_at TEXT NOT NULL,
  FOREIGN KEY (supplier_request_id) REFERENCES supplier_requests(id),
  FOREIGN KEY (quote_id) REFERENCES supplier_quotes(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_request_images_request_id ON supplier_request_images(supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_request_images_quote_id ON supplier_request_images(quote_id);
CREATE INDEX IF NOT EXISTS idx_supplier_request_images_type ON supplier_request_images(image_type);

CREATE TABLE IF NOT EXISTS supplier_tracking_events (
  id TEXT PRIMARY KEY,
  supplier_request_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  status TEXT NOT NULL,
  tracking_number TEXT,
  comment_cn TEXT,
  comment_translated TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (supplier_request_id) REFERENCES supplier_requests(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_tracking_events_request_id ON supplier_tracking_events(supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_tracking_events_order_id ON supplier_tracking_events(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_tracking_events_supplier_id ON supplier_tracking_events(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_tracking_events_created_at ON supplier_tracking_events(created_at);

INSERT INTO crm_counters (scope, value, updated_at)
VALUES (
  'supplier_request',
  (SELECT COALESCE(MAX(CAST(substr(public_number, 4) AS INTEGER)), 0) FROM supplier_requests),
  datetime('now')
)
ON CONFLICT(scope) DO UPDATE SET
  value = CASE WHEN excluded.value > crm_counters.value THEN excluded.value ELSE crm_counters.value END,
  updated_at = excluded.updated_at;
