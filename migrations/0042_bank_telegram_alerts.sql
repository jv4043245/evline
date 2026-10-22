CREATE TABLE bank_telegram_alerts (
  payment_id TEXT PRIMARY KEY REFERENCES bank_incoming(id),
  status TEXT NOT NULL CHECK(status IN ('pending','sent','uncertain','rejected','suppressed')),
  payload_json TEXT,
  telegram_message_id INTEGER,
  next_attempt_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bank_telegram_alerts_pending ON bank_telegram_alerts(status,next_attempt_at);
-- Establish the activation baseline without posting historical receipts to Telegram.
INSERT INTO bank_telegram_alerts(payment_id,status,created_at,updated_at)
SELECT id,'suppressed',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM bank_incoming;
