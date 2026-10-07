# Supplier Documents

The order's Payment tab contains supplier documents, separate from receipt OCR and
customer-facing invoices. Document uploads never change payment amounts, fees,
order status, or advertising conversions.

## Manager Workflow

1. Open an order, choose Payment, then Documents for the relevant supplier payment.
2. Choose invoice, China freight, packing, or other; upload JPG, PNG, WebP or PDF.
   Each file is limited to 10 MiB. Files can also be dropped or pasted into the file
   area. Save with either the document's Save files button or the order's Save
   changes button. Both save the selected originals to private storage. Pending
   files enable Save changes and are included in the unsaved-changes warning.
   Saving files alone never sends customer notifications or updates order finances.
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

The production scheduler reuses the existing tracking cron every two hours, only
from 09:00 through 18:00 Europe/Kyiv, and sends up to five
due reminders per run. The message includes a Chinese follow-up draft, order link,
and up to three original supplier invoices; the remainder stays available in the
order. No message is sent to a customer or supplier, and there is no WeChat integration.
Asked supplier postpones two days, Tomorrow postpones one day, and Shipped stops it.

Each reminder is claimed atomically. A timed-out/uncertain send is not auto-retried;
the manager checks Telegram before scheduling a retry. Stale in-flight claims become
failed after ten minutes. Removed admin identities cannot receive files/reminders.

## Deployment

- Apply `migrations/0030_supplier_documents.sql` to the production D1 database.
- Connect a private Google Drive folder using the setup below. R2 and a billing
  card are not required. Use a separate Drive folder and credentials for previews;
  production secrets must never be copied to a public preview deployment.
- Deploy `workers/tracking-cron/wrangler.toml`, preserving its existing variables,
  secret and cron schedule. Its independent reminder task reuses the existing cron
  slot, so the account does not need an extra paid cron. The standalone
  `workers/supplier-document-reminders/wrangler.toml` is optional, not deployed
  alongside the shared scheduler.
- Generate a cryptographically random secret for the tracking Worker's
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

## Google Drive Setup

The owner's Codex connector is not a credential for the production CRM. Use a
dedicated Google OAuth application with only `https://www.googleapis.com/auth/drive.file`.
Do not request whole-Drive access, reuse advertising credentials, or use a service
account to store files in a personal Drive (service accounts do not own a personal
storage quota). No paid Google Cloud trial or billing account is needed for Drive API.

1. In an owner-controlled Google Cloud project, enable Google Drive API. Configure
   the OAuth consent screen and a Desktop app client. The owner accepts any terms
   and grants access. Save the downloaded client JSON outside Git, for example
   under the ignored `.local-data/` directory with owner-only permissions.
2. For lasting authorization, put the consent app in production before connecting.
   External apps left in Testing may have seven-day refresh tokens. This is a
   single-owner integration, not a public sign-in feature for managers.
3. Run `node scripts/connect-supplier-drive.mjs /absolute/path/to/client.json expected-owner-email`,
   replacing the last argument with the owner's exact Google account address.
   Open its Google authorization URL and sign in as the Drive owner. The local
   callback uses a short-lived state and PKCE, listens only on loopback, requests
   only per-file access, and saves secrets with mode 0600 in `.local-data/`.
   It does not log tokens or authorization codes. Before saving credentials or
   creating any folder, the helper checks the live Drive owner's email. It then
   checks storage quota and creates or reuses the application's private
   `Supplier invoices` folder.
4. Move that application-created folder inside the owner's existing `EVLine CRM`
   folder using the owner's Drive connector/UI. Keep both private. Reuse the
   existing archive instead of creating another top-level folder. It can be
   renamed for the manager without changing its ID or application marker.
   The nested folder's ID remains the storage target. A folder created through the
   Codex connector alone is not automatically accessible to another OAuth app.
5. Install the helper's four values as production-only Cloudflare Pages secrets:
   `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
   `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`.
   Use a secrets file/stdin, never command-line values, Git, screenshots or chat.
   Keep the local grant file protected until the production connection is verified.
6. Deploy and test a synthetic invoice end to end: upload, preview, download,
   replacement/version history, ZIP, archive/restore and authorized Telegram send.
   Check the file appears only in the private folder and that unauthenticated CRM
   downloads return 401. Trash disposable test files after the test, not real files.

New files use resumable upload and opaque `gdrive:` references in D1. Each version
is a separate immutable original. CRM downloads verify folder membership, private
visibility, size and SHA-256; externally changed files must be added as new versions.
File bytes are proxied through the authenticated CRM, never public Drive links.
Archiving only hides an order link; failed uploads are moved to Drive Trash rather
than permanently deleted. Low quota and revoked access produce safe UI messages.

The app will not silently switch storage when Drive configuration is incomplete.
Legacy `SUPPLIER_DOCUMENTS` R2 bindings remain supported for already-stored files,
but no R2 subscription or bucket is needed for the Drive rollout.

## Verification

- `node --test tests/supplier-documents.test.mjs`
- `node --test tests/supplier-document-storage.test.mjs`
- `node scripts/supplier-drive-connect-smoke.mjs` (loopback only; simulated Google APIs)
- `node scripts/supplier-documents-smoke.mjs` with `PLAYWRIGHT_MODULE` if necessary
- `npx wrangler pages functions build --outfile /tmp/evline-worker.js`

The smoke test uses synthetic data and intercepts all APIs. It creates no live
orders, sends no real Telegram messages, and captures 1440/1024/768/390/320px layouts.
