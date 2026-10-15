-- Original bank statements contain personal financial information. They have
-- their own owner-and-password gate, independent of the reviewed expense API.
-- Original bytes are imported privately; no real statement is in this file.
CREATE TABLE accounting_bank_sources (
  id TEXT PRIMARY KEY CHECK(length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
  filename TEXT NOT NULL UNIQUE CHECK(length(filename) BETWEEN 1 AND 180),
  mime TEXT NOT NULL CHECK(mime IN ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK(typeof(chunk_count)='integer' AND chunk_count BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
  CHECK(id=sha256),
  CHECK(length(date_from)=10 AND date(date_from,'+0 days') IS NOT NULL AND date(date_from,'+0 days')=date_from),
  CHECK(length(date_to)=10 AND date(date_to,'+0 days') IS NOT NULL AND date(date_to,'+0 days')=date_to AND date_to>=date_from)
);
CREATE TABLE accounting_bank_source_chunks (
  source_id TEXT NOT NULL REFERENCES accounting_bank_sources(id),
  chunk_index INTEGER NOT NULL CHECK(typeof(chunk_index)='integer' AND chunk_index BETWEEN 0 AND 127),
  data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 87384),
  PRIMARY KEY(source_id,chunk_index)
);
CREATE TRIGGER accounting_bank_sources_conflict BEFORE INSERT ON accounting_bank_sources
  WHEN EXISTS(SELECT 1 FROM accounting_bank_sources WHERE (id=NEW.id OR filename=NEW.filename)
    AND (id<>NEW.id OR filename<>NEW.filename OR mime<>NEW.mime OR bytes<>NEW.bytes OR date_from<>NEW.date_from OR date_to<>NEW.date_to OR chunk_count<>NEW.chunk_count))
  BEGIN SELECT RAISE(ABORT,'bank_source_import_conflict'); END;
CREATE TRIGGER accounting_bank_source_chunks_conflict BEFORE INSERT ON accounting_bank_source_chunks
  WHEN EXISTS(SELECT 1 FROM accounting_bank_source_chunks WHERE source_id=NEW.source_id AND chunk_index=NEW.chunk_index AND data_base64<>NEW.data_base64)
  BEGIN SELECT RAISE(ABORT,'bank_source_import_conflict'); END;
CREATE TRIGGER accounting_bank_sources_no_update BEFORE UPDATE ON accounting_bank_sources BEGIN SELECT RAISE(ABORT,'bank_source_immutable'); END;
CREATE TRIGGER accounting_bank_sources_no_delete BEFORE DELETE ON accounting_bank_sources BEGIN SELECT RAISE(ABORT,'bank_source_immutable'); END;
CREATE TRIGGER accounting_bank_source_chunks_no_update BEFORE UPDATE ON accounting_bank_source_chunks BEGIN SELECT RAISE(ABORT,'bank_source_immutable'); END;
CREATE TRIGGER accounting_bank_source_chunks_no_delete BEFORE DELETE ON accounting_bank_source_chunks BEGIN SELECT RAISE(ABORT,'bank_source_immutable'); END;

-- A five-attempt owner-wide window is consumed atomically BEFORE PBKDF2.
-- Sessions retain only hashes, are bound to the same admin credential, and can
-- be revoked independently of the immutable originals.
CREATE TABLE accounting_bank_source_unlock_limits (
  owner_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL CHECK(typeof(window_start)='integer'),
  attempts INTEGER NOT NULL CHECK(typeof(attempts)='integer' AND attempts BETWEEN 1 AND 5)
);
CREATE TABLE accounting_bank_source_sessions (
  session_id TEXT PRIMARY KEY CHECK(length(session_id)=64),
  owner_id TEXT NOT NULL,
  auth_binding TEXT NOT NULL CHECK(length(auth_binding)=64),
  token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer'),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at-created_at<=900),
  revoked_at INTEGER CHECK(revoked_at IS NULL OR typeof(revoked_at)='integer')
);
CREATE INDEX idx_accounting_bank_source_sessions_owner_expiry ON accounting_bank_source_sessions(owner_id,expires_at);
