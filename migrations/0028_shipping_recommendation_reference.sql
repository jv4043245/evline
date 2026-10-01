-- Private reference only; no customer/order tables are modified.
CREATE TABLE IF NOT EXISTS shipping_recommendation_reference (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Insert private evidence out of band. Never commit it to this public repository.
