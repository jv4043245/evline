-- Date-only receipt facts are distinct from immutable bank-statement rows.
-- Screenshots remain private local evidence: only filenames and hashes enter
-- this ledger. A phone/status-bar clock is never a transaction timestamp.
CREATE TABLE accounting_bank_receipts (
  id TEXT PRIMARY KEY CHECK(length(id)=67 AND substr(id,1,3)='br_'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  category TEXT NOT NULL CHECK(category='zhenia_delivery'),
  payer TEXT NOT NULL CHECK(payer='zhenia'),
  beneficiary TEXT NOT NULL CHECK(beneficiary='evline'),
  transaction_date TEXT NOT NULL CHECK(length(transaction_date)=10 AND date(transaction_date,'+0 days') IS NOT NULL AND date(transaction_date,'+0 days')=transaction_date),
  date_basis TEXT NOT NULL CHECK(date_basis IN ('user_confirmation','receipt_image')),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 300),
  original_amount_minor INTEGER NOT NULL CHECK(typeof(original_amount_minor)='integer' AND original_amount_minor BETWEEN 1 AND 100000000000),
  original_currency TEXT NOT NULL CHECK(length(original_currency)=3 AND original_currency NOT GLOB '*[^A-Z]*'),
  service_original_minor INTEGER NOT NULL CHECK(typeof(service_original_minor)='integer' AND service_original_minor BETWEEN 1 AND 100000000000),
  fee_original_minor INTEGER NOT NULL CHECK(typeof(fee_original_minor)='integer' AND fee_original_minor BETWEEN 0 AND 100000000000),
  source_id TEXT NOT NULL UNIQUE CHECK(length(source_id)=64 AND source_id NOT GLOB '*[^0-9a-f]*'),
  source_filename TEXT NOT NULL CHECK(length(source_filename) BETWEEN 1 AND 200 AND instr(source_filename,'/')=0 AND instr(source_filename,char(92))=0),
  classification_note TEXT NOT NULL CHECK(length(trim(classification_note)) BETWEEN 1 AND 1000),
  imported_at TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 100),
  CHECK(service_original_minor+fee_original_minor=original_amount_minor)
);
CREATE TABLE accounting_bank_receipt_uah_confirmations (
  receipt_id TEXT PRIMARY KEY REFERENCES accounting_bank_receipts(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 100000000000),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('owner_confirmation','bank_screenshot')),
  source_id TEXT CHECK(source_id IS NULL OR (length(source_id)=64 AND source_id NOT GLOB '*[^0-9a-f]*')),
  source_filename TEXT CHECK(source_filename IS NULL OR (length(source_filename) BETWEEN 1 AND 200 AND instr(source_filename,'/')=0 AND instr(source_filename,char(92))=0)),
  note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 1000),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  CHECK((source_id IS NULL)=(source_filename IS NULL)),
  CHECK(source_kind<>'bank_screenshot' OR source_id IS NOT NULL)
);
CREATE TRIGGER accounting_bank_receipts_conflict BEFORE INSERT ON accounting_bank_receipts
  WHEN EXISTS(SELECT 1 FROM accounting_bank_receipts WHERE (id=NEW.id OR source_id=NEW.source_id) AND content_hash<>NEW.content_hash)
  BEGIN SELECT RAISE(ABORT,'bank_receipt_import_conflict'); END;
CREATE TRIGGER accounting_bank_receipt_confirmations_conflict BEFORE INSERT ON accounting_bank_receipt_uah_confirmations
  WHEN EXISTS(SELECT 1 FROM accounting_bank_receipt_uah_confirmations WHERE receipt_id=NEW.receipt_id AND content_hash<>NEW.content_hash)
  BEGIN SELECT RAISE(ABORT,'bank_receipt_confirmation_conflict'); END;
CREATE TRIGGER accounting_bank_receipts_no_update BEFORE UPDATE ON accounting_bank_receipts BEGIN SELECT RAISE(ABORT,'bank_receipt_immutable'); END;
CREATE TRIGGER accounting_bank_receipts_no_delete BEFORE DELETE ON accounting_bank_receipts BEGIN SELECT RAISE(ABORT,'bank_receipt_immutable'); END;
CREATE TRIGGER accounting_bank_receipt_confirmations_no_update BEFORE UPDATE ON accounting_bank_receipt_uah_confirmations BEGIN SELECT RAISE(ABORT,'bank_receipt_confirmation_immutable'); END;
CREATE TRIGGER accounting_bank_receipt_confirmations_no_delete BEFORE DELETE ON accounting_bank_receipt_uah_confirmations BEGIN SELECT RAISE(ABORT,'bank_receipt_confirmation_immutable'); END;
CREATE INDEX idx_accounting_bank_receipts_date ON accounting_bank_receipts(transaction_date,id);

-- One receipt is one payment before and after its UAH confirmation. Fees are
-- explanatory components of the original total, never a second debit.
CREATE VIEW accounting_bank_expense_read_model AS
SELECT id,category,payer,beneficiary,trip_from,trip_to,transaction_at,transaction_date,description,amount_minor,
  original_amount_minor,original_currency,bank_rate,mcc,source_id,source_filename,source_sheet,source_row,
  classification_note,possible_duplicate,imported_at,batch_id,
  'bank_statement' AS source_kind,'second' AS time_precision,NULL AS date_basis,
  NULL AS service_original_minor,NULL AS fee_original_minor,NULL AS fee_included,'confirmed' AS uah_status,
  NULL AS confirmation_source_kind,NULL AS confirmation_source_id,NULL AS confirmation_source_filename,
  NULL AS confirmation_note,NULL AS confirmed_at
FROM accounting_bank_expenses
UNION ALL
SELECT r.id,r.category,r.payer,r.beneficiary,NULL,NULL,NULL,r.transaction_date,r.description,c.amount_minor,
  r.original_amount_minor,r.original_currency,NULL,NULL,r.source_id,r.source_filename,NULL,NULL,
  r.classification_note,0,r.imported_at,r.batch_id,
  'receipt_image','date',r.date_basis,r.service_original_minor,r.fee_original_minor,1,
  CASE WHEN c.receipt_id IS NULL THEN 'pending' ELSE 'confirmed' END,
  c.source_kind,c.source_id,c.source_filename,c.note,c.confirmed_at
FROM accounting_bank_receipts r LEFT JOIN accounting_bank_receipt_uah_confirmations c ON c.receipt_id=r.id;
