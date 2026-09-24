# Customer Documents in CRM

Entry: a parts order card, **Документи**, next to **Історія**. Existing order
tabs, supplier payment requests, logistics, and notifications are unchanged.
The editor is at `/admin/documents/?order=<order-id>` and returns to that order.
Unsaved changes in the order must be saved first. The supplied agreement is for
auto parts, so this action is intentionally not offered on programming services.

## Workflow

1. Buyer name/contact, car, VIN, saved order items and customer price seed a draft.
   Without item rows, one editable position uses the order title and customer
   price. The manager must split a multi-part request into agreed line items.
2. Review the buyer, specification, prices, agreed payment and delivery terms.
   Supplier costs, commission, profit, internal notes and market estimates are
   never copied into customer documents. No delivery deadlines, tax treatment,
   originality, or actual received payment are guessed.
3. Select **Продавець / ФОП** at the top. **Додати ФОП** creates a separate
   private seller profile. Enter its tax ID, address, IBAN, bank and supplied tax
   status under **Реквізити продавця**; **Зберегти реквізити цього ФОПа** persists
   only that profile behind admin auth in D1. Switching profiles asks for
   confirmation and changes the seller in the current draft, not buyer/items or
   saved versions. Do not place actual requisites in source control.
4. The document selector applies to **preview, PDF, print, copy and send**:
   **Рахунок**, **Договір і специфікація**, **Повний комплект**, or the optional
   payment acknowledgment. Invoice is selected initially. Contract and
   specification stay together; neither requires sending the invoice. Shared
   buyer, seller and line-item edits appear in both documents.
   **Перегляд** displays the selected document, not necessarily the whole pack.
   Standard terms from the supplied 2026-09-23 DOCX are editable
   per document. OEM/analogue lines qualify the originality wording explicitly;
   an all-original specification retains the original wording. Custom edited
   clauses are never overwritten by a type change.
   New drafts include an invoice first in the full PDF pack. Its number/date,
   due date and payment amount can be edited: full total, agreed prepayment,
   verified remaining balance, or another agreed amount. The invoice is not a
   payment acknowledgment. A balance requires explicitly verified customer funds;
   supplier payments are never used. Seller tax status does not imply VAT status.
   Existing saved documents retain their original invoice-free content unless a
   manager explicitly enables the invoice and saves a new version.
5. **Зберегти** saves a draft. **PDF** requires the manager's review and the
   selected document's necessary fields, then stores a prepared snapshot and
   downloads a real PDF with a document-specific filename. An invoice needs
   buyer name, seller requisites, prices, tax treatment and invoice details;
   unfinished contract delivery terms/address do not block it. Conversely, an
   unfinished invoice or optional receipt does not block the agreement. The
   server validates each requested output again before a Telegram send.
   It does not claim the contract is signed. Incomplete documents can be saved
   as a watermarked **PDF чернетки** from preview.
6. Print opens the selected PDF with a print action. Copy copies its plain text
   (or opens a selectable text dialog if clipboard access is unavailable).
   **Надіслати** explicitly names the selected document and offers download,
   native file sharing where supported, and the existing customer Telegram bot
   connection. Telegram requires an explicit recipient check. No public document
   URL is created, and no document is sent automatically.
7. Existing snapshots are never silently replaced by current order data.
   **Оновити з замовлення** shows field-by-field differences; only checked
   changes are applied to the shared draft. Blank source fields do not erase
   manual values. Matching item metadata is retained. Seller and contract text
   are not imported. **До замовлення** saves pending draft edits before returning;
   a failed save keeps the manager on the page with their edits. Document edits
   do not silently overwrite order/contact records or trigger financial events.

## Payment And Legal Boundaries

- The agreed prepayment is a contractual term, not proof of funds received.
- Payment acknowledgment is off by default, even on orders marked paid. It
  requires amount, date, payment method, reference and explicit confirmation
  that the CUSTOMER's incoming payment was checked. Supplier receipts are never
  used for this purpose. It is explicitly not a fiscal receipt.
- The supplied delay provisions, no additional contractual delay fines, and
  mandatory statutory rights remain in the agreement. War alone is not represented
  as automatic cancellation of obligations. Qualified Ukrainian legal/accounting
  review is recommended before using the template for signed transactions.
- Official fiscal-receipt reference:
  https://od.tax.gov.ua/media-ark/news-ark/705812.html

## Persistence And Access

Additive migration: `0027_order_documents.sql`. The module also creates these
tables idempotently with individual prepared statements on first authorized use,
so publication does not depend on a manual dashboard migration step.

`order_documents` stores immutable snapshots with monotonically increasing
per-order versions, status, actor and timestamp. Atomic expected-version checks
reject stale saves. Request IDs make uncertain save retries idempotent. At most
100 recent versions are listed; older rows are not overwritten or deleted.

`document_seller_settings` stores private seller profiles with revision checks.
Legacy single-seller JSON is read as the `primary` profile without rewriting it.
The first profile remains the default; managers choose the required seller per
order. Old clients cannot overwrite multiple profiles through the legacy request.
No new D1 migration is required for seller profiles/invoices; their versioned
JSON stays inside the existing document/settings tables.
`document_deliveries` records each version/output's Telegram send attempt. Invoice
and agreement can be sent independently from the same snapshot. Existing legacy
delivery IDs retain whole-pack semantics; other outputs use `snapshot-id:mode`.
No migration is needed for separate outputs. A confirmed
success is never resent; ambiguous network outcomes are not blindly retried.
Definitively rejected Telegram requests can be manually retried. Recipient must
still match the order's connected positive/private chat ID at send time.

All endpoints use the existing `/api/admin` authorization and no-store response
policy, with same-origin mutation checks. Customer records, statuses, prices,
conversion events and supplier payments are not changed by document operations.
Deleting an order cascades its document snapshots and delivery records; the
existing destructive-action confirmation now explicitly mentions documents.

PDF rendering and bundled Cyrillic fonts run locally in the manager's browser.
The PDF runtime is loaded only on demand; no external CDN or PDF service receives
customer data. Original DOCX and real client fixtures are not published.

## Editor Density

The editor uses a productive enterprise-UI scale, adapted to EVLine rather than
loading another component framework:

- Arial/Helvetica retained for site consistency; 14px/20px controls, 12px/16px
  labels, 16px section headings and a 20px page title. Letter spacing stays zero.
- The title, order number and customer contact share a desktop line and wrap on
  narrow screens. Long names cannot overlap the status. Empty seller summaries
  consume no space.
- Spacing steps are 4/8/12/16/24px; related fields use 8px row and 12px column
  gaps. Desktop input/button heights are 32px. Mobile controls are 44px, with
  16px input text; touch targets are not shrunk to achieve density.
- Main editor sections retain 12px padding and dividers; their heading-to-fields
  spacing is 4px. No document fields or actions are removed for density.
- Flat, full-width backgrounds distinguish seller (gray), buyer (white),
  specification (pale blue) and invoice/payment (pale green). Additional sections
  stay neutral. White inputs and visible headings remain consistent; colors are
  not payment-status indicators. No shadows, nested cards or extra vertical gaps
  are introduced. Mobile horizontal insets are 8px.
- Secondary buyer details, contract metadata, condition, payment and delivery
  sections use native keyboard-operable disclosures. Expanded state survives
  saves and item edits. Failed preparation reveals incomplete sections; selecting
  prepayment/balance opens its payment fields.
- Actions remain visible in a sticky desktop toolbar and a fixed mobile footer
  naming the chosen output. Sidebar offset follows the measured toolbar height;
  mobile content reserves footer space, including device safe-area inset.
- Printed PDFs, their font, page margins and document contents are unchanged.

References: [Salesforce spacing and sizing](https://www.lightningdesignsystem.com/2e1ef8501/p/03d6b0),
[Carbon productive typography](https://carbondesignsystem.com/elements/typography/type-sets/),
[Carbon text input sizes](https://carbondesignsystem.com/components/text-input/usage/),
[Carbon long-form grouping and progressive disclosure](https://carbondesignsystem.com/patterns/forms-pattern/).

## Verification

`node --test tests/order-documents.test.mjs`

`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/order-documents-smoke.mjs`

The smoke script uses a disposable SQLite database and an isolated local server,
tests 1440/1024/768/390/320px, saves real PDFs and a long specification to `/tmp`.
It never creates live orders or sends client messages. Also run the existing
admin usability smoke test, full test suite, form audit and link audit.
