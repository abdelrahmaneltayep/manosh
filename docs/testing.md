# Testing Mannon

Three layers, cheapest first. A slice is done when all three are green for the
surfaces it touches (CLAUDE.md, Definition of done).

| Layer | Tool | What it proves | Command |
|---|---|---|---|
| Unit + integration | Vitest | Services, loaders, webhooks (signed and unsigned), the draft-order path against a mocked Admin API, DB fixtures | `npm test` |
| Local end-to-end | e2e (tester-army) + Playwright | Real pages in a real browser against a production build served by remix-serve, plus the public HTTP contract | `npm run test:e2e` |
| Live end-to-end | e2e agent steps | The deployed app and the public demo: a sample buyer accepts a countered quote and reorders a real past order | `npm run test:e2e:live` |

## Vitest

`app/**/*.test.ts(x)` and `prisma/**/*.test.ts`. DB-backed specs self-skip
without `DATABASE_URL`; point it at a scratch Postgres with the migrations
applied (`npx prisma migrate deploy`) to run all of them. Files run serially
because fixtures truncate tables.

## Local e2e (`npm run test:e2e`)

Config: `e2e.config.ts`. Tests: `tests/*.e2e.ts`. The script builds the app,
then the runner starts `remix-serve` on port 3100 (override with `E2E_PORT`),
waits for it, runs the suite, and stops it. No agent steps, so no model and no
key are needed. Each test opens a fresh browser context.

Environment: the runner loads `.env` from the project root and forwards only
what `e2e.config.ts` names to the server (`DATABASE_URL`, the Shopify keys,
`SESSION_SECRET`, `MANNON_DEMO_SHOP`). Any values work for the public pages;
without `MANNON_DEMO_SHOP` the buyer demo shows its unavailable notice and the
suite asserts that notice instead of the portal.

Demo reorder card: on the demo store the app reads the last 60 days of orders
(all `read_orders` allows). When it can see none and the demo company has no
saved reorder source yet, `startDemo` seeds one real order itself — a draft
order from the live catalog completed with `paymentPending: true`, never charged,
PO `PO-DEMO-SEED` — and the card comes from that mutation's payload. This runs
only on `MANNON_DEMO_SHOP`, at most once, and the Fly log says when it did
(`[demo] seeded order …`).

First run: `npx playwright install chromium` (CI: `--with-deps`).

What is covered today:

- `landing.e2e.ts`: the home page — title and headline, the nav (demo store,
  pricing, no options list), the eight journey steps, the demo store section,
  the features block, the native-B2B line, the login form, the links into
  `/demo/store` and `/pricing`, the `?shop=` hand-off to `/app`, the privacy page.
- `demo-store.e2e.ts`: the sample storefront product page — Add to Quote opens
  the three-step request (merging quantities), a second product adds a line,
  Escape closes the drawer, the guest price gate, the way back to Mannon.
- `pricing.e2e.ts`: the four v3 plans and prices, the annual toggle, the
  comparison table, the FAQ, the per-order-fee line.
- `demo-hub.e2e.ts`: the two hub cards, Start the tour, and the buyer demo
  failing closed with a plain-language notice.
- `demo-tour.e2e.ts`: the stepper by buttons, arrow keys and dots; Previous and
  Next disabled at the ends; the hand-off to the buyer demo.
- `api.e2e.ts`: `/healthz` shape with no secret names, the storefront
  quote-request endpoint's preflight and error contract, and the
  customer-account quotes endpoint failing closed without a token.

The API file is the one that found a real bug: Remix routes `OPTIONS` to the
loader, so the storefront widgets' JSON POSTs (which trigger a browser
preflight) were answered 405 without CORS headers by the served app while the
unit tests, which call the action directly, stayed green. Keep API checks in
this layer for anything the browser calls cross-origin.

Useful flags:

```
npx e2e run tests/demo-tour.e2e.ts --headed
npx e2e run --last-failed
npx e2e run --reporter list,markdown
```

Output lives in `.e2e/` (gitignored): `report.json`, `artifacts/` with a
screenshot and the observed screen for every failure, `logs/app.log` for the
server. Read the failure page in `.e2e/failures/` before touching a locator.

## Live e2e (`npm run test:e2e:live`)

Config: `e2e.live.config.ts`. Tests: `tests/live/*.e2e.ts`. Runs against
`E2E_LIVE_URL` (default `https://manosh.fly.dev`), no server is started. The
agent steps use Claude Haiku 4.5 through the AI SDK, so `ANTHROPIC_API_KEY` must
be in the shell. Never commit it; the runner redacts secrets it knows about but
the key is read by the provider, not by e2e.

The suite is one serial group: open the buyer demo, check the reorder card and
the Countered quote, accept the quote (a real draft order on the demo store,
nothing charged), then reorder. One group means one visitor buyer per run, which
stays inside the demo's limit of five starts per IP per hour.

Agent goals use the words on screen and every goal is pinned by an `expect`
or an `agent.assert` right after it, so passing `act` steps are recorded in
`.e2e/cache/` and replay without model calls until the screens change.

## QA harness (`npm run qa`)

`scripts/qa-smoke.sh` follows the qa-tester protocol from oh-my-claudecode:
prerequisites, the production build started in a uniquely named tmux session,
a readiness poll, one captured response per case, a PASS/FAIL verdict with the
command, expectation and actual output, and cleanup even on failure. It covers
what a Shopify reviewer and a scanner hit without a store: public pages, the
install hand-off, portal and rep sign-in walls, every mandatory webhook with a
missing, wrong and valid HMAC, the storefront endpoints' CORS and error
contracts, the internal cron and ERP secrets, and secret and stack-trace
leakage in every body. 77 cases today; the report lands in the scratchpad
(`report.md` plus one evidence file per case) and the latest is checked in
under `docs/qa/`.

Set `DATABASE_URL` to a scratch Postgres first. The harness supplies its own
dummy Shopify keys and secrets, so nothing real is needed, and it never runs
against the deployed app.

## Writing new tests

- Locators by role and accessible name, in this order: `getByRole`,
  `getByLabel`, `getByText`. If a control has no accessible name, give it one in
  the app rather than falling back to a CSS selector.
- One feature per file, `describe` with tags (`smoke`, `public`, `demo`,
  `api`, `a11y`, `live`, `agent`). Pick with `npx e2e run --tag smoke`.
- Deterministic checks stay in `tests/`; anything that needs a model or the
  deployed app goes in `tests/live/`.
- Never sleep. Use a matcher with a longer `timeout` for anything that settles.
- `npx e2e guide writing-tests` prints the framework's own reference; the
  full docs ship in `node_modules/e2e/docs`.

## CI

The unit suite runs on every push. For the local e2e suite in GitHub Actions,
add a job that installs Chromium (`npx playwright install chromium --with-deps`),
starts a Postgres service, applies the migrations, and runs `npm run test:e2e`
with the Shopify variables set to placeholders. Upload `.e2e/report.json` and
`.e2e/artifacts` when the job is not cancelled. The live suite stays manual: it
spends demo sessions and model calls.

## Storefront test from your machine (`npm run test:storefront`)

`scripts/storefront/storefront-test.mjs` drives the live storefront the way a
shopper does, then (with `--admin`) checks the merchant admin. Run it on a
machine that can reach the store; it is not part of CI.

```
npm run test:storefront
npm run test:storefront -- --admin
npm run test:storefront -- --admin --headed
```

Shopper side, in a fresh browser: opens the store (asks for the Online Store
password if there is one, or reads `MANNON_STOREFRONT_PASSWORD`), finds a
product page with Mannon's blocks (or `MANNON_PRODUCT_URL`), checks each block
is present and visible, sends Request a Quote, Add to Quote, Make an Offer (80%
of list) and Convert Cart to Quote from `/cart`, and reports what the price gate
shows a guest. A hidden block's line quotes what the app answered, so a
switched-off toggle or server flag reads differently from a broken block.

Guest price gating (`--gate-guests`, implies the Chrome attachment): before the
shopper side runs, opens Mannon → Price rules and adds "Logged-out visitors ·
hide price · Request a Quote" unless an active rule like it is already there.
The guest step then must show the price hidden and the call-to-action, or it
fails. Delete the rule on that page to turn gating off again.

Admin side (`--admin`): attaches to Chrome on port 9222 with the
`~/mannon-chrome` profile (the screencast recorder's; it starts it if needed and
waits for you to sign in) and looks for the run tag in Mannon → Quotes →
Requests and Mannon → Offers.

Every submission is tagged `qa+sf<run>@example.com` / "QA Storefront sf<run>";
decline them afterwards. The report and screenshots land in
`qa-storefront/<run>/` (git-ignored). Exit code is 1 if any step failed.

The anti-bot timer drops forms sent under 1.2 s and the rate limit is five
sends a minute per store and IP, so the script waits 1.6 s per form and sends
four. Dry-run against a local stand-in store (the real block markup and assets,
a password page and a cart) with all flags on: 13 pass, and the three quote
requests and the offer were in the database.

### Adding the missing blocks to the live theme (`npm run theme:add-blocks`)

When the storefront test skips Price / ATC gate or Convert Cart to Quote
because the blocks are not on the theme, this command adds them with the
Shopify CLI from your machine: it pulls `templates/product.json`,
`templates/cart.json` and the section files from the live theme into
`qa-storefront/theme-<stamp>/`, keeps a backup, adds the price gate next to the
Mannon blocks already on the product template (copying their app reference),
adds Convert Cart to Quote to the cart section whose schema accepts app blocks
(or an Apps section), and pushes only those two files with `--nodelete`. The
CLI asks before it writes to the live theme, and the script prints the command
that pushes the backup back. `--dry-run` edits locally and pushes nothing.
The template edits are covered by `scripts/storefront/theme-blocks.test.mjs`
(Dawn and Horizon shaped templates).


## Full app QA from your machine (`npm run qa:all`)

One command walks every user flow in `docs/qa/test-catalog.md` and writes a
qa-tester style report: for each case the action, the expected result, the
actual result, a verdict (PASS / FAIL / BLOCKED / SKIP / INFO) and the evidence.

```
export MANNON_STOREFRONT_PASSWORD=your-storefront-password
npm run qa:all -- --headed
```

Sections run in order: **P** prerequisites, **L** local layers (typecheck,
Vitest, e2e, the tmux contract smoke; skipped without `DATABASE_URL`), **C** live
HTTP contract, **V** visitor pages at desktop and phone width, **S** the
storefront run (`npm run test:storefront`), **M** merchant pages in your
signed-in Chrome (same Chrome as `--admin`), **B** buyer portal through the
magic link M7 generates, **D** the public buyer demo.

Options: `--only=C,V` or `--skip=L,M` choose sections, `--no-ai` skips the
✦ Claude cases, `--headed` shows the browsers. Environment: `MANNON_LIVE_URL`
(default `https://manosh.fly.dev`), `MANNON_STORE`, `MANNON_APP_HANDLE`,
`MANNON_SKUS` (lines for the order pad), `MANNON_MAGIC_LINK` (run B without M),
`MANNON_QA_EMAIL` (the shopper's email: use a company contact's, from Customers →
Companies, so M3–M6 and B3–B4 can price and order the storefront request),
`MANNON_CDP`, `DATABASE_URL`.

The report lands in `qa-runs/<run>/REPORT.md` with `results.json` and
screenshots, and lists what the run created (tagged with the run id) and what
is left to check by hand. The command exits 1 when any case FAILs. A case is
BLOCKED, not FAILED, when its precondition is missing, for example no Countered
quote for B3, or "We couldn't load the catalog" when Shopify is unreachable.
It never approves a plan charge, uninstalls the app or edits the theme. Section
**A** checks the Shopify side in Shopify Admin's own pages: Apps, Draft orders,
Companies, Customers, Billing and Payment terms.

### Everything on your machine (`npm run qa:local`)

```
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/mannon_test?schema=public
npm run qa:local
```

Runs every section with no store and no network: L first (Vitest truncates the
database), then it migrates and seeds, sets the local shop to the Scale plan
(`MANNON_QA_PLAN` to change), and serves the production build on 127.0.0.1:3101
with `scripts/qa/local/preload.mjs`, which sends `*.myshopify.com` calls to a mock
Admin API (:3103). Claude calls go to a mock Claude (:3104, via
`ANTHROPIC_BASE_URL`), and the theme blocks render on a mock Online Store (:3102,
password `letmein`). Merchant pages open as Shopify frames them: `embedded=1`,
`shop`, `host` and a session token signed with `SHOPIFY_API_SECRET`, with a
browser user agent (Shopify's library answers bot agents with 410) and a stub in
place of App Bridge. Section A then reads the mock logs to check the guardrails at
the API boundary: Shopify's totals shown as is, the draft order's purchasing
entity, terms and agreed prices, no invented id sent, Claude at temperature 0.
`--build` rebuilds first. The run also saves `server.log` and `shopify-calls.json`.
