# CLAUDE.md — Mannon

> The brain. **Every Claude Code session starts by re-reading this file plus the relevant `/docs/*`.**
> Read it, then plan, then build one slice, then stop. Do not drift.

Mannon is a **B2B wholesale quoting + reorder app** for Shopify merchants who have turned on
native B2B but are drowning in quote-by-email and manual reorders. We ride Shopify's native B2B
primitives (companies, catalogs, payment terms) and price on **draft orders** — we never rebuild
what Shopify already owns.

---

## The one build principle

> **Embedded app, built on native.** Mannon is an *embedded* Shopify Admin app (App Bridge +
> Polaris) — Shopify's own recommendation, because it integrates tightly and feels native to the
> merchant. We ride native B2B (companies, catalogs, terms) and price on **draft orders**, never
> rebuilding what Shopify already owns.

If you find yourself building a pricing engine, a tax calculator, or a terms engine — **stop**.
Shopify does that. We orchestrate and present.

---

## Guardrails (non-negotiable)

1. **Never compute B2B tax, discounts, or totals ourselves.** `draftOrderCalculate` is the single
   source of truth for money. We store snapshots of what Shopify returns; we never recompute.
2. **Minimum OAuth scopes.** Request only what a slice actually uses. Every scope is listed with its
   reason in `/docs/compliance.md`. Adding a scope requires adding a documented reason.
3. **HMAC-verify every webhook.** No exceptions. Unsigned or bad-signature payloads are rejected
   with 401 before any handler logic runs.
4. **AI never acts autonomously.** Every AI output lands on a **confirm screen**. The buyer/merchant
   explicitly confirms before anything is written (cart, draft order, quote). Temperature 0, and
   every AI-returned id is validated server-side against the live catalog. Merchant-facing screens
   follow the **dual-mode** pattern (Manual + `✦ Draft with Claude`, pre-fill only) — see
   `/docs/dual-mode.md`.
5. **Polaris components only.** No custom UI where Polaris has a pattern. If Polaris has a component
   for it, use it. Custom UI is a last resort and must be justified.
6. **Events are append-only.** The `Event` table is written through an insert-only helper. There is
   no update or delete path for events in application code. All insight/analytics derive from it.
7. **Store secrets hashed, never raw.** Magic-link tokens are stored as `magicTokenHash`. Raw tokens
   exist only in transit.

---

## Definition of done — every slice

A slice is not done until **all** of these hold:

- [ ] Feature works on the dev store (or, where the container can't reach a store, the API path is
      covered by tests against a mocked Admin API and the manual verification steps are documented).
- [ ] Tests written and green.
- [ ] Empty state **and** error state designed — never a blank table or raw stack trace.
- [ ] p95 < 500ms for the primary interaction.
- [ ] Accessible: keyboard-navigable end to end, screen-reader labels on every control, AA contrast.
- [ ] Nothing hardcoded that should be a merchant setting (e.g. auto-approve tolerance, expiry days).

---

## Shopify's experience values — the grading bar for every UI slice

**Considerate · Empowering · Crafted · Efficient · Trustworthy · Familiar.**

Practically: plain-language copy (Polaris content guidelines), Polaris patterns so it feels familiar,
the important task obvious and fast, and honest about what the app can and can't do.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Remix (Shopify Remix app template), **TypeScript** |
| UI | Polaris + App Bridge (embedded admin); server-rendered light HTML for the buyer portal |
| DB | Postgres via **Prisma** |
| Sessions | Prisma session storage (survives reinstall) |
| AI | Claude **Haiku 4.5** (`claude-haiku-4-5`), tool-use + prompt caching, temperature 0 |
| Analytics | PostHog (AARRR funnel) |
| Errors | Sentry |
| API access | **Shopify Dev MCP** in every build session — query the live 2026 API, never guess field names |

**Always confirm current CLI/template versions, API version, Billing fields, `purchasingEntity`
input, and payment-terms/PO fields via the Shopify Dev MCP before coding against them.**

---

## Repo layout

```
manosh/
├── CLAUDE.md                     # this file — the brain
├── shopify.app.toml              # app config, scopes, webhooks
├── prisma/
│   ├── schema.prisma             # see /docs/data-model.md
│   ├── migrations/
│   └── seed.ts                   # demo Shop + Company + Buyer + ReorderSource
├── app/
│   ├── db.server.ts              # Prisma client singleton
│   ├── shopify.server.ts         # Shopify app config, session storage, billing
│   ├── entry.server.tsx
│   ├── root.tsx
│   ├── routes/
│   │   ├── app.tsx               # embedded admin shell (App Bridge + Polaris frame)
│   │   ├── app._index.tsx        # ROI dashboard (F5)
│   │   ├── app.quotes.*.tsx      # merchant Quote Inbox (F1)
│   │   ├── app.settings.tsx      # merchant settings (tolerance, expiry, billing)
│   │   ├── portal.tsx            # NON-embedded buyer portal shell (magic-link auth)
│   │   ├── portal._index.tsx     # buyer home: reorder cards + quick-order + quote builder
│   │   ├── portal.quotes.*.tsx   # buyer quote builder / accept
│   │   ├── healthz.tsx           # /healthz -> ok
│   │   └── webhooks.*.tsx        # GDPR + app/uninstalled, all HMAC-verified
│   ├── services/                 # UI-free domain logic (pure, unit-tested)
│   │   ├── quote.server.ts       # status machine (F1) — see /docs/prd.md
│   │   ├── events.server.ts      # append-only Event helper
│   │   ├── billing.server.ts     # requireBilling(), plan constants
│   │   ├── magic-link.server.ts  # token generate / verify / revoke (hashed)
│   │   ├── draft-order.server.ts # draftOrderCreate / draftOrderCalculate wrappers
│   │   ├── reorder.server.ts     # clone past order -> draft
│   │   ├── catalog.server.ts     # cached catalog reads
│   │   └── ai/order-parser.server.ts  # AI-1 Magic Order Pad — see /docs/ai-spec.md
│   └── lib/                      # small shared utilities (hmac, analytics, formatting)
└── docs/                         # prd.md · ai-spec.md · dual-mode.md · data-model.md · compliance.md · metrics.md
```

Keep domain logic in `app/services/*` **UI-free and unit-testable**. Routes are thin: load, call a
service, render Polaris.

---

## Conventions

- **Money**: never a float. Store amounts as strings/decimals exactly as Shopify returns them,
  paired with a currency code. Totals are snapshots from `draftOrderCalculate`, not computed.
- **IDs**: Shopify GIDs (`gid://shopify/...`) stored verbatim. Never fabricate an id; AI-returned
  ids are validated against the live catalog before use.
- **Errors**: user-facing errors are plain-language Polaris `Banner`s. Internal errors go to Sentry.
- **Tests**: colocate `*.test.ts` with services; integration tests for webhooks (signed + unsigned)
  and for the draft-order path (mocked Admin API).
- **Settings, not constants**: expiry days, auto-approve tolerance, plan gates → merchant-editable
  or `/docs`-documented config, never magic numbers in handlers.
- **Commits**: small, one slice's worth, descriptive. Branch `claude/mannon-feature-slices-w3epbf`.

---

## The slice map (build in order; each depends only on those above)

Foundation: **S1** scaffold → **S2** data model → **S3** auth/billing skeleton.
Core value path (never cut): **S4** magic-link → **S5** quote machine → **S6** inbox → **S7** buyer
builder → **S8** accept→draft order → **S9** reorder → **S15** compliance.
Then: S10 quick-order, S11 terms/PO, S12 AI-1, S13 dashboard, S14 analytics, S16 a11y polish,
S17 billing complete, S18 listing, S19 self-review, S20 submit.

One slice per session. Finish it, test it, then move down the map. See the feature-slices plan for
the exact prompt per slice.
