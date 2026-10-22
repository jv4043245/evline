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
  Posted rows can have `id:null` with a valid `docId`. The adapter consistently
  prefers `hostId:doc:docId`, falling back to `hostId:id` only without a document ID.
  An available ABS ID is also checked as a legacy deduplication alias. Aliases are
  excluded from fingerprints, so an ABS ID appearing later does not duplicate or
  change an already imported document. Ambiguous identities fail closed; legacy
  identity changes are sent to review rather than inserted as another payment.
  Changed replayed records are flagged, never overwritten or silently re-counted.
- Ready invoice/all document snapshots only. Drafts, agreement-only and receipt-only
  output are excluded. Migration backfills output modes from the existing audit log;
  documents with no reliable mode evidence remain ineligible until saved explicitly.
- Full bounded invoice number in payment purpose + same recipient IBAN + UAH.
  Multiple candidates, overpayments, payment before invoice date, canceled orders,
  possible refunds and changed records require review. Payer name alone never matches.
- Partial receipts accumulate up to the invoice amount. Identical revisions count
  as one invoice; materially changed totals for the same number are ambiguous.
- This is a separate bank ledger, not a second revenue source. Linked verified
  receipts update `orders.payment_status` against the full `revenue_uah` order
  price (not an advance invoice amount). Without a positive order price the status
  is partial, never paid. Revenue, supplier payments, notifications, conversions
  and order workflow remain untouched. Manual paid/refunded states are preserved;
  bank-managed states can be corrected to unknown if their bank evidence changes.
  `bank_order_payment_state` records bank-managed states; apply additive migration
  **0040_bank_payment_status.sql** before deploying this version. No existing money
  or payment links are changed by that migration.
- Owner and Andrii may select/search orders and optionally select an issued invoice.
  Linking requires explicit confirmation. An unchanged bank fingerprint,
  amount and unassigned-row condition prevent stale confirmation, duplicate linking
  and reassignment. Repeating the same link is idempotent. Canceled orders, changed
  bank records and outgoing transactions cannot be linked through this action.
  The operation is audited. No automatic reassignment is provided.
- Two entry points share the same guarded link API: the **Замовлення** dropdown
  beside a bank receipt (latest 20 orders, with search for older ones), and
  **Замовлення → Оплата → Оплати клієнта · ПУМБ → Надходження**.
  The order picker defaults to today and the preceding two Kyiv calendar days;
  7/30 days and all imported receipts are also available, paginated in groups of 50.
  Only unassigned, non-ignored UAH inbound facts without blocking disputes appear.
  Selection alone never writes. Save order edits before confirming a link.
  Andrii cannot connect, pause, change credentials or trigger bank synchronization;
  these controls remain owner-only. Other admin identities do not gain link rights.
- Numeric invoice numbers, including 1/2/4, require explicit invoice wording
  (рахунок/рахунку/счет/invoice) before the bounded identifier; dates, amounts and
  unrelated order numbers do not qualify. Name/amount matches are suggestions only.
  They never change a payment or status without an owner's confirmation.
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

### New-receipt indicator and manager view

The top-level **Надходження** tab polls a small authenticated count endpoint every
minute while the browser page is visible, independently of the active CRM section.
It does not call PUMB or replace unsaved order forms. Returning to the browser page
refreshes the count immediately. The bank itself is still polled every 15 minutes.

The orange badge counts imported, non-ignored inbound receipts not yet viewed by
the current CRM identity, whether linked automatically or unassigned. The first
view includes existing imported receipts. Only the visible page's receipt IDs are
acknowledged after a successful active-ledger load; later arrivals and other pages
remain new. Viewing does not link a payment, change its review flag, or its amount.
View state is per user, shared across devices, and deduplicated by immutable receipt
ID. Owner viewing cannot clear Andrii's badge. Failures retain the last known count.

Orange has priority whenever this identity has unseen receipts; its number is the
unseen count. Once all receipts are viewed, the badge turns blue and shows the
shared count of non-ignored inbound receipts with no order assigned, without a
seven-day cutoff. Viewing or leaving the ledger never clears this blue reminder.
It disappears only when both counts are zero. A new receipt restores orange.
The tooltip and accessible label disclose both counts. Linking refreshes the count;
other users receive the updated assignment count on the next poll, but their unread
state remains independent. The API retains `count` for backward compatibility and
adds `unassigned_count`. No additional migration or reset of existing views is needed.

Apply additive migration **0041_bank_receipt_views.sql** before publishing this UI.
It creates only per-user view state; no bank facts, credentials or orders change.
Managers see the title, reload button and bank operations; connection diagnostics,
settings, explanatory technical text and the invoice overview remain owner-only.
Order-specific invoice details and both guarded manual-link entry points remain.
A plain-language outage notice is retained if automatic synchronization is unavailable.

## Production deployment

### Accounting Telegram notices (22 October 2026)

After each bank sync attempt, including cooldown or bank failure, the receipt
outbox drains through Slavik's dedicated `/evline-bank/receipts` endpoint. Only new
positive, non-ignored UAH incoming receipts are queued. Migration 0042 marks all
existing receipts suppressed, so activation does not post history. The existing
15-minute bank schedule is reused. Amount, payer, date, brief purpose and a linked
order number are sent to the owner's fixed «Бухг EV» group by `slavik_office_bot`.
Unassigned receipts explicitly request manual linking; no order is guessed.
Order buttons use the CRM's authenticated `?order=` route.

Install a separate shared `EVLINE_BANK_ALERT_SECRET` on production Pages and the
Slavik Worker. It grants only fixed-group receipt notices/status/one activation
test, not access to other chats or the temporary manager-help channel. Apply
0042 on CRM and 0011 on Slavik before deployment. Failed transport retries retain
the same event ID and frozen facts. Slavik persists the Telegram claim before
sending; sent/uncertain/rejected outcomes are not automatically sent again.
Rate-limited definite rejections honor `retry_after`. The three-receipt batch is
bounded; backlog continues on the next run. Monitor the two outbox tables for
pending/uncertain/rejected states. Bank synchronization is not failed by a notice
outage. No new cron or AI usage is introduced.

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

### Connection diagnostics

Each owner connection attempt records `bank.connect_diagnostic` in the existing
audit table: generated UUID, UTC timestamp, bounded duration, allowlisted stage,
outcome/error code, upstream HTTP status and allowlisted OAuth error identifier.
No login, password, client key, access token, headers, URL, response description,
raw body or exception message is recorded. Failure to store diagnostics is caught
without logging the database exception and is explicitly shown in the response.
The owner bank-status response includes the latest sanitized diagnostic; the form
shows the last failed attempt after reload. Managers do not receive that field.
The ordinary CRM audit remains governed by existing audit access permissions.
OAuth `invalid_grant` is distinct from client authorization, server failures,
timeouts and transport failures. It is not proof of a mistyped password alone.
Diagnostics do not retry requests, change bank endpoints or replace a working
connection on authorization/account-fetch failure. No new migration is required.

Cloudflare Workers rejects `redirect: 'error'` before making an outbound request.
Both OAuth and statement requests use `redirect: 'manual'`; any 3xx response is
rejected as `bank_redirect`, without following or recording `Location`. Node-only
fetch mocks do not detect this runtime incompatibility; use the isolated workerd
regression check in `scripts/test-pumb-runtime.mjs` as well as the unit suite.
The scheduled PUMB HTTP call also uses manual redirect handling and rejects any
non-2xx response without following Location. Runtime tests cover the scheduler
separately; publishing Pages alone does not deploy this shared Worker fix.

Rollback: pause the bank connection, then roll back the site deployment if needed.
Do not remove the shared cron trigger: tracking and reminders use it too. A scheduler
rollback must restore both its previous code and two-hour trigger. Keep additive
database structures and bank facts. Do not drop
financial tables as a rollback. Existing admin functionality works with the added schema.

### Quick linking from the order list

In «Замовлення» → «Дії», the **₴ / Оплата** button directly below the pencil (left
action stack, separate from the delete action) opens a small floating menu over the
table without adding rows or shifting orders. A linked incoming receipt turns the
button blue with «Є оплата», including partial receipts; it remains available for
additional payments. This uses actual non-ignored linked bank receipts, not a
manually selected paid status, and survives reloads. It loads fresh, unassigned, safe UAH incoming receipts for
today and the preceding six Kyiv calendar days (`available=1&days=7`). Assigned,
ignored, outbound, future-dated and flagged unsafe facts are excluded by the
existing server filter. Pagination retains access to more than 50 eligible receipts.
Older receipts remain available from the order card's Payment section.

Receipts are directly selectable menu items (amount, date, payer, purpose), not a
second form or nested dropdown. Selecting one shows a short confirmation in the same
menu, with Back and Confirm buttons; selection itself does not write anything. The existing explicit confirmation,
amount/fingerprint conflict guards, owner/Andrii permissions and audit are reused.
After linking, the order-list payment status updates in place and the candidates
reload; linked receipts disappear. Only one menu is open, loaded on demand (not
once per row); Escape/Close or clicking outside dismisses it. This does not acknowledge receipt badges,
change the bank polling schedule, move money or require a new database migration.

Tests: `tests/pumb-incoming.test.mjs` covers exact money/IDs, schema rejection,
read-method allowlist, encrypted access, authorization, matching, replay, partial/full
receipts, disputes, deletion preservation, sync failure/cooldown, and UI escaping.
