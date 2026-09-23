CREATE TABLE IF NOT EXISTS order_documents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready')),
  data_json TEXT NOT NULL,
  UNIQUE(order_id, revision)
);
CREATE TABLE IF NOT EXISTS document_seller_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL, actor TEXT NOT NULL, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_deliveries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES order_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, actor TEXT NOT NULL, recipient TEXT NOT NULL,
  status TEXT NOT NULL, message_id TEXT, error TEXT
);
