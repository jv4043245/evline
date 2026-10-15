# Isolated reminder-setup help through Slavik

Owner approved this mode on 15 October 2026. It is optional help for the existing
`andrii` CRM identity, not a replacement for the reminder bot or new CRM access.

## Manager flow

In any order: **Оплата → Документи постачальника → Мій Telegram → Допомога Славика**.
Create the help link, open `@slavik_office_bot`, press Start, return and explicitly
confirm the displayed Telegram identity. The main reminder connection above is
separate and continues to use the bot returned by that connection's own link.

The help link expires after ten minutes. The confirmed help session lasts at most
48 hours and can be closed in the CRM or by `/stop` in Slavik. The manager may send
short text about setup, `/help`, or `/status` (`Проверить подключение`). No customer
screenshots, invoices, documents or forwarded messages belong in this session.

## Boundaries

- `GET/POST /api/admin/slavik-support` requires the existing authenticated `andrii`
  user. Other admin identities receive 403; there is no owner impersonation.
- A new dedicated `EVLINE_SUPPORT_CRM_SECRET` connects to one fixed Worker origin.
  It is never sent to the browser. A separate operator credential is held only by
  the narrow support operator, not by the website or manager.
- `/api/internal/slavik-support-status` accepts only the dedicated shared secret
  and returns four fields for Andrii: `connected`, `pairing_state`,
  `control_message_sent`, `cron_ready`. It exposes no orders, money, customer
  details, private Telegram IDs or pairing links.
- Successful control-message sends record a timestamp and a digest of the current
  binding in the existing `supplier_document_runtime` table. It means Telegram
  accepted the message, not that the manager read it. A failed receipt write does
  not undo a successful send or binding. Reconnection invalidates the old receipt.
- The Worker has a separate temporary text inbox/outbox, no office search/AI or
  corporate history, no changes to group allowlists or existing bot tokens, and
  no arbitrary-recipient API. Text is removed after seven days. Uncertain sends
  are never automatically repeated.
- Main reminder schedules, documents, orders, payments and advertising settings
  are unchanged. Finishing support does not disable the real reminders.

## Verification and recovery

Tests use synthetic identities and isolated databases. The cross-contract test
in the Slavik checkout exercises the real CRM proxy, Worker routes, authenticated
webhook Start, explicit confirmation, and the control-message receipt. It does
not use live Telegram credentials or create production orders.

Cloudflare Pages needs the new shared secret before the control appears for
Andrii. The Worker needs its isolated support migration and code before use.
Deploy only reviewed commits and retain unrelated concurrent site changes.
Disabling the Worker help flag stops support without changing group functions;
closing the current support session stops processing that private help chat.
Never reset the webhook, fetch the existing bot token, or inject fake Telegram
updates into the production database to initiate a conversation.
