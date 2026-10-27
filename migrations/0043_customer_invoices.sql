CREATE TABLE IF NOT EXISTS standalone_documents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  revision INTEGER NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready')),
  data_json TEXT NOT NULL, output_mode TEXT NOT NULL DEFAULT 'invoice',
  UNIQUE(workspace_id, revision)
);
CREATE TABLE IF NOT EXISTS invoice_sequence (
  id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL CHECK(next_number>=9)
);
-- The owner confirmed that the last externally issued invoice was number 8.
INSERT OR IGNORE INTO invoice_sequence(id,next_number) VALUES(1,9);
CREATE TABLE IF NOT EXISTS invoice_numbers (
  number TEXT NOT NULL, iban TEXT NOT NULL, scope TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(number,iban)
);
CREATE TABLE IF NOT EXISTS document_save_requests (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, fingerprint TEXT NOT NULL
);
