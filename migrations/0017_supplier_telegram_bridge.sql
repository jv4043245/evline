ALTER TABLE supplier_requests ADD COLUMN manager_comment_ru TEXT;
ALTER TABLE supplier_requests ADD COLUMN manager_comment_cn TEXT;

CREATE TABLE IF NOT EXISTS supplier_telegram_messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  supplier_request_id TEXT NOT NULL,
  order_id TEXT,
  supplier_id TEXT,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  source TEXT,
  text_ru TEXT,
  text_cn TEXT,
  FOREIGN KEY (supplier_request_id) REFERENCES supplier_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_telegram_messages_chat_message
ON supplier_telegram_messages(chat_id, message_id);

CREATE INDEX IF NOT EXISTS idx_supplier_telegram_messages_request_id
ON supplier_telegram_messages(supplier_request_id);

UPDATE supplier_requests
SET manager_comment_ru = COALESCE(NULLIF(manager_comment_ru, ''), manager_comment),
    manager_comment_cn = COALESCE(NULLIF(manager_comment_cn, ''), manager_comment)
WHERE COALESCE(manager_comment, '') <> ''
  AND (COALESCE(manager_comment_ru, '') = '' OR COALESCE(manager_comment_cn, '') = '');
