-- Private immutable evidence, not another source of spend to be summed.
CREATE TABLE IF NOT EXISTS accounting_reports (
  id TEXT PRIMARY KEY CHECK(length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
  provider TEXT NOT NULL CHECK(provider IN ('google','meta')),
  account_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('native_export','sync_payload','derived')),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 180),
  mime TEXT NOT NULL CHECK(mime IN ('text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  source_fetched_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  run_id TEXT UNIQUE,
  chunk_count INTEGER NOT NULL CHECK(typeof(chunk_count)='integer' AND chunk_count BETWEEN 1 AND 32),
  CHECK((provider='google' AND account_id='4028488894' AND scope='account' AND source_ref='') OR
    (provider='meta' AND account_id='1354524650161143' AND scope='campaign' AND source_ref='evline_campaign_120251518463770454')),
  CHECK((source_kind='sync_payload' AND run_id IS NOT NULL) OR (source_kind<>'sync_payload' AND run_id IS NULL)),
  CHECK(date(date_from,'+0 days') IS NOT NULL AND date(date_from,'+0 days')=date_from AND length(date_from)=10),
  CHECK(date(date_to,'+0 days') IS NOT NULL AND date(date_to,'+0 days')=date_to AND length(date_to)=10 AND date_to>=date_from)
);
CREATE INDEX IF NOT EXISTS idx_accounting_reports_provider_created ON accounting_reports(provider,created_at DESC,id DESC);

-- Base64 TEXT keeps D1's JSON serialization bounded (BLOB reads become numeric
-- JS arrays). Each row encodes at most256KiB, below the2MB D1 row limit.
CREATE TABLE IF NOT EXISTS accounting_report_chunks (
  report_id TEXT NOT NULL REFERENCES accounting_reports(id),
  chunk_index INTEGER NOT NULL CHECK(typeof(chunk_index)='integer' AND chunk_index BETWEEN 0 AND 31),
  data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 349528),
  PRIMARY KEY(report_id,chunk_index)
);
CREATE TRIGGER IF NOT EXISTS accounting_reports_no_update BEFORE UPDATE ON accounting_reports BEGIN SELECT RAISE(ABORT,'accounting_report_immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_reports_no_delete BEFORE DELETE ON accounting_reports BEGIN SELECT RAISE(ABORT,'accounting_report_immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_report_chunks_no_update BEFORE UPDATE ON accounting_report_chunks BEGIN SELECT RAISE(ABORT,'accounting_report_immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_report_chunks_no_delete BEFORE DELETE ON accounting_report_chunks BEGIN SELECT RAISE(ABORT,'accounting_report_immutable'); END;
