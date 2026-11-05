# Mannon test catalog — every user flow, every case

The full QA run (`npm run qa:all`, see `docs/testing.md`) executes these cases in
order and writes one report in the qa-tester format: per case the command or
action, the expected result, the actual result, a verdict, and the evidence
(captured output or a screenshot). Verdicts: **PASS**, **FAIL**, **BLOCKED** (a
precondition failed, so the case could not run), **SKIP** (not applicable or
switched off), **INFO** (recorded, not judged).

Who the flows serve:
- **Visitor**: someone on manosh.fly.dev deciding whether to install.
- **Shopper / buyer**: a wholesale customer on the merchant's storefront and in the passwordless portal.
- **Merchant**: the store owner inside Shopify Admin.
- **Shopify and the platform**: webhooks, billing and the public APIs the theme blocks call.

Cases marked (local) run against a production build on your machine and need
`DATABASE_URL`. Every other case runs against the live app and the dev store.

**Two modes.** `npm run qa:all` tests the live app, your storefront and Shopify
Admin in your signed-in Chrome. `npm run qa:local` runs every section on your
machine instead: the production build on 127.0.0.1 wired to a mock Shopify
Admin API, a mock Claude and a mock Online Store (`scripts/qa/local/`), with the
embedded admin opened the way Shopify frames it (a session token signed with
the app secret, App Bridge stubbed). Local mode needs only a local Postgres; it
proves the app's flows and its calls to Shopify, the live mode proves the real
store, theme and Shopify Admin.

## P — Prerequisites
| ID | Case | Expected |
|---|---|---|
| P1 | Node and npm versions | Node ≥ 20.19 or ≥ 22.12 |
| P2 | Playwright's Chromium is installed | the browser launches |
| P3 | Live app answers `/healthz` | 200 or 503 with a `configOk` field |
| P4 | Git branch and commit recorded | the report names what was tested |
| P5 | tmux, curl, jq, openssl, nc present (local layer) | all found, or the local layer is skipped |

## L — Local layers (local)
| ID | Case | Expected |
|---|---|---|
| L1 | Typecheck (`tsc --noEmit`) | exit 0 |
| L2 | Unit and integration tests (Vitest) | every file passes |
| L3 | End-to-end tests on the served build (`npm run test:e2e`) | every test passes |
| L4 | HTTP contract smoke in tmux (`scripts/qa-smoke.sh`, ~78 cases) | 0 failures, 0 server errors |

## C — Live HTTP contract (no secrets needed)
| ID | Case | Expected |
|---|---|---|
| C1 | `/` home | 200, "From a buyer’s first click" |
| C2 | `/?shop=x.myshopify.com` | 30x to `/app?shop=` (install path) |
| C3 | `/pricing` | 200, Free / Starter / Growth / Scale, no "$79" |
| C4 | `/demo/store` | 200, "Harbor Blend Espresso" |
| C5 | `/demo`, `/demo/tour`, `/privacy` | 200 each |
| C6 | Unknown URL | 404 page, no stack trace |
| C7 | Favicon, 32 px icon, home-screen icon | 200 with image types |
| C8 | Each GDPR webhook unsigned and with a wrong signature | 401 before any handler runs |
| C9 | Storefront config APIs for an unknown shop | `{enabled:false}` with CORS |
| C10 | `OPTIONS /api/quote-request` and `/api/offer` preflight | 204 with CORS |
| C11 | Quote request / offer with an empty body | 400 JSON, never 5xx |
| C12 | Portal without a session, bad magic token | sign-in page or plain message, never 5xx |
| C13 | Cron endpoints without the secret | 401/503, never runs |
| C14 | Responses never contain a stack trace or a secret name | none found |
| C15 | p95 latency of `/`, `/pricing`, `/api/quote-widget-config` (10 requests each) | < 500 ms (CLAUDE.md definition of done) |

## V — Visitor, public pages in a browser (desktop and phone)
| ID | Case | Expected |
|---|---|---|
| V1 | Home: headline, nav (Demo store, The journey, Features, Pricing), no "All options" | as listed |
| V2 | Home: 8 journey steps; clicking a progress pill scrolls to that step | step in view, pill highlighted |
| V3 | Home: demo store section, features block, merchant login form | visible |
| V4 | Home → Open the demo store | lands on `/demo/store` |
| V5 | Home → Pricing | lands on `/pricing` at the top |
| V6 | Pricing: annual toggle | Growth shows $24.17 and "$290 billed yearly" |
| V7 | Pricing: comparison table and FAQ | rows present, FAQ opens |
| V8 | Demo store: Add to Quote → 3 steps → sent | "Quote request sent" |
| V9 | Demo store: guest price gate toggle; Back to Mannon | price hidden / link to `/` |
| V10 | Demo hub cards; merchant tour Next/Previous and arrow keys | steps move |
| V11 | Every public page at 390 px | no sideways scroll |
| V12 | Every public page | no console errors, no broken images, images have alt text |

## S — Shopper on the live storefront (`npm run test:storefront`)
| ID | Case | Expected |
|---|---|---|
| S1–S3 | Store opens (password), product page with the blocks, blocks point at the app | PASS |
| S4 | Request a Quote, Add to Quote, Make an Offer, Price gate on the page and visible | PASS |
| S5 | Request a Quote sent from the product page | confirmation and API 200 |
| S6 | Add to Quote drawer sent | confirmation |
| S7 | Make an Offer at 80% of list | outcome reported |
| S8 | Convert Cart to Quote from `/cart` | confirmation |
| S9 | Guest sees the price hidden and "Request a Quote" | when guest gating is on |
| S10 | Requests and the offer reach the admin | counts match |

## M — Merchant in Shopify Admin (signed-in Chrome)
| ID | Case | Expected |
|---|---|---|
| M1 | Home and every nav page and tab: Quotes, Requests, Follow-ups, Quote forms, Languages, Price rules, Price lists, Offers, Wholesale, Catalogs, Catalog sharing, Order rules, Buyers, Reps, Credit, Analytics, General, Payments, Tax & VAT, ERP sync, Accounting, Agency, Pricing plans | each renders, no "Something went wrong", or SKIP when its feature is off |
| M2 | Requests: this run's storefront request → Convert to quote | a quote is created, or the reason is shown |
| M3 | Quote: Totals from Shopify card | Subtotal, Tax, Total "Calculated by Shopify". The app links the buyer from Shopify (Customers → Companies) by email; when the shopper isn't a company contact it explains what to set up (BLOCKED; set `MANNON_QA_EMAIL` to a company contact's email to price and order live) |
| M4 | Quote: change a unit price → Recalculate with these prices | totals update, "Not saved until you send the counter" |
| M5 | Quote: ✦ Draft all lines with Claude → Use this price | a draft per line; nothing sent |
| M6 | Quote: Send counter | "Counter sent to the buyer", status Countered |
| M7 | Buyers: Generate link for that buyer | "Magic link ready to send" with a `/portal/auth?token=` link |
| M8 | Offers: this run's offer → Send counter | the offer shows the counter |
| M9 | Analytics: page and ✦ Claude insights section | renders, or an upgrade note |
| M10 | Pricing plans → Choose Growth (review 1.2.2) | Shopify's plan page opens and lists all four plans; nothing approved |
| M11 | Price rules: guest gating rule present | listed as Active |

## B — Buyer in the passwordless portal (magic link from M7)
| ID | Case | Expected |
|---|---|---|
| B1 | Open the magic link in a private window | "You’re signing in as …", Continue, no password |
| B2 | Portal home | Welcome, Your quotes, Reorder a past order |
| B3 | Open the Countered quote, choose Net 30, Accept & create order | a confirm panel appears; nothing written yet |
| B4 | Confirm & create order | status Ordered with Shopify's subtotal, tax and total |
| B5 | Order pad: paste two SKU lines → Add pasted lines | lines appear in "Your order" |
| B6 | Order pad: paste a PO → ✦ Read my order | Claude's matches appear; nothing ordered until "Request quote for these items". Locally a "made-up" line comes back from mock Claude with an invented id and must be listed as not matched |
| B7 | Request a quote page | renders with the catalog |
| B8 | Invoices and Team pages | render |
| B9 | Language: العربية then English | page turns right-to-left, then back |
| B10 | Reorder a past order → Reorder | a draft order, or a quote awaiting approval |
| B11 | Sign out | back to the sign-in page; the old session no longer opens the portal |

## D — Public buyer demo (`/demo/buyer`, rate limit 5 starts per IP per hour)
| ID | Case | Expected |
|---|---|---|
| D1 | Demo hub → Open the buyer demo | lands as "Demo buyer" with a Countered quote and a reorder card |
| D3 | Open the Countered quote, Net 30, Accept & create order | a confirm panel appears |
| D4 | Confirm & create order | Ordered |
| D5 | Reorder card → Reorder | a new quote or an approval note |

## A — The Shopify side
Live, in your signed-in Chrome (Shopify Admin's own pages, read-only):
| ID | Case | Expected |
|---|---|---|
| A1 | Settings → Apps | Mannon installed |
| A2 | Admin sidebar | a Mannon link (INFO when not pinned) |
| A3 | Orders → Drafts | the draft orders this run created (B4, B10, D4), created today |
| A4 | Customers → Companies | native B2B companies listed (INFO when the plan has none) |
| A5 | Customers, search this run's storefront email | INFO: whether Shopify has a customer for it |
| A6 | Settings → Billing → Subscriptions | INFO: Mannon's plan as Shopify bills it |
| A7 | Settings → Payments | Net 30 available |

Local (`qa:local`), from the mock Admin API and mock Claude logs:
| ID | Case | Expected |
|---|---|---|
| A1 | Every Admin API operation the run made | answered by the mock (an unanswered one could hide a failure) |
| A2 | The accepted quote's total in the portal (B4, else D4) | equals the draft order's `totalPriceSet` from Shopify |
| A3 | The `draftOrderCreate` input | purchasing company, location and contact; `priceOverride` on every line; Net 30 with `issuedAt` |
| A4 | Every variant id sent to `draftOrderCalculate`/`draftOrderCreate` | all from the catalog; the invented id from B6 never reaches Shopify |
| A5 | Every Claude call | temperature 0, forced tool, Haiku 4.5 |
| A6 | Admin API writes while B6 ran | none |
| A7 | The reorder (B10, else D5) | a draft with the past order's lines when the portal says Ordered |

## X — Clean-up and evidence
| ID | Case | Expected |
|---|---|---|
| X1 | Every browser context closed, every tmux session killed | none left |
| X2 | Artifacts created by this run listed (requests, offer, quote, draft orders, the guest rule) | listed with the run tag |
| X0 | (local) The app's request log for the whole run | no 5xx except the cron 503s C13 asks for; `server.log` and `shopify-calls.json` saved |

What is deliberately not automated: approving a paid plan (test charges still
change the subscription), uninstalling the app, editing the theme (see
`npm run theme:add-blocks`), and deleting Shopify draft orders. The report lists
them under "Manual".
