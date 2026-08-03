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

## PR-8b — Advanced builder (§5.1, Growth)

Conditional logic, per-form success message, and multiple named forms per surface.
All **Growth** (`quoteFormFeatures.conditionalLogic` / `.multipleForms`), enforced
in the service *and* shown disabled + upgrade-labeled in the UI.

### Conditional logic (`showIf`, in the `fields` JSON — no new column)

Each field may carry `showIf: { field, equals }` — show it only when an **earlier**
field's answer equals a value. `normalizeFields` validates the reference (earlier
key only; self/unknown/cycle refs are dropped), and `isFieldVisible` / `visibleFields`
evaluate it. `missingRequired` **skips hidden required fields** (a field you can't
see can't block submit). All pure + tested (`quote-form.test.ts`).

- **Admin:** a per-field "Show only if" (earlier field) + "equals" control appears
  on Growth. The **After submit** card holds the thank-you message (Growth), disabled
  + labeled below Growth.
- **Storefront:** conditional fields render hidden and their control is **disabled**
  so they never submit or block; the widget re-evaluates visibility on every answer
  change. The form's `successMessage` replaces the default thank-you text.
- **Server gate:** `saveForm` runs `stripAdvanced` and nulls `successMessage` below
  Growth, so a lower plan can't sneak advanced config in via the API.

### Per-form success message (`QuoteForm.successMessage`)

Migration `quote_capture_advanced` adds the nullable column. (The general
message-or-redirect control is §5.4 / PR-8e.)

### Multiple named forms per surface

Already unlocked on Growth by the PR-8a single-form cap; `getPublicForm` picks the
active form for a surface (most-recently-updated). Bind different forms to
product / collection / cart / standalone-page surfaces.

## PR-8c — Hide price / Add-to-Cart → "Request a Quote" (§5.2)

Hide the price and/or Add-to-Cart button and swap in a Request-a-Quote CTA, scoped
by audience or catalog. **Broad scopes (everyone / logged-out) are Starter;
targeted scopes (customer tag / product / collection) are Growth**
(`priceRuleScopeAllowed`) — enforced in the service *and* the UI (the Growth scopes
are disabled + labeled in the scope picker).

### THE INVARIANT — a hidden price never leaves the server (§5.2)

The pure evaluator (`app/lib/price-visibility.ts`) returns a `VisibilityDecision`
of **only** `{ hidePrice, hideAtc, ctaLabel }` — there is no price field, by type.
`GET /api/price-visibility` returns exactly that decision, so a hidden price is
never in our markup or JSON. A unit test asserts the decision keys contain no
`price`/`amount`. The storefront block renders **no price of its own** — it only
hides the theme's price/ATC elements and shows the CTA.

### Data (`migration price-visibility`)

`PriceVisibilityRule { id, shop, scope (ALL|LOGGED_OUT|CUSTOMER_TAG|PRODUCT|
COLLECTION), scopeRef?, hidePrice, hideAtc, ctaLabel, active, priority }`, FK'd to
`Shop` (cascade). Highest-priority match wins, ties broken by specificity
(product > collection > tag > logged-out > all). Event `PRICE_RULE_UPDATED`.

### Admin (`/app/price-rules`)

List + create + delete. The scope picker disables the Growth-only scopes below
Growth; targeted scopes require a reference (tag / product GID / collection GID).

### Storefront (theme app block `price_gate`)

An app block the merchant places on the product template. It reads the visitor
context from Liquid (logged-in, customer tags, product + collection GIDs), calls
`/api/price-visibility` (async), and — when told to hide — hides the theme's
price/ATC elements (configurable CSS selectors) and reveals the CTA (which opens
the on-page quote widget if present, else navigates to the configured quote page).
Fails open (theme untouched) on any error. No LCP impact, no price ever emitted.

## PR-8d — Add-to-Quote drawer + Convert-Cart-to-Quote (§5.3)

Buyers collect multiple products into a **quote drawer** (across product/collection
pages) and submit **one multi-line quote**; on the cart page, one click turns the
cart into a quote. **Starter+** (`quoteCaptureAllowed`).

### Backend — one path, two channels (no second widget)

Both surfaces reuse the F17 `QuoteRequest` path. `createQuoteRequest` now takes a
`channel`:
- `WIDGET` (F17) — gated by the widget flag + the merchant's enable toggle.
- `CAPTURE` (F24.3) — gated by `MANNON_FF_QUOTE_CAPTURE` + a paid plan.

Same anti-spam (rate limit + honeypot + too-fast), same validation, same emails.
`GET /api/quote-capture-config?shop=` returns `{ enabled }` (flag + paid plan) for
the blocks. Submissions post to the existing `/api/quote-request` with
`channel: "CAPTURE"` and a `lines[]` array (multi-line already supported).

### Storefront (theme app blocks, async)

- **`add_to_quote`** — an "Add to Quote" button (product context from Liquid).
  Clicking adds the product to a drawer persisted in `localStorage` (keyed per
  shop), shown via a floating **"Quote (n)"** launcher. The drawer lists items with
  quantity steppers + remove, an email + note, a honeypot, and submits one
  multi-line request. Duplicate variants merge.
- **`cart_to_quote`** — a cart-page button; reads `/cart.js`, drops the cart's
  items into the same drawer for the buyer's email, and submits (source `CART`).

Both fail closed (no button, no impact) if the feature is off or the read fails.

## PR-8e — Post-submission control + multi-language (§5.4, §5.5)

Generalises PR-8b's success message and localizes the buyer surfaces. Migration
`quote_capture_i18n` replaces `successMessage` with **`successMode`
(MESSAGE|REDIRECT) + `successValue`** and adds **`translations`** (JSON).

### Post-submission control (§5.4, Starter+)

After submit, show a configurable thank-you **message** or **redirect** to a
merchant URL — `successMode` + `successValue` on `QuoteForm`, available on any paid
plan (`quoteCaptureAllowed`, enforced in `saveForm` + the admin "After submit"
card). The widget shows the message, or navigates to the URL on success.

### Multi-language (§5.5, Growth)

`translations` holds per-locale overrides — `{ "<locale>": { fields: { key:
{ label?, placeholder?, help? } }, successValue? } }`. Pure helpers
(`normalizeTranslations`, `resolveLocale`, `localizeForm`) apply the storefront
locale with base-language fallback (`fr-CA` → `fr` → default). `getPublicForm`
takes a `locale`; the widget passes `<html lang>` (or `Shopify.locale`) to
`/api/quote-form`. The admin exposes a Growth-only Translations editor (per-locale
field labels + thank-you message). Stripped server-side below Growth.

- **Form** — localized via `getPublicForm(locale)` + the widget. ✓
- **Quote PDF / buyer emails** — localize off the same `translations` store when
  the PDF lands in **PR-9b (§6.1)**, so the second-locale surfaces share one source.

## §5.6 acceptance — status

- ✅ Form builder + one conditional rule; renders on the chosen surface; the request
  carries `formId` (PR-8a/8b).
- ✅ Price + ATC hidden for the targeted scope; Request-a-Quote shown; **hidden price
  never in page source** — the decision carries no price (PR-8c).
- ✅ Add-to-Quote across pages → one multi-line quote; cart→quote (PR-8d).
- ✅ Post-submission redirect/message honored; **form localized** in a second locale
  (PR-8e). PDF/email localization ride the same `translations` store as those
  surfaces land (PDF = PR-9b).
- ✅ Events `QUOTE_FORM_UPDATED`, `PRICE_RULE_UPDATED`; `quote.created` carries
  `formId`. Migrations `quote-capture`, `quote_capture_advanced`,
  `price-visibility`, `quote_capture_i18n`.
