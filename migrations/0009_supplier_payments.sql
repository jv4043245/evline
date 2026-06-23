CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  supplier_name TEXT,
  requested_amount REAL NOT NULL DEFAULT 0,
  requested_currency TEXT NOT NULL DEFAULT 'CNY',
  paid_amount REAL NOT NULL DEFAULT 0,
  paid_currency TEXT NOT NULL DEFAULT 'CNY',
  commission_amount REAL NOT NULL DEFAULT 0,
  commission_percent REAL NOT NULL DEFAULT 0,
  request_chat_id TEXT,
  request_message_id TEXT,
  request_text TEXT,
  receipt_chat_id TEXT,
  receipt_message_id TEXT,
  receipt_telegram_file_id TEXT,
  receipt_caption TEXT,
  qr_telegram_file_id TEXT,
  notes TEXT,
  requested_at TEXT,
  paid_at TEXT,
  matched_by TEXT,
  match_confidence TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_payment_number ON supplier_payments(payment_number);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_order_id ON supplier_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_status ON supplier_payments(status);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_request_message ON supplier_payments(request_chat_id, request_message_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_requested_at ON supplier_payments(requested_at);

INSERT INTO crm_counters (scope, value, updated_at)
VALUES (
  'supplier_payment',
  (SELECT COALESCE(MAX(CAST(substr(payment_number, 3) AS INTEGER)), 0) FROM supplier_payments),
  datetime('now')
)
ON CONFLICT(scope) DO UPDATE SET
  value = CASE WHEN excluded.value > crm_counters.value THEN excluded.value ELSE crm_counters.value END,
  updated_at = excluded.updated_at;
