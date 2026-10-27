CREATE TABLE IF NOT EXISTS invoice_numbering_changes (
  id TEXT PRIMARY KEY,
  previous_number INTEGER NOT NULL,
  next_number INTEGER NOT NULL CHECK(next_number>previous_number),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL
);
