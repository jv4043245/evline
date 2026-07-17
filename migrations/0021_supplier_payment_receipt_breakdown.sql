CREATE TABLE IF NOT EXISTS supplier_payment_receipt_breakdowns (
  receipt_id TEXT PRIMARY KEY,
  supplier_amount REAL NOT NULL DEFAULT 0,
  commission_amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (receipt_id) REFERENCES supplier_payment_receipts(id)
);
