# Mannon: complete handoff

Written 2026-11-24 for a Claude session that has not seen this project before. It
covers the app (sections 1 to 14) and the record of the working conversation that
produced it (section 15). It is a map: enough to act on, with a pointer to the deeper
document for every topic. Read `CLAUDE.md` at the repo root as well; its rules override
anything here.

---

## 1. Where things stand today

| | |
|---|---|
| **Status** | Published on the Shopify App Store on 2026-11-23, fully visible |
| **Listing** | https://apps.shopify.com/mannon |
| **App** | https://manosh.fly.dev (health: `/healthz`) |
| **Public demo** | https://manosh.fly.dev/demo (no install, no sign-up) |
| **Repo** | `abdelrahmaneltayep/manosh`, default branch `claude/mannon-feature-slices-w3epbf`. **The repo is public**: never commit anything private to it |
| **Latest commit** | See `git log`. The last code change is `518bb35` (quote-expiry job) |
| **Deployed build** | **Behind the repo.** On 2026-11-24 production returned 404 for `/internal/cron/quote-expiry`, so `518bb35` is not deployed yet |
| **Customers** | None yet. Goal: 10 by 2026-12-23 |
| **Owner** | Abdelrahman, a solo founder. He deploys and handles every dashboard himself |

**Needs the owner, in order:**

1. `git pull origin claude/mannon-feature-slices-w3epbf`, then `fly deploy`.
2. Turn on scheduled jobs: set `CRON_SECRET` in Fly and in GitHub (section 9.3).
   Production still answers `503 CRON_SECRET not set`.
3. Decide on an email provider. No email is delivered today (section 11, gap 1).
4. Test choosing the Free plan on a clean store (section 11, gap 3).
5. Payout and tax details in the Partner Dashboard.

---

## 2. What Mannon is

A Shopify app for stores that sell wholesale. Buyers ask for a quote on the store, the
merchant counters on one screen, and the accepted quote becomes a Shopify draft order.
Buyers also reorder past orders in one tap from a portal that needs no password.

**The one build principle:** embedded app, built on native. Mannon rides Shopify's own
B2B features (companies, catalogs, payment terms) and prices on draft orders. It never
rebuilds what Shopify owns.

**Guardrails (non-negotiable, from `CLAUDE.md`):**

1. Never compute tax, discounts or totals. `draftOrderCalculate` is the only source of
   money; the app stores snapshots of what Shopify returns.
2. Minimum OAuth scopes, each with a written reason in `docs/compliance.md`.
3. HMAC-verify every webhook; reject bad signatures with 401 before any logic.
4. AI never acts on its own. Every AI output lands on a confirm screen. Temperature 0,
   and every id the model returns is checked against the live catalog.
5. Polaris components only in the admin.
6. The `Event` table is append-only.
7. Secrets are stored hashed, never raw (magic-link tokens).

---

## 3. The product

### 3.1 The core flow

1. A buyer clicks **Request a Quote** on a product page (or adds items to a quote, or
   converts a cart).
2. The request appears in the merchant's admin under Quotes › Requests. The merchant
   clicks **Convert to quote**.
3. On the quote, the merchant edits line prices and quantities and clicks
   **Recalculate with these prices**. Shopify returns subtotal, tax and total.
4. Optionally **Draft with Claude** suggests a counter price, a reason and a message.
   The merchant chooses whether to use it, then clicks **Send counter**.
5. The buyer opens a sign-in link (no password), reviews the quote, picks payment
   terms such as Net 30, and confirms.
6. Mannon creates a Shopify draft order for the buyer's company with those terms.

### 3.2 Features

| Area | What it does | Plan |
|---|---|---|
| Storefront blocks | Request a Quote, Add to Quote, Convert Cart to Quote, Make an Offer, price gate. Theme app blocks, added from the theme editor | Quote blocks: all plans. Price gate: Starter and up. Make an Offer: Growth and up |
| Quote inbox | Views (All, Needs reply, Open, Accepted, Ordered, Expired), search, counters, PDF, duplicate, decline | All |
| Buyer portal | Passwordless sign-in link, accept quotes, reorder past orders, invoices, team. English, Arabic (right-to-left) and French | All |
| Order pad | Quick ordering by item. On Growth and up, paste a purchase order and Claude matches it to the catalog | All; PO reading Growth and up |
| Draft with Claude | Counter suggestions, replies, follow-up text, email templates, insights. Model `claude-haiku-4-5` | Growth and Scale |
| Net terms, credit, deposits | Terms on the draft order, credit limits, invoices, instalments, pay links | Growth and Scale |
| Pricing and catalog | Price lists, volume breaks, custom catalogs, catalog sharing, price rules, order rules (minimums, pack sizes) | Starter and up, limits by plan |
| Buyers | Companies and buyers read from Shopify, wholesale applications, sales reps, credit | Reps: Scale |
| Analytics | Quote metrics, win rate, pipeline | Basic: Starter. Full: Growth |
| Integrations | Accounting sync (QuickBooks, Xero), ERP export | Scale |
| White-label and agency | Branded buyer portal, agency organisations | Scale |

Full specs: `docs/prd.md`, and one file per feature in `docs/` (for example
`docs/make-an-offer.md`, `docs/net-terms-credit.md`, `docs/order-pad.md`).

### 3.3 Plans

Billed by Shopify (Shopify App Pricing, formerly managed pricing). Flat monthly price,
no per-order fees. Plan handles in the Partner Dashboard: `free`, `starter`, `growth`,
`scale`.

| Plan | Price | Trial | Limits |
|---|---|---|---|
| Free | $0 | none | 10 quotes a month, 1 company account |
| Starter | $9 a month | 14 days | Unlimited quotes, 5 company accounts, 1 price list |
| Growth | $29 a month | 14 days | Claude drafting, net terms, deposits, Make an Offer, 25 companies, 10 price lists |
| Scale | $69 a month | 14 days | Unlimited, rep portal, accounting and ERP sync, white-label |

**Plan rules in code** (`app/lib/billing-v3.ts`, `app/services/billing.server.ts`):

- The stored plan (`Shop.plan`) mirrors Shopify's subscription. `syncShopPlan` runs in
  the Home, Pricing plans and Settings loaders.
- No subscription (`TRIAL` or `CANCELLED` in the database) means Free capabilities and
  **no plan shown as Current**. The app never grants a paid tier or trial by itself.
- Scale includes everything in Growth. Use `isGrowthTier()` or `meetsPlan()`; never
  compare to the literal `"GROWTH"`.
- Every upgrade button goes to `/app/plans?upgrade=<plan>`, which sends the merchant
  to Shopify's hosted plan page. The app never creates charges.

### 3.4 Requirements and limits

- A Shopify online store (the buttons are theme app blocks).
- Buyers come from Shopify's company accounts (Customers › Companies). Which Shopify
  plans include company accounts today is an open question.
- The merchant admin is English only.
- Not in the product: WhatsApp, CRM sync, a native mobile app.

---

## 4. Surfaces

**Embedded admin** (`/app/*`, Polaris + App Bridge). Left navigation, with tabs inside
each item (`app/lib/nav.ts` is the single source):

| Nav item | Tabs |
|---|---|
| Home | Needs your attention, setup guide, performance |
| Quotes | Quotes · Requests · Offers · Follow-ups |
| Quote forms | Quote forms · Languages |
| Pricing & catalog | Price lists · Catalogs · Catalog sharing · Price rules · Order rules |
| Buyers | Buyers · Applications · Reps · Credit |
| Analytics | |
| Settings | General · Notifications · Payments · Tax & VAT · ERP sync · Accounting · Agency |
| Pricing plans | |

**Buyer portal** (`/portal/*`): server-rendered, not embedded, magic-link sign-in.
**Rep portal** (`/rep/*`). **Public pages:** `/` (landing), `/pricing`, `/privacy`,
`/demo`, `/apply/<shop>` (wholesale application), `/catalog/<shop>/<slug>` (shared
catalog), `/pay/<token>` (pay link).

**Storefront:** one theme app extension, `extensions/quote-widget`, with five blocks:
`quote_button`, `add_to_quote`, `cart_to_quote`, `make_offer_button`, `price_gate`.
One customer account extension, `extensions/customer-account-quotes`.

**Public APIs called by the storefront** (`/api/*`): `quote-request`,
`quote-widget-config`, `quote-form`, `quote-capture-config`, `offer`, `offer-config`,
`price-visibility`, `account.quotes`. These are called cross-origin, so each needs an
e2e check, not only a unit test.

**Webhooks** (all HMAC-verified): `app/uninstalled`, `app/scopes_update`,
`customers/data_request`, `customers/redact`, `shop/redact`.

---

## 5. Tech stack

| Concern | Choice |
|---|---|
| Framework | Remix 2 (Shopify Remix template), TypeScript, Vite |
| Admin UI | Polaris React 12, App Bridge React 4, React 18 |
| Database | Postgres (Neon) via Prisma 6. 40 migrations |
| Sessions | Prisma session storage |
| Auth | Shopify's new embedded auth strategy (token exchange), expiring offline tokens |
| Shopify API | Admin GraphQL, version 2026-04 |
| AI | Claude Haiku 4.5 (`claude-haiku-4-5`), forced tool use, temperature 0, prompt caching |
| Hosting | Fly.io, app `manosh`, region `fra`, one machine kept warm |
| Errors and analytics | Sentry, PostHog (both no-ops when their keys are unset) |
| Tests | Vitest, an e2e runner (`tests/*.e2e.ts`), and a full QA suite in `scripts/qa` |

**OAuth scopes:** `read_products`, `read_orders`, `write_draft_orders`,
`read_companies`, `write_payment_terms`, `read_inventory`, `write_customers`. The
reason for each is in `docs/compliance.md`. Adding a scope needs a written reason.

---

## 6. Repo map

```
manosh/
├── CLAUDE.md                 rules for every session; read first
├── SUBMISSION-KIT.md         App Store listing copy, reviewer instructions, replies
├── shopify.app.toml          app config, scopes, webhooks
├── fly.toml                  hosting, feature flags, release command
├── prisma/schema.prisma      data model (see docs/data-model.md)
├── app/
│   ├── routes/               thin: load, call a service, render
│   ├── services/             domain logic, UI-free, unit-tested (*.server.ts)
│   ├── services/prompts/     one file per Claude prompt
│   ├── lib/                  pure shared logic (billing, nav, home, formatting)
│   ├── config/plans.ts       who gets Claude features
│   └── components/           shared Polaris compositions
├── extensions/               quote-widget (theme), customer-account-quotes
├── scripts/qa/               QA suites and the local mock stack
├── tests/                    e2e tests
└── docs/                     one file per topic (section 14)
```

**Key data models:** `Shop`, `Company`, `Buyer`, `Quote`, `QuoteLine`, `QuoteRequest`,
`Offer`, `ReorderSource`, `PriceList`, `Catalog`, `Invoice`, `PaymentPlan`, `Event`
(append-only; all analytics derive from it), `Session`.

**Conventions:** money is never a float (strings exactly as Shopify returns them, with
a currency code). Shopify ids are stored verbatim. User-facing errors are plain-language
Polaris banners. Settings such as expiry days and tolerance are merchant-editable, not
constants.

---

## 7. Configuration

Names only; values live in Fly secrets and must never be printed or committed.

| Kind | Names |
|---|---|
| Required | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `SESSION_SECRET`, `DATABASE_URL` |
| AI | `ANTHROPIC_API_KEY` |
| Scheduled jobs | `CRON_SECRET` (not set in production as of 2026-11-24) |
| Email | `MANNON_MAIL_FROM` (see section 11, gap 1) |
| Integrations | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `MANNON_ENCRYPTION_KEY`, `MANNON_VAPID_PUBLIC_KEY`, `MANNON_VAPID_PRIVATE_KEY` |
| Monitoring | `SENTRY_DSN`, `POSTHOG_API_KEY`, `POSTHOG_HOST` |
| Other | `MANNON_DEMO_SHOP`, `MANNON_MERCHANT_ALERT_EMAIL`, `SHOPIFY_APP_HANDLE` |

**Feature flags** (`MANNON_FF_*`): every feature flag is set to `"true"` in `fly.toml`,
including `MANNON_FF_PLAN_V3`. `MANNON_FF_DISCOVERY` is deliberately unset. A route
whose flag is off returns 404, and the nav hides it.

---

## 8. Running and testing

| Command | What it does |
|---|---|
| `npm run dev` | `shopify app dev` against a dev store |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest. Database tests need a Postgres `DATABASE_URL`; they truncate tables |
| `npm run test:e2e` | Builds, serves, runs `tests/*.e2e.ts`. Needs `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SESSION_SECRET`, `DATABASE_URL`; leave `MANNON_DEMO_SHOP` unset |
| `npm run qa:local` | The whole app on mocks (Shopify, Claude, storefront). `-- --only=M` runs one section |
| `npm run qa:all` | The same suites against the live app, driving a real browser |

Last results (2026-11-23): 945 unit tests, 20 e2e tests, 140 QA checks with 0
failures. The QA catalogue is `docs/qa/test-catalog.md`; testing notes are in
`docs/testing.md`.

Definition of done for any change (from `CLAUDE.md`): works on the dev store or is
covered by tests against a mocked Admin API; tests green; empty and error states
designed; primary interaction p95 under 500 ms; keyboard and screen-reader accessible;
nothing hardcoded that should be a setting.

---

## 9. Deploy and operations

### 9.1 Deploying

The owner deploys from his Mac. A cloud session cannot.

```
git pull origin claude/mannon-feature-slices-w3epbf
fly deploy
```

`fly deploy` runs `prisma migrate deploy` first. Changes to the extensions or
`shopify.app.toml` also need `shopify app deploy`. After every deploy: open the app in
the dev store and load Pricing plans (section 9.4 explains why).

### 9.2 Billing

Shopify App Pricing. The app reads the subscription with `billing.check` and maps the
plan name to a tier. Shopify's newer guidance is to read subscriptions from the Partner
API; the current method works but is a migration to plan (section 11, gap 5).

### 9.3 Scheduled jobs

Nine background jobs exist as routes under `/internal/cron/*`. None runs unless a
scheduler calls it with the `x-cron-secret` header. `docs/scheduled-jobs.md` lists
every job, its frequency and what stops if it never runs.

To turn them on: set `CRON_SECRET` with `fly secrets set`, add the same value as a
GitHub repository secret named `CRON_SECRET`, then run the "Scheduled jobs" workflow
once by hand. The workflow (`.github/workflows/scheduled-jobs.yml`) already runs hourly
and exits with a notice until the secret exists.

### 9.4 IP allowlist (Shopify requirement for public apps)

Enforced since 2026-11-23 in the Dev Dashboard (app settings › IP allowlist). Shopify
rejects Admin API calls from networks not on the list with a 403.

- Allowed today: the two hosting networks that Fly's outgoing traffic for this app
  came from, read from Shopify's request logs. The exact entries are in the Dev
  Dashboard, not in this public repo. No single IP addresses are listed.
- **Risk:** if Fly routes through a third network, every Admin API call fails. That is
  why Pricing plans is loaded after each deploy. To recover: turn Enforce off, add the
  new network from the Dev Dashboard logs, turn Enforce back on.
- Never choose "Block all requests", and never save an empty list.
- Optional tightening: give the Fly app a static outgoing IP, list that address, then
  remove the two networks.

### 9.5 Reviews

The app asks for reviews through App Bridge's Reviews API (`shopify.reviews.request()`)
from an effect on Home, once a quote has become an order. There is no review button
or link. Never offer anything for a review and never ask for a positive one.

### 9.6 Monitoring

`/healthz` reports configuration problems without exposing values. Sentry and PostHog
work only if their keys are set; confirm with `fly secrets list`.

---

## 10. App Store history

| Date | Event |
|---|---|
| Early Nov 2026 | Review rounds. Fixed: theme blocks not visible on the store (5.1.2), plan page opening a 404 because the app handle was guessed (1.2.2), a store-domain field on login (2.3.1), theme-editor deep links for app blocks (5.1.3) |
| 2026-11-18 | Two issues, ref 126730. **1.2.2:** a fresh install showed Starter as Current while Shopify showed no plan. **2.1.1:** "Leave a review" loaded the App Store inside the app frame and blanked the app |
| 2026-11-22 | Both fixed (`ca77c9f`, `7d4e352`), proof videos submitted |
| 2026-11-23 | Approved and published. Same day: Shopify required an IP allowlist within 24 hours; set up and enforced |

Listing copy, reviewer instructions and the reply texts are in `SUBMISSION-KIT.md`.

Lessons that still apply:

- A link from an embedded page to another site must set `target="_blank"` or `_top`.
  The app's Polaris link component is Remix's `<Link>` and ignores `external`. A guard
  test (`app/lib/review-request.test.ts`) fails if one is added.
- Listing images may not contain pricing, reviews or outcome claims.
- Whatever the app shows about the plan must match Shopify's own Billing card.

---

## 11. Known gaps (verified, most important first)

1. **No email is delivered.** `sendEmail` in `app/services/mailer.server.ts` has no
   transport. With `MANNON_MAIL_FROM` unset it skips; with it set it returns
   `sent: true` without sending. This affects follow-ups, payment and tax reminders,
   invoice emails, "Email PDF to buyer", the weekly digest and reorder nudges. Buyers
   get their sign-in link because the merchant copies it from Buyers › Generate link.
   Needs a provider decision (for example Resend, Postmark or SES), then a real
   `deliver()` and honest UI states. Do not promise any automatic email until done.
2. **Scheduled jobs are off** in production (section 9.3), and the latest build is not
   deployed (section 1).
3. **The Free plan path is untested on a real store.** It is unknown whether choosing
   Free on Shopify's plan page yields a subscription the app can read. The app also
   accepts `plan_handle=free` on return from Shopify as a fallback. Test: choose Free
   on a clean store and confirm Pricing plans marks Free as Current.
4. **Scale is missed by some Growth checks** in the buyer portal: `portal.team.tsx`,
   `portal.quick-order.tsx`, `portal.quotes.$id.tsx`, `services/wholesale.server.ts`
   compare the plan to the literal `"GROWTH"`. Fix with `isGrowthTier`.
5. **Billing reads use the Admin API.** Shopify now recommends the Partner API's active
   subscription query.
6. **The IP allowlist uses shared networks**, not exact addresses (section 9.4).
7. **Two jobs are not safe to run more often than scheduled:** `analytics` sends the
   weekly digest on every Monday call, and `reorder-push` nudges on every call. The
   digest's recipient is also a placeholder (`MANNON_MAIL_FROM`).
8. **UX items left open** (`docs/ux-audit.md`): quote expiry is stored in two places;
   long forms other than Settings lack a save bar; product and collection fields take
   typed ids instead of Shopify's resource picker; the migration to Polaris web
   components has not started.
9. **Listing follow-ups:** the feature video is the review screencast, not a
   promotional video; search terms exceed Shopify's limit of five; no Arabic or French
   listing translation yet.
10. **The lead list is unverified** (section 12).

---

## 12. Go-to-market

| Document | What it is |
|---|---|
| https://claude.ai/artifact/PZn7AiKkkUPtjozRfm9tdn | The owner's go-to-market plan: goal, channels, week-by-week checklist |
| `docs/promotion-plan.md` | The same plan as a brief a session can execute: allowed claims, rules, messages in English, Arabic and French, tracking |
| `docs/b2b-store-leads.md` | 66 candidate stores with a wholesale or quote page. Shopify and the page content must be confirmed in a browser before any contact |

Target customer: a Shopify store that already takes wholesale orders and answers price
questions by email. The pitch: **Mannon turns "can you send me a price?" emails into
Shopify draft orders.**

---

## 13. Rules for any session working on Mannon

**Always**

- Read `CLAUDE.md` and the relevant `docs/*` file before changing code. One slice of
  work at a time; finish and test it before the next.
- Check Shopify field names and API behaviour against Shopify's current docs before
  coding against them. Do not guess.
- Keep routes thin and logic in `app/services` or `app/lib`, with a colocated test.
- Commit small, descriptive changes to `claude/mannon-feature-slices-w3epbf` and push.
  No pull request unless the owner asks.
- Report results plainly, including what was not verified.

**Never**

- Type, read aloud or commit a credential or secret, or sign in for the owner.
- Run `fly deploy`, `shopify app deploy`, change the Partner or Dev Dashboard, submit
  anything to Shopify, or spend money, unless the owner says so in that conversation.
- Send outreach, publish a post or change the listing yourself. Draft; the owner sends.
- Compute money in the app, or let AI output act without a confirm screen.
- Make a product claim that section 3 or `docs/promotion-plan.md` section 2 does not
  support.
- Put `#` comments inside commands meant for the owner's terminal (zsh).

---

## 14. Document index

| Topic | File |
|---|---|
| Rules and principles | `CLAUDE.md` |
| Product requirements | `docs/prd.md` |
| Data model | `docs/data-model.md` |
| AI design, dual-mode pattern | `docs/ai-spec.md`, `docs/dual-mode.md`, `docs/ai-quote-assistant.md` |
| Pricing and plans | `docs/pricing-v3.md` |
| Compliance, scopes, plan state, data protection | `docs/compliance.md`, `docs/data-protection.md`, `docs/security-incident-response.md` |
| Scheduled jobs | `docs/scheduled-jobs.md` |
| Testing and QA | `docs/testing.md`, `docs/qa/test-catalog.md` |
| UX audit and admin structure | `docs/ux-audit.md`, `NAV-MIGRATION.md` |
| Built for Shopify notes | `docs/bfs-design.md`, `docs/bfs-integration.md`, `docs/bfs-performance.md` |
| App Store listing and review | `SUBMISSION-KIT.md`, `docs/listing.md`, `docs/submission.md`, `docs/screencast-recording.md` |
| Deploy checklists | `docs/go-live-checklist.md`, `DEPLOY-VERIFY-P0.md` |
| Features, one file each | `docs/quote-widget.md`, `docs/quote-capture.md`, `docs/quote-ops.md`, `docs/make-an-offer.md`, `docs/order-pad.md`, `docs/price-lists.md`, `docs/custom-catalogs.md`, `docs/catalog-sharing.md`, `docs/order-rules.md`, `docs/company-accounts.md`, `docs/wholesale-registration.md`, `docs/sales-rep-portal.md`, `docs/net-terms-credit.md`, `docs/flexible-payments.md`, `docs/tax-vat.md`, `docs/followups.md`, `docs/quote-analytics.md`, `docs/accounting-sync.md`, `docs/erp-sync.md`, `docs/i18n.md`, `docs/buyer-pwa.md`, `docs/white-label.md` |
| Promotion | `docs/promotion-plan.md`, `docs/b2b-store-leads.md` |
| Brand | `docs/brand.md` |

---

## 15. Conversation record

What the owner asked for and what was done, in order. The session transcript available
when this was written starts on 2026-09-19; the app's earlier build (30 commits from
2026-08-09) is known from `git log` only. Outcomes below are taken from the commits and
from the conversation itself.

### 15.1 Timeline

| Date | What the owner asked | What was done |
|---|---|---|
| Aug 9 to Sep 12 | (from git history) | App built in slices: quoting, buyer portal, reorder, Claude features, 22 pages merged into 7 tabbed nav items, move to Shopify App Pricing |
| Sep 12 to 19 | A demo to try before installing; listing assets kept in step with every change | Public demo: hub, live buyer demo on the dev store and a guided merchant tour, with the portal in Mannon's branding. An accepted demo quote verified as a real Shopify draft order. Customer account extension rewritten for the 2026-07 API. Privacy policy updated. Nine listing slides, a four-minute scripted walkthrough, and listing copy rewritten without pricing or outcome claims |
| Sep 19 | Verify the customer account block and the reorder cards on the dev store; update everything that mentions them | Block and reorder card verified; reviewer instructions, screenshots, screencast script, listing copy and landing page updated |
| Sep 22 | Check the app against the App Store requirements before submitting | Pre-submission pass; `.gitignore` cleaned up for generated extension files |
| Sep 27 | A reusable brand document | `docs/brand.md`: logo, colour tokens, type, components, voice, plus a video section (motion graphics, voice-over, audio mix) |
| Oct 2 | Use the tester-army e2e runner | `tests/*.e2e.ts` and `npm run test:e2e` |
| Nov 1 | Shopify suspended the submission until Nov 4 for repeated failures. Fix the two issues and test every case | Fixed 5.1.2 (theme blocks now render as soon as added) and 1.2.2 (plan page URL built from the app's real handle). QA harness with 77 HTTP cases. Live admin click-through through Remote Control into the owner's Chrome. Protected customer data declared as Level 1 plus email only. Data protection answers and an incident response policy written |
| Nov 1 to 2 | Fix what the live run found | Added the `write_payment_terms` scope so Net 30 attaches to a draft order; drafts priced in the agreed currency; buyers linked to their Shopify company; accept refused without a company contact; demo reorder card made reliable. Reorder tolerance set to 5% on the dev store and the reorder step re-verified |
| Nov 3 | A walkthrough video in the "Menna" voice, produced from the terminal | Narration generated with ElevenLabs in the brand's "Menna" voice, take B chosen for every scene. `npm run video` downloads the takes, records the app through the owner's signed-in Chrome, and assembles the cut with captions, pointer and transitions |
| Nov 5 | Redesign the landing page, with options to choose from | Several options built as a preview artifact (https://claude.ai/code/artifact/c357d351-8120-4492-9686-286c92eb2857). Owner chose option B with animations, a demo store page and a pricing page. New logo, favicon and capital-M wordmark. Deployed |
| Nov 5 | Test the whole app from the terminal, including the Shopify admin | `npm run qa:all` (live) and `npm run qa:local` (mocks), with the catalogue in `docs/qa/test-catalog.md` |
| Nov 5 | "Can I submit now?" (asked several times, with the pre-submission review skill) | Fixed 2.3.1 (no typed store domain on login; agency stores join by invite code), 5.1.3 (theme-editor deep links), 1.1.6 (cross-store discovery directory switched off). Wrote the reviewer instructions, the network access request reason for the customer account extension, and the screenshot shot list; captured the screenshots |
| Nov 5 | "Are the Draft with Claude features linked with the Claude API?" | Yes: they call Anthropic's API with `claude-haiku-4-5` |
| Nov 5 to 6 | The owner records the review screencast; plan and edit it | A 12-clip recording plan (`docs/screencast-recording.md`), then the clips edited into a narrated review screencast (two versions; the second ran 2:16) |
| Nov 6 | A Partner Dashboard listing issue about plan display names | Only the owner can edit the dashboard; steps given (display names Free, Starter, Growth, Scale with top features) |
| Nov 6 | A UX audit of the whole admin against Shopify's guidance, then restructure | `docs/ux-audit.md` and the restructure (`5757b4d`): jobs-to-be-done order, progressive disclosure, back actions and tabs everywhere, Settings cut from about 14,500 px to 1,200 px. The owner chose to apply the patterns on current Polaris and migrate to web components later |
| Nov 7 | Listing screenshots and feature media | Shopify's check rejected images that showed pricing. All listing images redone in the owner's design with real captures and no pricing; screenshot 1 became a feature overview |
| Nov 22 | Two new review issues (ref 126730) | **1.2.2:** no plan is shown as Current until Shopify holds one (`ca77c9f`). **2.1.1:** the review link that blanked the app was replaced by App Bridge's review request (`7d4e352`). Also fixed: quote count on paid plans, the "expiring soon" list, quotes past expiry counting toward the limit. Five proof recordings from the owner checked; two trimmed copies returned |
| Nov 23 | "What should I do now?" after the approval email | Next steps given. Then: quote-expiry job wired, `docs/scheduled-jobs.md` and the scheduler workflow added (`518bb35`) |
| Nov 23 | A go-to-market plan to reach 10 customers in a month | The plan document (section 12) |
| Nov 23 | Shopify's email requiring an IP allowlist within 24 hours | Steps and a prompt written; the owner's local session set it up and enforced it (section 9.4) |
| Nov 23 | How to continue this session on the owner's Mac with Remote Control | `claude --teleport`, then `/remote-control` |
| Nov 23 | A promotion plan and a list of B2B Shopify stores, to share with another session | `docs/promotion-plan.md` and `docs/b2b-store-leads.md` |
| Nov 24 | Is the allowlist follow-up required? Then this document | Not required; the issue is fixed. This file |

### 15.2 Decisions the owner made

- Billing through Shopify App Pricing with four plans at $0, $9, $29 and $69.
- Landing page: option B.
- UX: apply App Home patterns now on Polaris React; migrate to web components later.
- Review screencast: skip the theme-editor clip that never recorded properly.
- Listing images: the owner's own design language, real screenshots, no pricing.
- "Customer" for the 30-day goal: assumed to mean any plan, with at least 3 paying.
  The owner has not confirmed this.

### 15.3 How the owner likes to work

- Short, direct answers with numbered steps he can follow.
- He deploys and clicks through dashboards himself; a session writes the steps or a
  ready-to-paste prompt for another session.
- He often sends a screenshot or a screen recording and asks "check this".
- He runs a second, local Claude session with browser control for tasks that need a
  signed-in browser. Prompts for that session must be fully self-contained.

### 15.4 Outputs that are not in the repo

Media is git-ignored, and the cloud session's scratch files do not transfer. The owner
already has copies of these:

| Output | Where |
|---|---|
| Go-to-market plan | https://claude.ai/artifact/PZn7AiKkkUPtjozRfm9tdn |
| Landing page options | https://claude.ai/code/artifact/c357d351-8120-4492-9686-286c92eb2857 |
| Listing feature video | https://youtu.be/y4uYnPY_Das (review-era cut; due for a promotional replacement) |
| Review screencast, walkthrough video, narration takes | Sent to the owner as files |
| Listing images (thumbnail and six screenshots, with alt text) | Sent to the owner as a zip |
| Proof videos for review issues 1.2.2 and 2.1.1 | Sent to the owner as files |
| Full conversation log, message by message (`mannon-conversation-log.md`) | Sent to the owner as a file. Kept out of the repo because the repo is public |

### 15.5 Facts learned the hard way

- Shopify's hosted plan page needs the app's real handle; read it from the Admin API.
- Net terms on a draft order need `write_payment_terms`, and Shopify needs the payment
  schedule sent with them.
- A buyer must be a contact of a Shopify company, or no draft order can be made for them.
- Development and review stores are billed with test subscriptions; count them.
- Embedded pages opened with a bot user agent get a 410; tests need a browser user agent.
- Fly's outgoing traffic for this app came from two networks that do not carry Fly's
  own name; read them from Shopify's logs rather than assuming.
- A cloud session cannot open most websites, `fly.io` included, and cannot open store
  sites to verify leads. Shopify's docs and web search do work.
- A search result is not proof. The lead list's spot-check found one in three entries
  with something to re-check.
