# Reviewed card expenses

The administrator accounting section has separate read-only bank ledgers for
Igor's China trip, Zhenia's Alipay parts payments, Meest delivery and other
confirmed order expenses. They do not feed advertising reimbursement, order
profit recognition or saved settlement drafts automatically.

`GET /api/admin/accounting/bank-expenses` uses the existing administrator
authentication. Supported optional filters are `category`, inclusive `from` and
`to`, literal merchant search `q`, and `page` / `page_size`. Amounts are integer
UAH kopecks. Expenses are positive and refunds are negative; summary refund
amounts are positive magnitudes. Totals cover the complete filtered set before
pagination. Bank timestamps retain the statement's local date and time.

Each row retains source filename, sheet and physical row, original currency
amount, available MCC and bank exchange rate, classification explanation and a
possible-repeat flag. A repeat flag is not authority to remove an actual debit.
Personal AliExpress purchases are excluded from this ledger.

## Private import

Apply only additive migration `0036_accounting_bank_expenses.sql`, after
recording a D1 recovery bookmark and verifying existing table names. Do not run
all historical migrations. Existing advertising and settlement tables are not
changed.

Keep reviewed input and generated SQL outside the site checkout:

```sh
node scripts/import-accounting-bank-expenses.mjs \
  --input /private/path/reviewed-bank-expenses.json \
  --output /private/path/reviewed-bank-expenses.sql
```

The CLI validates the exact receipt fields, generates deterministic source-row
identities, rejects personal AliExpress entries and writes SQL with mode 0600.
An identical import is safe to retry. Changed facts under an existing source
identity or batch identifier are rejected rather than silently overwritten.
After importing, reconcile category counts, net amounts and refunds before
publishing the UI. Do not commit source statements, receipt JSON or generated
SQL; do not place them in static assets. There is no public write/import API.

## Navigation

- `#accounting/igor/china`: Igor travel expenses.
- `#accounting/igor/advertising`: existing Romania advertising reimbursement.
- `#accounting/zhenia-alipay`: Alipay parts payments; other confirmed order
  payments are in a separate expandable block.
- `#accounting/zhenia-delivery`: Meest payments.

Bank ledgers have independent date filters. The global advertising-period
selector does not limit their initial history. Source details are expandable;
mobile rows preserve amounts and dates without shrinking the desktop table.
