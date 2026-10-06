CREATE TABLE IF NOT EXISTS supplier_documents (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('invoice','china_shipping','packing','other')),
  reference TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_key TEXT UNIQUE,
  UNIQUE(document_id, version)
);
CREATE TABLE IF NOT EXISTS supplier_document_links (
  document_id TEXT NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES supplier_payments(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(document_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_document_links_order ON supplier_document_links(order_id, archived_at);
CREATE TABLE IF NOT EXISTS supplier_document_telegram (
  admin_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_document_pairings (
  admin_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  telegram_id TEXT,
  display_name TEXT
);
CREATE TABLE IF NOT EXISTS supplier_document_intakes (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES supplier_payments(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_document_intakes_active ON supplier_document_intakes(admin_id) WHERE active = 1;
CREATE TABLE IF NOT EXISTS supplier_document_followups (
  payment_id TEXT PRIMARY KEY REFERENCES supplier_payments(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL,
  due_at TEXT,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','sending','notified','failed','paused','shipped')),
  tracking_number TEXT NOT NULL DEFAULT '',
  last_asked_at TEXT,
  last_attempt_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_document_followups_due ON supplier_document_followups(state, due_at);
CREATE TABLE IF NOT EXISTS supplier_document_runtime (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
