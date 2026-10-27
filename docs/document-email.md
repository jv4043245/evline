# Customer document email

The document delivery dialog sends the selected saved PDF directly from the configured Gmail account. It works for order documents and standalone invoices. Issuing a document never sends it automatically. The manager checks the recipient address and explicitly presses Send PDF.

## Connection

Use a **separate** Google OAuth Desktop client in the existing EVLine project. Enable Gmail API. Do not change the supplier Drive client or its grant.

The owner must approve persistent access and select the sender account. Required scopes are only `openid`, `userinfo.email` and `gmail.send`. There is no permission to read or delete mail. The OAuth app must be In production: Google expires refresh tokens for external Testing apps after seven days for these scopes. A personal/internal-use unverified application can require an owner-operated consent step; do not bypass browser security warnings.

Download the client JSON to a private, ignored local directory. Run:

```sh
node scripts/connect-document-mail.mjs /absolute/private/path/client.json sender@gmail.com
```

The loopback helper uses state, PKCE, verified sender identity and exclusive mode-0600 output at `.local-data/document-mail-secrets.json`. Never print credentials or commit them. Install the four resulting values as production Cloudflare Pages secrets: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`. Redeploy after changing secrets. Do not put production credentials in preview environments. No paid service or billing activation is needed.

## Delivery semantics

- Both endpoints are under the existing authenticated `/api/admin` middleware and enforce same-origin requests.
- Only saved ready documents are accepted, scoped to the order or standalone workspace. The browser-generated PDF uses the existing template and size limits.
- Sender, subject, attachment name and message text are constructed server-side. The form accepts one validated recipient, not arbitrary headers, HTML, CC or BCC.
- Gmail identity is verified before every send. Wrong-account and expired grants fail without sending.
- An atomic durable claim prevents duplicate/concurrent sends of the same version, mode and recipient, including after a browser reload. Different document versions and separately confirmed addresses have independent records.
- A confirmed Gmail rejection can be retried. Timeouts and ambiguous provider results stay blocked; check Gmail's Sent folder manually. This integration does not request mail-read permissions to inspect that folder.
- `sent` means Gmail accepted the message, not that the recipient read it or that the receiving server cannot later bounce it.
- Migration `0047_document_email.sql` and the runtime schema create delivery history with cascading foreign keys. Audit events record actor, document, revision, mode and recipient. Secrets and provider responses are never exposed to the browser.

Test with synthetic data locally using `node scripts/invoices-preview.mjs`. The preview blocks all real external calls. A live smoke test must use the owner's approved recipient and fictional invoice data, without allocating a production invoice number.
