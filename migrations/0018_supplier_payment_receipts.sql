CREATE TABLE IF NOT EXISTS supplier_payment_receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  supplier_payment_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  supplier_request_id TEXT,
  supplier_quote_id TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  chat_id TEXT,
  message_id TEXT,
  telegram_file_id TEXT,
  caption TEXT,
  matched_by TEXT,
  match_confidence TEXT,
  ocr_source TEXT,
  source TEXT,
  FOREIGN KEY (supplier_payment_id) REFERENCES supplier_payments(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_receipts_payment_id
ON supplier_payment_receipts(supplier_payment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_receipts_order_id
ON supplier_payment_receipts(order_id);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_receipts_request_id
ON supplier_payment_receipts(supplier_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_receipts_chat_message
ON supplier_payment_receipts(chat_id, message_id)
WHERE COALESCE(chat_id, '') <> '' AND COALESCE(message_id, '') <> '';

INSERT OR IGNORE INTO supplier_payment_receipts (
  id, created_at, supplier_payment_id, order_id, supplier_request_id, supplier_quote_id,
  amount, currency, chat_id, message_id, telegram_file_id, caption, matched_by,
  match_confidence, source
)
SELECT
  lower(hex(randomblob(16))),
  COALESCE(paid_at, updated_at, created_at),
  id,
  order_id,
  supplier_request_id,
  supplier_quote_id,
  COALESCE(paid_amount, 0),
  COALESCE(NULLIF(paid_currency, ''), requested_currency, 'CNY'),
  receipt_chat_id,
  receipt_message_id,
  receipt_telegram_file_id,
  receipt_caption,
  matched_by,
  match_confidence,
  'backfill'
FROM supplier_payments
WHERE COALESCE(receipt_message_id, '') <> ''
   OR COALESCE(receipt_telegram_file_id, '') <> ''
   OR COALESCE(paid_amount, 0) > 0;
