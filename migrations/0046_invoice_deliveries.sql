CREATE TABLE IF NOT EXISTS invoice_deliveries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES standalone_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  error TEXT
);
