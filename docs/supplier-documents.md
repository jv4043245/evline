# Supplier Documents

The order's Payment tab contains supplier documents, separate from receipt OCR and
customer-facing invoices. Document uploads never change payment amounts, fees,
order status, or advertising conversions.

## Manager Workflow

1. Open an order, choose Payment, then Documents for the relevant supplier payment.
2. Choose invoice, China freight, packing, or other; upload JPG, PNG, WebP or PDF.
   Each file is limited to 10 MiB. Files can also be dropped or pasted into the file
   area. Saving is explicit. Originals are retained in private storage.
3. Use the shared-invoice search to link an existing file to another order. Replacing
   a shared document updates all its links; every older version remains available.
   Removing a link is reversible and does not remove it from other orders.
4. Select files and download a ZIP (up to 10 files / 30 MiB), or send them to your own
   linked Telegram. Carrier export contains only the selected supplier documents.
5. Under My Telegram, start the bot from the generated link. Return to the admin UI,
   refresh connection state, verify the displayed numeric Telegram ID/name, then
   confirm. Each manager must use their own admin token. Pairing expires in 10 minutes.
6. To upload from Telegram, select the order/payment/category in the admin UI and
   open Add via Telegram. The private intake session expires in 20 minutes; finish
   with `/docs_done`. An active screenshot-to-lead draft must be closed first.

## Shipment Follow-Up

New payment requests are assigned to the authenticated admin. Attaching a document
to an older payment also enables its follow-up for the uploader if not already
assigned. Old payments are not mass-subscribed during rollout.

The default due time is five days after the supplier payment's `paid_at`, only when
its status is `paid`. Managers may change the owner/date, pause a reminder, or mark
that payment's goods shipped. An assigned manager must have a confirmed personal
Telegram connection. Order stages from China warehouse onward stop reminders.

The scheduler checks hourly from 09:00 through 18:00 Europe/Kyiv and sends up to five
due reminders per run. The message includes a Chinese follow-up draft, order link,
and up to three original supplier invoices; the remainder stays available in the
order. No message is sent to a customer or supplier, and there is no WeChat integration.
Asked supplier postpones two days, Tomorrow postpones one day, and Shipped stops it.

Each reminder is claimed atomically. A timed-out/uncertain send is not auto-retried;
the manager checks Telegram before scheduling a retry. Stale in-flight claims become
failed after ten minutes. Removed admin identities cannot receive files/reminders.

## Deployment

- Apply `migrations/0030_supplier_documents.sql` to the production D1 database.
- Create a private Standard-class R2 bucket and bind it as `SUPPLIER_DOCUMENTS`
  in the Pages Wrangler configuration. Do not enable r2.dev, a public custom domain,
  or public object URLs. Use a separate bucket for preview deployments.
- Deploy `workers/supplier-document-reminders/wrangler.toml`.
- Generate a cryptographically random secret for the Worker's
  `SUPPLIER_DOCS_CRON_TOKEN`. Store only its SHA-256 digest in D1:
  `supplier_document_runtime(key='cron_token_sha256', value=<digest>)`.
  The Pages application does not need new account-level Cloudflare permissions.
- Run one authenticated POST to `/api/cron/supplier-documents` and verify the worker
  schedule. Successful dispatch writes `cron_last_run_at`; the admin UI warns when
  the last successful check is missing or older than 24 hours.
- Secret material must never appear in Git, browser URLs, source files, or logs.

All file endpoints require a current admin token and return no-store responses.
Stored keys and the scheduler digest are not included in UI responses. PDF preview
is sandboxed; originals remain downloadable if a browser blocks embedded PDF viewers.

## Verification

- `node --test tests/supplier-documents.test.mjs`
- `node scripts/supplier-documents-smoke.mjs` with `PLAYWRIGHT_MODULE` if necessary
- `npx wrangler pages functions build --outfile /tmp/evline-worker.js`

The smoke test uses synthetic data and intercepts all APIs. It creates no live
orders, sends no real Telegram messages, and captures 1440/1024/768/390/320px layouts.
