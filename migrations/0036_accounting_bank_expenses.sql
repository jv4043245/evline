-- Private reviewed bank expenses. This ledger never feeds advertising spend,
-- profit drafts, reimbursement balances, or orders automatically.
-- No source financial rows belong in a migration or a static site asset.
CREATE TABLE accounting_bank_expense_batches (
  batch_id TEXT PRIMARY KEY CHECK(length(batch_id) BETWEEN 1 AND 100),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  row_count INTEGER NOT NULL CHECK(typeof(row_count)='integer' AND row_count BETWEEN 1 AND 5000),
  imported_at TEXT NOT NULL
);
CREATE TRIGGER accounting_bank_expense_batch_conflict BEFORE INSERT ON accounting_bank_expense_batches
  WHEN EXISTS(SELECT 1 FROM accounting_bank_expense_batches WHERE batch_id=NEW.batch_id AND content_hash<>NEW.content_hash)
  BEGIN SELECT RAISE(ABORT,'bank_expense_batch_conflict'); END;
CREATE TRIGGER accounting_bank_expense_batches_no_update BEFORE UPDATE ON accounting_bank_expense_batches BEGIN SELECT RAISE(ABORT,'bank_expense_batch_immutable'); END;
CREATE TRIGGER accounting_bank_expense_batches_no_delete BEFORE DELETE ON accounting_bank_expense_batches BEGIN SELECT RAISE(ABORT,'bank_expense_batch_immutable'); END;

CREATE TABLE accounting_bank_expenses (
  id TEXT PRIMARY KEY CHECK(length(id)=67 AND substr(id,1,3)='be_'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  category TEXT NOT NULL CHECK(category IN ('igor_china','zhenia_alipay','zhenia_delivery','order_other')),
  payer TEXT NOT NULL CHECK(payer='zhenia'),
  beneficiary TEXT NOT NULL CHECK(beneficiary IN ('igor','evline')),
  trip_from TEXT,
  trip_to TEXT,
  transaction_at TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 300 AND instr(lower(description),'aliexpress')=0),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor<>0 AND amount_minor BETWEEN -100000000000 AND 100000000000),
  original_amount_minor INTEGER CHECK(original_amount_minor IS NULL OR (typeof(original_amount_minor)='integer' AND original_amount_minor<>0 AND original_amount_minor BETWEEN -100000000000 AND 100000000000)),
  original_currency TEXT CHECK(original_currency IS NULL OR (length(original_currency)=3 AND original_currency NOT GLOB '*[^A-Z]*')),
  bank_rate REAL CHECK(bank_rate IS NULL OR (bank_rate>0 AND bank_rate<=1000000)),
  mcc TEXT CHECK(mcc IS NULL OR (length(mcc)=4 AND mcc NOT GLOB '*[^0-9]*')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 100),
  source_filename TEXT NOT NULL CHECK(length(source_filename) BETWEEN 1 AND 200 AND instr(source_filename,'/')=0 AND instr(source_filename,char(92))=0),
  source_sheet TEXT NOT NULL CHECK(length(source_sheet)<=100),
  source_row INTEGER NOT NULL CHECK(typeof(source_row)='integer' AND source_row BETWEEN 1 AND 10000000),
  classification_note TEXT NOT NULL CHECK(length(trim(classification_note)) BETWEEN 1 AND 1000),
  possible_duplicate INTEGER NOT NULL DEFAULT 0 CHECK(possible_duplicate IN (0,1)),
  imported_at TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES accounting_bank_expense_batches(batch_id),
  UNIQUE(source_id,source_sheet,source_row),
  CHECK(length(transaction_date)=10 AND date(transaction_date,'+0 days') IS NOT NULL AND date(transaction_date,'+0 days')=transaction_date AND transaction_date=substr(transaction_at,1,10)),
  CHECK(length(transaction_at)=19 AND strftime('%Y-%m-%dT%H:%M:%S',transaction_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%S',transaction_at)=transaction_at AND substr(transaction_at,12,2)<'24'),
  CHECK((original_amount_minor IS NULL AND original_currency IS NULL) OR (original_amount_minor IS NOT NULL AND original_currency IS NOT NULL AND (amount_minor>0)=(original_amount_minor>0))),
  CHECK((category='igor_china' AND beneficiary='igor' AND trip_from IS NOT NULL AND trip_to IS NOT NULL AND trip_from='2026-04-10' AND trip_to='2026-05-07' AND transaction_date BETWEEN trip_from AND trip_to)
    OR (category<>'igor_china' AND beneficiary='evline' AND trip_from IS NULL AND trip_to IS NULL))
);
-- Retries may skip an identical row. Reusing a source identity for changed
-- facts aborts the whole import instead of silently overwriting history.
CREATE TRIGGER accounting_bank_expense_row_conflict BEFORE INSERT ON accounting_bank_expenses
  WHEN EXISTS(SELECT 1 FROM accounting_bank_expenses WHERE (id=NEW.id OR (source_id=NEW.source_id AND source_sheet=NEW.source_sheet AND source_row=NEW.source_row)) AND content_hash<>NEW.content_hash)
  BEGIN SELECT RAISE(ABORT,'bank_expense_row_conflict'); END;
CREATE TRIGGER accounting_bank_expenses_no_update BEFORE UPDATE ON accounting_bank_expenses BEGIN SELECT RAISE(ABORT,'bank_expense_row_immutable'); END;
CREATE TRIGGER accounting_bank_expenses_no_delete BEFORE DELETE ON accounting_bank_expenses BEGIN SELECT RAISE(ABORT,'bank_expense_row_immutable'); END;
CREATE INDEX idx_accounting_bank_expenses_date ON accounting_bank_expenses(transaction_date,transaction_at,id);
CREATE INDEX idx_accounting_bank_expenses_category_date ON accounting_bank_expenses(category,transaction_date,transaction_at,id);
