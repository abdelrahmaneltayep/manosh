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

First run: `npx playwright install chromium` (CI: `--with-deps`).

What is covered today:

- `landing.e2e.ts`: title, pitch, the native-B2B line, the login form, both demo
  entry points, the `?shop=` hand-off to `/app`, the privacy page.
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
