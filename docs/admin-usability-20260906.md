# Admin usability revision

Base: `a95547f` (production main checked on 2026-09-06).

## Changes

- Five primary order tabs. History is a separate secondary action.
- Compact identity/request header; technical IDs and repeat/delete actions are collapsed.
- Next action and manager notes are in the order tab. Customer notification controls are next to status, with recipient/connectivity information.
- Dirty-state save bar, close/reload protection for order fields, preservation of edits during data refresh, inline save failures, and protection against double submission/editing during save.
- Supplier payment facts and remaining principal precede collapsed creation/correction forms. Fees remain separate. Receipt links point into the existing private Telegram group.
- Customer payment state is explicitly separate from supplier payment state. Incomplete finance inputs do not imply a trustworthy margin.
- Shared market comparison rules for the API and UI. Wrong side, front/rear, lamp subtype and explicit technology conflicts are rejected. Catalogue context alone cannot confirm an OEM.
- Only exact article matches contribute to statistics. Different condition/type, availability and lamp traits have separate groups. Similar products remain accessible but are not averaged.
- Filters, counts, on-screen prices and copied prices use the same selection. Cached results are reclassified on read.
- First five exact offers are visible; further/similar offers and methodology are expandable. The sea freight estimate retains its route and exclusions.
- Visible order search, server-side new/unquoted/overdue filters and possible duplicate links (same phone/VIN/request within 24 hours of the loaded list).
- One supplier request form with photo upload and automatic order linking. Standalone linking uses order search rather than an internal UUID.
- Contact-click analytics is under analytics; delivery tariffs are in the header menu and editing opens intentionally.
- Explicit `codex_qa` sources are excluded from CRM summary aggregates, without deleting records. Google Ads reports remain separate. Campaign names are resolved from available keyword data.
- Delivery calculator/table precede collapsed source documentation. Responsive typography, tabs, buttons, empty mobile fields and hidden-drawer shadows corrected.

## Verification

- `node --test tests/*.test.mjs`: 90 passing tests.
- `node scripts/audit-public-forms.mjs`: 147 forms, static wiring audit passed.
- `node scripts/audit-internal-links.mjs`: 4568 references passed.
- `wrangler pages functions build functions`: compiled successfully, including the shared comparison module.
- `scripts/admin-usability-smoke.mjs`: Playwright regression at 1440, 1024, 768 and 390 px. All API calls are intercepted locally. Covers filtering/copying, failed and successful saves, unsaved order guard, payment facts, photo request submission/linking, navigation, tariff editor and calculator layout.

Run the browser test with Playwright installed, or set `PLAYWRIGHT_MODULE` to its `index.mjs`. It launches installed Chrome by default; `SMOKE_BROWSER` can select another installed Playwright channel. Screenshots go to `/tmp/evline-admin-ux-smoke` unless `SMOKE_OUTPUT` is set.

## Rollout and limits

No D1 migration, token/permission change, payment correction, real order creation or Telegram send is required by this revision. Backend request fields and accounting are retained.

Publication was not performed during preparation: the GitHub connector and CLI have read-only repository access, while the browser with write access requires the Mac to be unlocked. The available Cloudflare CLI account is not the production Pages account. Recheck remote main before publishing; preserve any newer changes.

The personal work filter is intentionally deferred: existing orders have a direction-level Telegram contact, not a named employee assignment. It must use a real persisted assignee, not infer one from the shared contact. Duplicate hints are advisory, not automatic merges. No claim is made that unused functions can be removed without manager feedback.
