# Personal admin tokens

All users currently have the same `admin` permissions on `/api/admin/*`.

- The existing `ADMIN_TOKEN` remains unchanged and belongs to `andrii` (Андрій).
- `ADMIN_USERS_JSON` is a Cloudflare Pages **secret** containing an array of `{id, name, token}` entries for additional users.
- The initial additional users are `igor` (Ігор) and `owner` (Власник).
- Use unique tokens generated with at least 32 cryptographically random bytes. Never commit production tokens or put them in Pages assets, URLs, `wrangler.toml`, logs, or screenshots.
- Configure the secret in the production EVLine Pages project and redeploy to apply it. Preview environments only receive tokens when explicitly configured separately.

`GET /api/admin/session` returns the authenticated user's id, name and role, without credentials. `POST` to that endpoint records a sign-in in the audit log. Requests accept either a Bearer token or `x-admin-token`; conflicting tokens are rejected.

The admin header shows the current user's name. The additional-actions menu contains `Змінити користувача`, which removes the token from that browser and reloads the admin login form. A replacement token is saved only after successful server validation.

Audit actors come from the verified token, never from caller-supplied actor/email headers or order payloads. Existing historical `admin`/`manager` events retain their original values because shared-token actions cannot be reliably attributed retrospectively. Automatic Telegram and tracking events retain their system actors.

To revoke or rotate one personal token, change that entry in the production secret and redeploy; other users remain unaffected. The old shared token must only be used by Andrii once the personal tokens are distributed.

Validation: `node --test tests/admin-auth.test.mjs` covers all users, both auth headers, unauthorized requests, impersonation, malformed configuration, ambiguous credentials, rotation, and real SQLite audit persistence.
