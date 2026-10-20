ALTER TABLE order_documents ADD COLUMN output_mode TEXT NOT NULL DEFAULT '';
UPDATE order_documents SET output_mode = COALESCE((
  SELECT json_extract(a.details_json, '$.mode') FROM admin_audit_log a
  WHERE a.entity_type='order_document' AND a.entity_id=order_documents.id
    AND a.action='document.save' AND json_valid(a.details_json)
  ORDER BY a.created_at DESC LIMIT 1
), '');

CREATE TABLE bank_connections (
  id TEXT PRIMARY KEY CHECK(id='pumb'),
  credentials_encrypted TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  accounts_json TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  cursor_date TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  lease_id TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO bank_connections(id,updated_at) VALUES('pumb',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE bank_incoming (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL CHECK(bank='pumb'),
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_iban TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
  booked_at TEXT NOT NULL,
  payer_name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES order_documents(id) ON DELETE SET NULL,
  invoice_number TEXT,
  invoice_key TEXT,
  matched_at TEXT,
  match_method TEXT,
  review_reason TEXT,
  ignored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bank_incoming_order ON bank_incoming(order_id,booked_at);
CREATE INDEX bank_incoming_invoice ON bank_incoming(invoice_key);
CREATE INDEX bank_incoming_recent ON bank_incoming(booked_at DESC);
-- Retain the bank fact if an administrator deliberately deletes its order.
CREATE TRIGGER bank_incoming_order_deleted BEFORE DELETE ON orders BEGIN
  UPDATE bank_incoming SET review_reason='order_deleted' WHERE order_id=OLD.id;
END;
