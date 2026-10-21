-- Per-CRM-user view state only; never changes bank facts or payment associations.
CREATE TABLE bank_receipt_views (
  user_id TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES bank_incoming(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL,
  PRIMARY KEY(user_id, payment_id)
);
