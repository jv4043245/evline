CREATE TABLE IF NOT EXISTS screenshot_intake_managers (
  telegram_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paused')),
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS screenshot_intake_drafts (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL REFERENCES screenshot_intake_managers(telegram_id),
  chat_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('viber', 'whatsapp', 'other')),
  status TEXT NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting', 'ready', 'applied', 'canceled', 'expired')),
  active_manager_id TEXT UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  fields_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  blocking INTEGER NOT NULL DEFAULT 0,
  analysis_until INTEGER NOT NULL DEFAULT 0,
  analysis_token TEXT NOT NULL DEFAULT '',
  commit_nonce TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  order_number TEXT NOT NULL DEFAULT '',
  applied_mode TEXT NOT NULL DEFAULT '',
  applied_revision INTEGER,
  summary_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purged_at TEXT
);

CREATE TABLE IF NOT EXISTS screenshot_intake_sources (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES screenshot_intake_drafts(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text', 'image')),
  text TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  file_unique_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_screenshot_source_file ON screenshot_intake_sources(draft_id, file_unique_id) WHERE file_unique_id != '';
CREATE INDEX IF NOT EXISTS idx_screenshot_draft_updated ON screenshot_intake_drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_screenshot_draft_expiry ON screenshot_intake_drafts(expires_at);
CREATE INDEX IF NOT EXISTS idx_screenshot_source_draft ON screenshot_intake_sources(draft_id, message_id);

-- No screenshot text, file IDs, or extracted personal fields in durable history.
CREATE TABLE IF NOT EXISTS screenshot_intake_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES screenshot_intake_drafts(id),
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  order_id TEXT,
  summary_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
