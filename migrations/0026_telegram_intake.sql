CREATE TABLE IF NOT EXISTS telegram_intake_connections (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0, event_date INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_intake_chats (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES telegram_intake_connections(id),
  chat_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'auto', state TEXT NOT NULL DEFAULT 'waiting',
  generation INTEGER NOT NULL DEFAULT 0, processed_generation INTEGER NOT NULL DEFAULT -1,
  first_message_id INTEGER NOT NULL DEFAULT 0, order_id TEXT,
  proposal_json TEXT NOT NULL DEFAULT '{}', snapshot_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '', commit_nonce TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_intake_messages (
  chat_key TEXT NOT NULL REFERENCES telegram_intake_chats(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL, revision INTEGER NOT NULL, update_id INTEGER NOT NULL,
  role TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', has_media INTEGER NOT NULL DEFAULT 0,
  requires_review INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0, sent_at TEXT NOT NULL,
  PRIMARY KEY (chat_key, message_id)
);
CREATE TABLE IF NOT EXISTS telegram_intake_changes (
  id TEXT PRIMARY KEY, chat_key TEXT NOT NULL REFERENCES telegram_intake_chats(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, generation INTEGER NOT NULL, actor TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_intake_order ON telegram_intake_chats(order_id);
CREATE INDEX IF NOT EXISTS idx_telegram_intake_updated ON telegram_intake_chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_intake_changes ON telegram_intake_changes(chat_key, created_at DESC);
