-- Explicit, manually declared monthly drafts only. No order/payment inference,
-- accounting_entries backfill, final approval, or automatic payout is created.
CREATE TABLE IF NOT EXISTS accounting_profit_drafts (
  month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND month >= '2020-01' AND date(month || '-01', '+0 days') IS NOT NULL AND date(month || '-01', '+0 days') = month || '-01'),
  basis TEXT NOT NULL CHECK(basis = 'paid_and_delivered'),
  revenue_minor INTEGER CHECK(revenue_minor IS NULL OR (typeof(revenue_minor) = 'integer' AND revenue_minor BETWEEN 0 AND 100000000000)),
  purchase_minor INTEGER CHECK(purchase_minor IS NULL OR (typeof(purchase_minor) = 'integer' AND purchase_minor BETWEEN 0 AND 100000000000)),
  shipping_minor INTEGER CHECK(shipping_minor IS NULL OR (typeof(shipping_minor) = 'integer' AND shipping_minor BETWEEN 0 AND 100000000000)),
  other_minor INTEGER CHECK(other_minor IS NULL OR (typeof(other_minor) = 'integer' AND other_minor BETWEEN 0 AND 100000000000)),
  other_note TEXT NOT NULL DEFAULT '' CHECK(length(other_note) <= 500),
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  save_id TEXT NOT NULL UNIQUE,
  CHECK(other_minor IS NULL OR other_minor = 0 OR length(trim(other_note)) > 0)
);

-- Immutable snapshots capture both manual inputs and the advertising/calculation
-- visible at save time. A later ad correction changes the live preview, not this
-- audit. Only an internal administrator ID is kept; no token or customer data.
CREATE TABLE IF NOT EXISTS accounting_profit_revisions (
  month TEXT NOT NULL REFERENCES accounting_profit_drafts(month),
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision > 0),
  save_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  PRIMARY KEY(month, revision)
);
CREATE TRIGGER IF NOT EXISTS accounting_profit_revisions_no_update
BEFORE UPDATE ON accounting_profit_revisions BEGIN SELECT RAISE(ABORT, 'profit_revision_immutable'); END;
CREATE TRIGGER IF NOT EXISTS accounting_profit_revisions_no_delete
BEFORE DELETE ON accounting_profit_revisions BEGIN SELECT RAISE(ABORT, 'profit_revision_immutable'); END;
