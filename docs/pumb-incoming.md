# ПУМБ: надходження за рахунками клієнтів

## Scope and source

Adapter follows the bank-supplied `PUMB_API.zip` (20 October 2026), its instruction
document and Swagger. Production OAuth is on `auth.fuib.com`, API on
`service.fuib.com:4103/war_veganet_api`. Only `GET /account` and
`POST /multi-account-transactions` are allowed. No payment creation, signing,
transfers, bank profile changes, or browser-password extraction.

An API client ID/secret is not sufficient: PUMB also requires a business-bank
username/password. The owner enters these personally in **Надходження →
Підключити ПУМБ**, with explicit storage consent. Prefer a dedicated read-only
bank user. With the main login, the adapter is read-only but the underlying bank
identity can have broader rights. Do not describe it as bank-enforced read-only.

## Data and matching

- Only processed, non-card UAH account transactions. Amounts are integer kopecks;
  64-bit transaction IDs are preserved as strings before parsing JSON.
- Immutable bank facts are deduplicated by bank + recipient IBAN + host/document ID.
  Changed replayed records are flagged, never overwritten or silently re-counted.
- Ready invoice/all document snapshots only. Drafts, agreement-only and receipt-only
  output are excluded. Migration backfills output modes from the existing audit log;
  documents with no reliable mode evidence remain ineligible until saved explicitly.
- Full bounded invoice number in payment purpose + same recipient IBAN + UAH.
  Multiple candidates, overpayments, payment before invoice date, canceled orders,
  possible refunds and changed records require review. Payer name alone never matches.
- Partial receipts accumulate up to the invoice amount. Identical revisions count
  as one invoice; materially changed totals for the same number are ambiguous.
- This is a separate bank ledger, not a second revenue source. Existing manual
  `orders.payment_status`, revenue, supplier payments, notifications, conversions
  and order workflow are untouched. Review queue is informational; automatic
  reassignment of disputed transactions is deliberately not provided.
- Deliberate order deletion preserves its bank facts and marks them for review.

## Scheduling and limits

Existing `evline-crm-tracking-cron` Worker calls the Pages bank cron route every
15 minutes with a separate PUMB token. Its original tracking/reminder tasks retain
their two-hour UTC cadence. No additional cron trigger or paid plan is required.
The standalone PUMB Worker has no schedule and is not used for production polling.
One durable lease and cooldown cover cron/manual refresh. It loads up to three daily
windows per run; initial history can be up to 90 days and catches up incrementally.
After catch-up each poll re-reads yesterday and today. This is polling, not a webhook;
not an instantaneous notification, and it is not a full historical reversal audit.
Corrections dated earlier than yesterday require an owner-initiated reconnect with
an earlier start date. Failed runs preserve the cursor; replay is idempotent.
The visible ledger refreshes every minute while its tab is active and setup is closed.

## Production deployment

1. Verify production's current source lineage before merging. Run `npm test` and
   `wrangler pages functions build functions --outfile=/tmp/evline-pumb-worker.js`.
2. Verify that migrations through 0038 exist remotely. Back up D1 / record its
   time-travel bookmark. Apply **only** `migrations/0039_pumb_incoming.sql` once.
   It adds tables and one column, without modifying existing money amounts.
3. Run `node scripts/prepare-pumb-secrets.mjs /absolute/path/PUMB_API.zip` locally.
   Generated files are under ignored `.local-data/pumb/`, directory 0700/files0600.
   Never commit/upload these as site assets or print their contents.
4. Install production-only Pages secrets with
   `wrangler pages secret bulk .local-data/pumb/pages-secrets.json --project-name evline`.
   Existing secrets are preserved. Required names: `PUMB_CLIENT_ID`,
   `PUMB_CLIENT_SECRET`, `PUMB_ENCRYPTION_KEY`, `PUMB_CRON_TOKEN`.
   Never put production bank secrets or D1 bindings into public preview builds.
5. Deploy the reviewed site revision via the existing production Git/Pages flow.
   Keep the current `DB` binding and unrelated settings.
6. Install the existing PUMB token into the shared scheduler with
   `wrangler secret bulk .local-data/pumb/worker-secrets.json --config workers/tracking-cron/wrangler.toml`,
   preserving its tracking/reminder secrets. Deploy `workers/tracking-cron/wrangler.toml`.
   This updates its one existing trigger to 15 minutes; code gates the legacy jobs
   to their original two-hour cadence. Cron contains only a dedicated shared token,
   never bank credentials. Do not add a separate PUMB trigger.
7. Verify unauthenticated admin/cron calls are denied. Owner verifies the setup
   form, personally supplies bank login/password, chooses history start and consents.
   Verify the first real sync and compare a real receipt to the bank before declaring
   integration operational. Tests/mocked responses are not proof of a live connection.

## Security and operations

Username/password are AES-256-GCM encrypted in D1 with random IV and versioned AAD.
The master key is a separate Cloudflare secret. Never rotate it without migrating
encrypted data; keep a protected recovery copy. Tokens stay in invocation memory.
Routes reject cross-origin setup, require existing admin authentication, and restrict
setup/sync/pause to identity `owner`. Error bodies, audit, UI and logs never expose
bank credentials or raw provider errors. All CRM admins can see the payment ledger.

Pausing stops future polling and preserves existing records and encrypted access.
If bank password changes, reconnect through the owner form. Removing bank API
authorization must be performed in the bank by the account owner.

Rollback: pause the bank connection, then roll back the site deployment if needed.
Do not remove the shared cron trigger: tracking and reminders use it too. A scheduler
rollback must restore both its previous code and two-hour trigger. Keep additive
database structures and bank facts. Do not drop
financial tables as a rollback. Existing admin functionality works with the added schema.

Tests: `tests/pumb-incoming.test.mjs` covers exact money/IDs, schema rejection,
read-method allowlist, encrypted access, authorization, matching, replay, partial/full
receipts, disputes, deletion preservation, sync failure/cooldown, and UI escaping.
