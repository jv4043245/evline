# Private original bank statements

This archive stores the three original CSV/XLSX statements byte for byte in D1.
It is separate from the reviewed expense ledger, advertising reports, profit,
and reimbursement calculations. Original files are never public static assets.
There is no browser upload, delete, overwrite, password setup, or password reset
endpoint.

## Access configuration

Production owner identity, verified from the existing administration audit, is
`owner` (the “Власник” account). Existing `andrii`, `igor`, and other administrator
identities do not receive originals, even if they know the separate password.

Set these secrets on the Pages project, then redeploy:

* `BANK_SOURCE_OWNER_ID`: `owner`.
* `BANK_SOURCE_PASSWORD_HASH`: `pbkdf2-sha256$100000$SALT$HASH`, where SALT is
  exactly 16 random bytes and HASH is the 32-byte PBKDF2-HMAC-SHA256 result, both
  unpadded base64url. Never configure or store the clear password in application
  environment variables.

Generate a fresh independent 32-byte random password and its configuration:

```sh
node scripts/prepare-accounting-bank-source-password.mjs --owner owner --output /private/tmp/bank-source-access.json
```

The file is created exclusively with mode `0600`, outside the site repository.
Read it only through an appropriate local/private channel. Copy the two named
configuration values into Pages secrets; deliver the `password` separately to
the owner. The password, hash, salt, real file contents, and import SQL must not
be committed or placed beneath the public build directory. Configuration is
validated strictly; missing or invalid secrets fail closed. Rotating either
secret invalidates every signed session.

## Import

Apply additive migration `0037_accounting_bank_sources.sql`. It touches only the
new archive, chunk, rate-limit, and access-session tables. Build a private JSON
manifest with exact keys `owner_id` and `files`; `owner_id` is `owner`, and `files`
contains exactly three objects with `path`, `date_from`, `date_to`, and optionally
the expected original `sha256`. Paths refer to the actual source CSV/XLSX files
outside this repository. Dates describe each complete source statement, not the
trip interval or a filter applied to the reviewed ledger.

```sh
node scripts/import-accounting-bank-sources.mjs --manifest /private/tmp/bank-source-manifest.json --output /private/tmp/bank-source-originals.sql
```

Execute the resulting file privately with `wrangler d1 execute DB --remote
--file=/private/tmp/bank-source-originals.sql`. The SQL has no explicit
`BEGIN`/`COMMIT`, as required by D1 file import. It uses chunks of 64KiB so encoded
statements stay below D1's 100KB SQL statement limit. Each file is limited to
8MiB. IDs are the original SHA256 values. Exact retries do nothing; changed bytes
under an existing filename or conflicting source metadata abort rather than
overwriting a statement. Immutable triggers protect both metadata and bytes.

## API

All requests use normal administration authorization. Additional bank sessions
never authorize access to other administration endpoints.

* `GET /api/admin/accounting/bank-sources`: another administrator receives
  `{allowed:false,locked:true,files:[],expires_at:null}`. The owner receives the
  same locked shape with `allowed:true` until separately unlocked. No filenames,
  hashes, periods, sizes, or source bytes are disclosed while locked.
* `POST .../bank-sources/unlock`, JSON `{password: "..."}`: checks the owner,
  same-origin request policy, strict JSON, a 1024-byte streamed body limit, and
  an atomic D1 owner-wide limit of five attempts per 15-minute window before
  PBKDF2. Successful response has `allowed:true`, `locked:false`, `files`,
  `expires_at`, and `session_token`. Wrong passwords return 403; exhausted
  attempts return 429 with `Retry-After`.
* Send the returned token only in `x-bank-source-session` alongside normal
  administration authorization. Keep it in JavaScript memory, never URLs,
  localStorage, sessionStorage, or persisted downloads. Its signed scope, owner,
  admin credential binding, 15-minute expiry, and hashed D1 session record are
  verified on every list/download. The password is never retained by the UI.
* `GET .../bank-sources/{id}/download`: requires both gates and returns an
  attachment only after chunk bounds, length, and full-file SHA256 verification.
  Locked or expired sessions return 423. Responses are private/no-store and
  `nosniff`, with sandboxed attachment disposition and the original filename.
* `POST .../bank-sources/lock`, JSON `{}`: revokes the current D1 session and
  returns the owner's locked shape. The UI also drops its in-memory token.

Mutation requests require JSON; cross-origin `Origin` and `Sec-Fetch-Site`
values are rejected. Custom authorization/session headers prevent plain links
and cross-origin forms from accessing files. There are no query parameters or
URL tokens. Responses are `no-store`; errors do not expose internal database or
password configuration details.

## Rollout verification

Run `node --test tests/accounting-bank-sources.test.mjs` and the frontend source
archive tests. Import all three originals in a clean local database, repeat the
import, and compare downloaded bytes and SHA256 values with the source files.
Confirm locked owner and other-admin responses disclose no source metadata;
unlock, expiry, explicit lock, changed owner credentials, changed password
configuration, body bounds, rate limits, and corrupt chunks must all block
downloads. After deployment verify the owner through the real admin session and
check ordinary public/unauthenticated URLs return no bytes. Do not change or
re-import the reviewed bank-expense ledger during this rollout.
