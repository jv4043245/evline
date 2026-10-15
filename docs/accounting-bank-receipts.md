# Date-only delivery receipts

Migration `0038_accounting_bank_receipts.sql` adds immutable image-receipt facts
and separate immutable UAH confirmations. Existing bank-statement rows, source
archives, advertising, profit and reimbursement calculations are untouched.
The authenticated bank-expense API reads one unified view. Every receipt remains
one payment before and after confirmation; a confirmation does not add a row.

Only an actual known UAH debit may be confirmed. Unknown UAH stays `null`, never
zero, an estimated conversion, or a CNY amount mislabeled as UAH. The original
total is service plus fee; fee components are explanatory and are never added
again to a debit. Receipt date precision is a date, with `transaction_at`,
`source_sheet`, and `source_row` null. A screenshot's status-bar clock or capture
filename does not establish the payment time. `date_basis` explicitly records
`user_confirmation` or `receipt_image`.

## Private operator import

Create a JSON manifest outside the site repository with `batch_id`, `actor_id`,
and a `receipts` array. Each receipt requires:

* `source_path`: actual private PNG/JPEG/WebP file path.
* `transaction_date`, `date_basis`, `description`, `classification_note`.
* `original_currency`, `original_amount_minor`, `service_original_minor`,
  `fee_original_minor`: integer minor units of the original currency.
* Optional `confirmation`: `amount_minor` (actual UAH kopecks), `source_kind`
  (`bank_screenshot` or `owner_confirmation`), and explanatory `note`.
  `bank_screenshot` additionally requires `source_path` pointing to the actual
  private screenshot confirming the debit. An owner's confirmation may include
  a source image too.

```sh
node scripts/import-accounting-bank-receipts.mjs --manifest /private/tmp/receipts.json --output /private/tmp/receipt-import.sql
```

The CLI rejects source/manifest/output paths within the public repository,
verifies image signatures and bounded file sizes, computes SHA256 from each
actual image's bytes, and writes metadata-only SQL exclusively with mode0600.
It never retains screenshot bytes, balances, account IDs or status-bar times.
No new image download/archive or browser write endpoint is introduced. Do not
put real financial values or source images in Git or the static build directory.

Apply migration0038 before deploying the updated reader, then execute the private
SQL with the normal D1 file import mechanism. No explicit transaction statements
are included. Identical retries do nothing; changed receipt facts or a different
confirmed UAH amount for the same identity abort instead of overwriting history.

If UAH is learned later, import a manifest with `confirmations` (without
`receipts`), whose objects contain `receipt_id` plus the confirmation fields
listed above. That adds the amount to the existing receipt's read model while
preserving its ID and original evidence. It does not insert a second payment.
Do not import that payment again as a new bank-statement row when processing a
later full statement. Match it to this receipt and append its confirmation;
operator deduplication is required because screenshots lack bank transaction IDs.

## Read contract

Rows retain existing fields and add `source_kind` (`bank_statement` or
`receipt_image`), `time_precision`, `date_basis`, `uah_status`,
`service_original_minor`, `fee_original_minor`, `fee_included`, and confirmation
source filename/hash/note. A receipt has null `transaction_at`, `source_sheet`,
and `source_row`. No invented precision is displayed. Confirmed receipt FX is a
derived ratio of actual UAH to original currency; `bank_rate` remains null.

All existing category/date/search filters and pagination include receipts. Rows
sort by recorded date first, then actual known time and ID; a date-only payment
follows known-time payments within its date. Summary and per-category totals are
computed before pagination. `count` and `debit_count` include pending receipts;
UAH debit/refund/net totals include only known UAH. `pending_uah_count`,
`receipt_count`, and `pending_original_totals` report pending original-currency
amounts explicitly (objects have `currency`, `amount_minor`, `count`). Coverage
includes receipt dates too. A confirmed receipt has no pending original total.
