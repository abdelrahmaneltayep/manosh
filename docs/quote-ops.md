# F25 — Quote Ops & Conversion

The merchant-side "get it to a closed deal" surface. Reuses Shopify draft orders,
F13 (payments), F20 (white-label for the branded PDF). Built one slice at a time
(PR-9a → PR-9e).

## PR-9a — One-click convert: quote → draft order → invoice (§6.2)

From an **accepted** quote (or a **countered** one the buyer has agreed to offline),
the merchant creates a native Shopify **draft order** at the buyer's exact
negotiated prices and emails them the invoice — in one click.

### No second pricing brain, no silent re-price

`convertQuoteToOrder` (`app/services/quote-convert.server.ts`) reuses the S8
draft-order builder (`buildDraftOrderInput` → `createDraftOrder`) and takes each
line's price **verbatim** from `Quote.lines[].price` (`price.toString()`). We never
re-price from the live catalog — Shopify then calculates tax + totals on top
(guardrail #1). A test asserts the draft-order `priceOverride` amounts equal the
quote's stored prices exactly.

### Order of operations (mirrors S8)

1. **Shopify first** — `createDraftOrder` (source of truth for money).
2. **Invoice** — `sendDraftOrderInvoice` (`draftOrderInvoiceSend`), **best-effort**:
   the order stands even if the email hiccups (logged to Sentry). Skippable with
   `sendInvoice: false` for the F13 deposit / pay-by-link / F2 net-terms paths.
3. **Then** mutate state — `COUNTERED → ACCEPTED → ORDERED` (or `ACCEPTED → ORDERED`),
   set `Quote.convertedOrderId` (+ `draftOrderId`), append `QUOTE_CONVERTED`.

So a Shopify failure never strands the quote. `convertedOrderId` mirrors
`Offer.convertedOrderId` (F21) — the F25 convert marker.

### Data (`migration quote_ops`)

`Quote.convertedOrderId` (gid) + Event `QUOTE_CONVERTED`.

### Gating (§6.2 — Starter+)

The admin action (`/app/quotes/:id`, intent `convert`) requires a paid plan
(`featureAccess(status, Starter)`); below that it returns an upgrade prompt. The
buyer must be linked to a company location (native purchasing entity), exactly like
the S8 accept→order path — otherwise convert is blocked with a plain-language error.

### Admin

The quote detail shows **Convert to order & send invoice** on an accepted/countered
quote (not yet ordered); once converted it shows an "Order created" banner. Buyer
not linked to a company location → a clear error, nothing stranded.

## PR-9b — Branded quote PDF: download + resend (§6.1)

A branded PDF of the quote (brand header, line items, unit + line amounts, an
**estimated subtotal**, validity, notes). The merchant can **download** it or
**email** it to the buyer. White-label removes the Mannon footer (Growth, via F20).

### Dependency-free, server-side, off the LCP path

`app/lib/pdf.ts` is a tiny pure PDF writer (Helvetica / Helvetica-Bold, WinAnsi —
**no font embedding, no npm dep, no headless browser**), so the render is fully
server-side and deterministic (unit-tested). The layout (`renderQuotePdfBytes`) is a
pure function; `renderQuotePdf` loads a shop-owned quote and composes it.

- **Estimate, not a computed total.** A quote presents the buyer's *negotiated line
  prices* and their sum as an **estimated subtotal**, with a clear note that tax +
  the final total are calculated by Shopify at checkout — we never compute tax or
  claim a final total (guardrail #1).
- **Branding (F20).** The header uses the merchant's portal name + primary colour
  from `getBrandingTokens` when they've customized branding; otherwise the company
  name + the Mannon indigo. `whiteLabelAllowed(plan)` (Growth) drops the footer.
- **Localized labels.** English / French / Spanish label sets render a second
  locale (`fr-CA` → `fr`); non-Latin1 scripts fall back to English glyphs (Helvetica
  can't draw them without an embedded font — noted for a later embed).

### Surfaces + gating (§6.1 — Starter+)

- **Download** — `GET /app/quotes/:id.pdf` (`Content-Disposition: attachment;
  filename="quote.pdf"` — nothing sensitive in the name), gated Starter+.
- **Resend** — the `pdf-email` action attaches the PDF (`EmailMessage.attachments`)
  and emails the buyer, gated Starter+.
- Both append `QUOTE_PDF_GENERATED` (migration `quote_pdf`). Admin: a **Documents**
  card with Download / Email buttons on the quote detail.

## PR-9c — Duplicate / "Create a similar quote" (§6.4)

Clone an existing quote's **line items + buyer + notes** into a fresh **editable
draft** (status `SUBMITTED`) so a rep can replicate a recurring request.
`duplicateQuote` copies the agreed line prices verbatim, resets the expiry to
`now + shop.quoteExpiryDays`, keeps the rep attribution (F12 `placedByRepId`), and
does **not** carry over any order (`draftOrderId` / `convertedOrderId` stay null).

- **Source (F23.4).** The default branch had no `Quote.source`; this slice adds a
  `QuoteSource` enum (`PORTAL | WIDGET | REP | DUPLICATE | IMPORT`, default `PORTAL`)
  and the column (migration `quote_source`). A duplicate is created with
  `source = DUPLICATE`, feeding source analytics. `IMPORT` is reserved for PR-9d.
- **Gating (Starter+)** — the admin `duplicate` action requires a paid plan, then
  redirects to the new quote's detail. Event `QUOTE_DUPLICATED`.
- **Admin** — a **Create a similar quote** button in the quote detail's Documents
  card.

## PR-9d — Bulk CSV import (§6.3)

Upload a CSV to **add many products to one quote** (`lines` mode) or **create many
quotes at once** (`quotes` mode). A Polaris preview shows every row with per-row
status; the commit is **all-or-nothing**. Growth-gated (row cap per plan).

### Two-step, all-or-nothing

- **Preview** (`previewImport`) parses the CSV (pure `parseCsv`/`parseImport`),
  validates shape (columns, whole-number qty, price, email/group for `quotes`),
  then resolves each row against the **live catalog** (SKU must exist) and, for
  `quotes`, against **existing buyers** (email must match — no fabricated
  companies). Enforces the plan **row cap** (`bulkImportRowCap`, Growth = 200) and,
  for `lines`, an editable target quote.
- **Commit** (`commitImport`) re-previews and **refuses the whole batch** if any
  issue remains (`ImportHasErrorsError`); the writes run in a single
  `$transaction`, so nothing is ever partially saved. New quotes are `source =
  IMPORT`, status `SUBMITTED`. Line prices come from the CSV when given, else the
  catalog reference price. Emits `QUOTE_IMPORTED`.

### CSV columns

- `quotes`: `quote, email, sku, quantity, price` (price optional) — rows group by
  `quote`; one buyer per group.
- `lines`: `sku, quantity, price` (price optional) — added to the chosen quote.

### Admin (`/app/quotes/import`, Growth)

Mode picker, a DropZone (reads the `.csv` text client-side) + editable CSV
textarea, **Preview** → an IndexTable with per-row OK / issue and whole-file error
banners, then **Import** (enabled only when the preview is clean). Reached from a
**Bulk import** action on the Quotes inbox. The catalog loader is injectable, so
the service is unit-tested without Shopify.

## PR-9e — New Customer Account UI extension (§6.5)

Surfaces the buyer's quotes + reorder **natively** inside Shopify's new customer
account (a Customer Account UI extension) — embedded, no external tab —
strengthening the BFS integration story. Read-only; it deep-links to the
magic-link portal for anything that acts (reorder / request a similar quote).

### Testable backend

- **`listQuotesForBuyer(shop, email)`** — read-only quote summaries (status,
  source, item count, estimated total from the agreed line prices, `reorderable`),
  scoped to a buyer email within one shop. Unit-tested (DB), no mutations.
- **`GET /api/account/quotes`** — authenticated via
  `authenticate.public.customerAccount` (proves a logged-in customer of the shop +
  supplies CORS), gated to a paid plan (Starter+). Returns the quotes + the portal
  base URL; the extension passes the buyer email (hardening TODO: cross-check it
  against the token's customer identity).

### Extension scaffold (`extensions/customer-account-quotes/`)

`shopify.extension.toml` (target `customer-account.order-index.block.render`,
`api_access` + `network_access`) + `src/QuotesBlock.tsx` (reads the session token +
authenticated customer, fetches the endpoint, renders a read-only list with
Reorder / Request-similar buttons). It builds with the Shopify CLI, **not** the
app's Vite/tsc pipeline (excluded from the root `tsconfig`), so verification is
manual — see the extension README.

## §6.7 acceptance — status

- ✅ PDF renders branded, downloads + resends; white-label removes the footer on the
  white-label plan (PR-9b).
- ✅ Convert: accepted/countered quote → draft order with **exact negotiated prices**
  → invoice; `convertedOrderId` set (PR-9a).
- ✅ CSV import: valid rows create the quote(s); invalid rows are reported and nothing
  is partially committed (PR-9d).
- ✅ Duplicate produces an editable copy with `source = DUPLICATE` (PR-9c).
- ✅ Customer-account extension lists the buyer's quotes + reorder natively (PR-9e).
- ✅ Events `QUOTE_CONVERTED`, `QUOTE_PDF_GENERATED`, `QUOTE_IMPORTED`,
  `QUOTE_DUPLICATED`. Migrations `quote_ops`, `quote_pdf`, `quote_source`,
  `quote_import`.
