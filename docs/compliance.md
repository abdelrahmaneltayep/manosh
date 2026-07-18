# /docs/compliance.md — Mannon compliance & trust

This is a **pass/fail gate for App Store review**. Reviewers exercise the GDPR webhooks and HMAC on
every submission. Implemented in S15; scopes declared from S3.

---

## Mandatory webhooks

All four are registered in `shopify.app.toml` and **HMAC-verified before any handler logic**. A bad
or missing signature → **401**, no side effects.

| Topic | Purpose | Handler behavior |
|---|---|---|
| `customers/data_request` | GDPR: buyer requests their data | Log the request; assemble the data we hold on that customer (Buyer + their Quotes/QuoteLines). Respond 200. |
| `customers/redact` | GDPR: erase a buyer's PII | Delete the matching `Buyer` and their `Quote`/`QuoteLine` PII for the shop. Respond 200. |
| `shop/redact` | GDPR: erase all shop data (48h after uninstall) | **Cascade-delete everything under the `Shop`**: Companies, Buyers, Quotes, QuoteLines, ReorderSources, Events, Session. Respond 200. |
| `app/uninstalled` | App removed | Clean up: delete `Session` and mark/clean shop-scoped data per retention rules below. Respond 200. |

### HMAC verification

- Verify `X-Shopify-Hmac-Sha256` against the raw request body using the app secret, **before**
  parsing/acting.
- Unsigned or mismatched → 401. Signed → proceed.
- Integration tests POST **both signed and unsigned** payloads to each webhook and assert the correct
  response. These tests are non-optional — reviewers run this path every submission.

### Redaction cascade (see `/docs/data-model.md`)

- `shop/redact`: `Shop` delete cascades via Prisma `onDelete: Cascade` to Company → Buyer / Quote /
  QuoteLine / ReorderSource, plus Events and Session. Verify nothing shop-scoped remains.
- `customers/redact`: locate `Buyer` by the customer email/id in the payload; delete the Buyer
  (cascades to their Quotes/QuoteLines). Other companies' data untouched.

---

## OAuth scopes — minimum, each with a reason

**Guardrail: request only what a slice actually uses.** Adding a scope requires adding a row here.
**Confirm exact scope names + whether each is still required against the current API via the Shopify
Dev MCP before declaring them in `shopify.app.toml`.**

`write_*` scopes grant read as well, so we never request the paired `read_*` alongside a `write_*`.

### Declared now (in `shopify.app.toml`, as of S3)

The stable core-path set, declared up front so the merchant OAuth consent screen doesn't change
under existing installs as the core slices land:

| Scope | Why we need it | Used by |
|---|---|---|
| `read_products` | Read the merchant catalog to build baskets, resolve SKUs, price lines. | S7, S10, S12, catalog cache |
| `read_orders` | List a company's past orders for reorder cards. | S9 |
| `write_draft_orders` | Create draft orders on quote-accept and reorder (also grants read for `draftOrderCalculate`). | S8, S9, S11 |
| `read_companies` | Read native B2B companies, locations, contacts for the draft order `purchasingEntity`. | S8, S9 |

### Deferred (added when their slice lands, name confirmed via Dev MCP)

Held back so we don't declare a scope whose exact name we can't yet confirm against the live API
(declaring an invalid scope breaks install/deploy):

| Scope (tentative) | Why we'll need it | Added in |
|---|---|---|
| `read_payment_terms` | Surface native payment terms on quote/reorder (display only). | S11 |

Notes:
- **No `write_products`, no `write_customers`, no tax/discount scopes** — we never mutate the catalog
  and never compute money.
- If a slice needs a scope not listed here, add the row and the reason in the same commit.
- Keep the "declared now" table in sync with `shopify.app.toml`. S19's self-review verifies they
  match and that every declared scope is actually exercised.

---

## Data retention

- Active install: retain Shop-scoped data to power the app.
- `app/uninstalled`: delete Session immediately; retain other data only as long as needed for a
  possible reinstall grace period, then rely on `shop/redact` (fires ~48h later) for full erasure.
- **Event payloads carry no PII** (ids + numbers only), so the Event stream is safe to retain for
  analytics within the shop's lifetime and is erased on `shop/redact`.

---

## Trust checklist (S19 gauntlet)

- [ ] All 4 webhooks respond correctly; signed pass, unsigned rejected (tests green).
- [ ] `shop/redact` leaves nothing shop-scoped behind (verified from a fresh install).
- [ ] `customers/redact` erases only the target buyer's PII.
- [ ] Declared scopes == used scopes == this table.
- [ ] Secrets hashed (magic-link tokens), no raw tokens stored.
- [ ] No PII in Event payloads or analytics events.
- [ ] Billing works fresh install → trial → paid across both tiers.
