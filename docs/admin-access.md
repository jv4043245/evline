# Personal admin tokens

All users currently have the same `admin` permissions on `/api/admin/*`.

- The existing `ADMIN_TOKEN` remains unchanged and belongs to `andrii` (Андрій).
- `ADMIN_USERS_JSON` is a Cloudflare Pages **secret** containing an array of `{id, name, token}` entries for additional users.
- `ADMIN_OWNER_TOKEN` is an optional production-only secret for owner recovery. When
  non-empty, it replaces all legacy `owner` entries in `ADMIN_USERS_JSON`; their
  tokens no longer authenticate. Andrii and other additional users are unchanged.
- The initial additional users are `igor` (Ігор) and `owner` (Власник).
- Use unique tokens generated with at least 32 cryptographically random bytes. Never commit production tokens or put them in Pages assets, URLs, `wrangler.toml`, logs, or screenshots.
- Configure the secret in the production EVLine Pages project and redeploy to apply it. Preview environments only receive tokens when explicitly configured separately.

`GET /api/admin/session` returns the authenticated user's id, name and role, without credentials. `POST` to that endpoint records a sign-in in the audit log. Requests accept either a Bearer token or `x-admin-token`; conflicting tokens are rejected.

The admin header shows the current user's name. The additional-actions menu contains `Змінити користувача`, which removes the token from that browser and reloads the admin login form. A replacement token is saved only after successful server validation.

Audit actors come from the verified token, never from caller-supplied actor/email headers or order payloads. Existing historical `admin`/`manager` events retain their original values because shared-token actions cannot be reliably attributed retrospectively. Automatic Telegram and tracking events retain their system actors.

To revoke or rotate one personal token, change that entry in the production secret and redeploy; other users remain unaffected. The old shared token must only be used by Andrii once the personal tokens are distributed.

Owner recovery without access to the encrypted additional-users configuration:
with explicit owner authorization, generate 32 random bytes into private ignored
files using `scripts/prepare-owner-recovery.mjs`, upload only `ADMIN_OWNER_TOKEN`
with Pages secret bulk to production, and deploy code supporting this override.
Verify `GET /api/admin/session` returns owner via the new token, without printing
the token. Deliver the private 0600 text file to the owner locally, never in chat,
URLs, screenshots, or committed assets. Existing browser sessions using the old
owner token must sign in again. Do not delete the override or roll back to code
that ignores it: doing so could reactivate the legacy owner token. Future recovery
rotates the separate secret, never the entire additional-users array.

Validation: `node --test tests/admin-auth.test.mjs` covers all users, both auth headers, unauthorized requests, impersonation, malformed configuration, ambiguous credentials, rotation, and real SQLite audit persistence.
