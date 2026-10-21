-- Track only statuses managed by bank reconciliation. Never overwrite a manual refund.
CREATE TABLE bank_order_payment_state (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  last_status TEXT,
  updated_at TEXT NOT NULL
);
