# Self-review gauntlet (S19)

Pre-submission audit of the whole codebase against the **7 guardrails** and the
**definition of done** in CLAUDE.md. Run before the App Store submission (S20).

**Result: PASS.** No guardrail violations found; no code fixes were required. A
static `app/guardrails.test.ts` was added to lock the cross-cutting invariants
against regression.

Green-gate at time of review: **208 tests passing**, `tsc --noEmit` clean,
`remix vite:build` clean (the only build warning originates in Polaris's own
bundled CSS, not our code).

---

## Guardrails

### 1. Never compute B2B tax, discounts, or totals — PASS

- `draft-order.server.ts` only *reads* Shopify's `subtotalPriceSet` /
  `totalTaxSet` / `totalPriceSet` strings from `draftOrderCalculate` /
  `draftOrderCreate`. It never sums or derives them.
- Totals are stored verbatim as a `Json` snapshot (`Quote.totalsSnapshot`); unit
  prices are `Decimal(18,4)`, never floats.
- The F5 dashboard sums order totals for display using exact BigInt decimal
  addition (`addDecimal`), not floating point — and only aggregates numbers
  Shopify already produced.
- **Nuance (intentional):** `reorder.server.ts#relativeDelta` uses `Number()` to
  compute a *price-change ratio* for the auto-approve tolerance gate. This is a
  dimensionless comparison to decide whether a reorder needs approval — it is
  never stored or displayed as money, so it does not touch the money guardrail.

### 2. Minimum OAuth scopes, each documented — PASS

- Requested scopes: `read_products, read_orders, write_draft_orders,
  read_companies, read_payment_terms`.
- `app/lib/scopes.test.ts` asserts `shopify.app.toml` matches the declared set.
- `docs/compliance.md` documents every scope with its reason and consuming slice.
  No undocumented or unused scope. `write_draft_orders` intentionally covers read
  (no separate `read_draft_orders`).

### 3. HMAC-verify every webhook, 401 before handler logic — PASS

- All five webhook routes (`app/uninstalled`, `app/scopes_update`,
  `customers/data_request`, `customers/redact`, `shop/redact`) call
  `verifyWebhook` first and return `401` on failure.
- Behaviour covered by `app/routes/webhooks.test.ts` (signed + unsigned);
  presence now statically enforced by `app/guardrails.test.ts`.

### 4. AI never acts autonomously — PASS

- `ai/order-parser.server.ts`: `temperature: 0`, forced `tool_choice`, catalog
  sent as a cached system prefix.
- `validateParsedOrder` (pure, exhaustively tested) drops any `variant_id` not in
  the live catalog into `unmatched` — a hallucinated id can never become a cart
  line.
- The parse only produces a *proposal*; the cart/quote is built solely on the
  buyer's explicit confirm in `portal.quick-order.tsx`.

### 5. Polaris components only — PASS

- Every embedded admin route (`app.*.tsx`) is built from Polaris. The only raw
  elements are a keyed wrapper around a hidden form input and a layout `<div>`
  inside a Banner — layout glue, not custom UI replacing a Polaris pattern.
- The buyer portal is intentionally light server-rendered HTML — a **documented
  exception**: it's non-embedded and must load fast and stand alone outside
  Admin (CLAUDE.md tech-stack note).

### 6. Events are append-only — PASS

- `events.server.ts` exposes only `appendEvent` (an insert). `events.server.test.ts`
  statically asserts no `.event.update/delete/upsert/*Many` exists anywhere in
  `app/`, and that the module exports no mutation other than the insert.

### 7. Store secrets hashed, never raw — PASS

- `magic-link.server.ts` stores only `magicTokenHash` (sha256); the raw token
  exists only in transit. Verification is timing-safe and single-use (atomic
  conditional `updateMany`).

---

## Definition of done (across slices)

- **Tests green** — 208 passing; pure logic + DB (real Postgres) + webhook
  signature + mocked Admin/AI paths. ✔
- **Empty & error states** — every list/table has a designed empty state
  (Polaris `EmptyState`); the buyer portal and root have friendly
  `ErrorBoundary`s (S16); no route shows a raw stack trace. ✔
- **p95 < 500ms** — primary interactions are single indexed reads (Event by
  `[shopId,type,createdAt]`, Quote by its indexes) plus a TTL-cached catalog;
  analytics capture is non-blocking enqueue. ✔ (Load-test on a real store at
  submission.)
- **Accessible** — `lang` on the document, labeled controls, `role="alert"` on
  errors, visible focus outlines, AA-contrast link colour (S16). ✔
- **No hardcoded settings** — expiry, magic-link lifetime, and auto-approve
  tolerance are merchant settings; the dashboard's "expiring soon" window is a
  documented view constant, not a merchant knob. ✔

---

## Known limitations (carried to S20)

- **Screenshots / app icon** are a shot-list in `docs/listing.md`; they must be
  captured on a dev store before submission.
- **Live Shopify + AI paths** (draft-order create/calculate, billing
  request/cancel, the Haiku call) are verified in-container against mocked
  clients and real Postgres, since this environment has no dev store or API key.
  They should be exercised once against a dev store during submission.
- The Polaris CSS `@media print` build warning is upstream (Polaris bundle) and
  cosmetic.

---

## Added this slice

- `app/guardrails.test.ts` — static gauntlet: every webhook verifies HMAC + 401,
  the AI parser is temperature 0 with forced tool use, and no undercover model
  identifier appears in `app/`, `docs/`, or `prisma/`.
