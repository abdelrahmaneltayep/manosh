# F24 — Storefront Quote Capture Suite

The buyer-side capture surface competitors lead their listings with. Extends the
F17 Request-a-Quote widget (theme app extension only — **no Asset API**) and reuses
F3 price lists / F5 companies. Dark-launched behind `MANNON_FF_QUOTE_CAPTURE`.

Built one slice at a time (PR-8a → PR-8e). This doc grows with each slice.

## PR-8a — Custom quote form builder (§5.1, core)

A merchant builds an ordered set of fields buyers fill in when requesting a quote;
the theme app extension renders the active form for its surface. **Basic builder is
on every plan; advanced controls (conditional logic, multiple forms) are Growth**
(`quoteFormFeatures`, `app/lib/billing.ts`) — enforced in the service *and* shown
disabled + upgrade-labeled in the UI.

### Data (`migration quote-capture`)

- **`QuoteForm { id, shopId, name, surface, fields Json, active }`** — `surface` ∈
  `PRODUCT | COLLECTION | CART | PAGE`; `fields` is the ordered field schema. FK'd
  to `Shop` (cascade).
- **`formId`** added to **`QuoteRequest`** (set at submission) and **`Quote`**
  (carried on conversion), both `onDelete: SetNull`.
- Event **`QUOTE_FORM_UPDATED`**; `QUOTE_REQUEST_CREATED` payload carries `formId`.

### Field schema (`app/lib/quote-form.ts`, pure + tested)

Field types: text, number, email, phone, dropdown, checkbox, file, date, product.
`normalizeFields` validates/cleans (drops unknown types, coerces flags, **dedupes
keys**, parses dropdown options); `moveField` reorders; `missingRequired` validates
a buyer's answers. All pure — shared by the admin builder, the service, and tests.

### Admin (`/app/quote-forms`)

- **List + create** (`_index`) — IndexTable of forms (name, surface, field count,
  active), designed empty state, and a create form. Below Growth, "Create" locks
  once one form exists (single-form cap), with a Growth upsell.
- **Builder** (`$id`) — add fields (by type), edit label / required / placeholder /
  help / dropdown options, reorder (↑/↓), remove, toggle active, choose surface.
  A **Conditional logic** card is present but disabled + "Growth"-badged below
  Growth (wired in PR-8b).

### Storefront (theme app extension)

The F17 widget now also fetches `GET /api/quote-form?shop=&surface=` (async, CORS,
`max-age=60`) and, when an active form exists for the surface, renders **its**
fields instead of the built-in ones — mapping each type to the right control
(select for dropdown, checkbox, file, date, …). Submissions post `formId` +
the field answers (`customFields`); the answers are stored regardless of the legacy
widget custom-fields gate (the merchant configured the form). No form configured →
the widget falls back to its built-in fields unchanged. Fully async — no LCP impact.

### Flow

storefront form → `POST /api/quote-request` (carries `formId` + answers) →
`QuoteRequest` (with `formId`) → merchant one-click convert → `Quote` (with
`formId`). So **`quote.created` carries `formId`** end to end.

### Not yet (later slices)

Conditional logic + multiple named forms (PR-8b), price/ATC gating (PR-8c),
Add-to-Quote drawer + cart→quote (PR-8d), post-submission control + multi-language
(PR-8e).
