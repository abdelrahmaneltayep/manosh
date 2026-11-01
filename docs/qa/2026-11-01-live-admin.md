## QA Test Report: Mannon live admin, 2026-11-01

Plan: `docs/qa/live-admin-plan.md`. Run by Claude Code on the Mac over Remote Control.

### Environment

- Branch `claude/mannon-feature-slices-w3epbf` at `57de186`. Deployed app `https://manosh.fly.dev`
  (`/healthz` → `{"status":"ok","live":true,"configOk":true,"requiredIssues":0}`).
- Dev store `mannon-9iu9ewku`, admin URL `https://admin.shopify.com/store/mannon-9iu9ewku/apps/mannon/app`.
- Browser: Playwright Chromium 149 (Chrome for Testing), headed, driven over CDP. Each demo run
  used a fresh browser context (equivalent to a private window). Claude in Chrome was enabled
  with `/chrome` but its tools never reached this session.
- Evidence: Fly logs (`fly logs -a manosh`) for every request below. Screenshots in
  `docs/qa/2026-11-01-live-admin/`.
- Demo starts spent: 3 of the 5 allowed per IP per hour.

**Admin access was blocked.** The Chromium profile is not signed in to Shopify. It stops at
accounts.shopify.com, which requires the owner's credentials, 2FA and an hCaptcha. Claude does not
enter credentials. So steps 1–11 and the final check could not be driven, and they are marked
BLOCKED, with the steps handed to the person to click (below). Steps 12–14 need no Shopify
login, and they were run.

#### TC1 — Dashboard and every left-nav page render
- **Command:** Open `…/apps/mannon/app`, then click Home, Quotes, Quote forms, Pricing & catalog, Buyers, Analytics, Settings and Pricing plans.
- **Expected:** Every page renders, with no "Something went wrong" and no blank frame.
- **Actual:** The Shopify login wall appeared (`tc01-admin-login-wall.png`). Side note: the Fly logs show the owner's own browser loading `/app`, `/app/price-rules`, `/app/analytics`, `/app/settings` and `/app/payments` as 200 between 17:49 and 17:50 UTC. That isn't evidence from this run.
- **Status:** BLOCKED (no admin sign-in)

#### TC2 — New quote priced by Shopify
- **Command:** Quotes → New quote, add two products, set quantities.
- **Expected:** Subtotal, tax and total appear, labelled as coming from Shopify.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC3 — ✦ Draft with Claude pre-fills only
- **Command:** Click "✦ Draft with Claude", then Apply.
- **Expected:** A counter is drafted on screen and nothing is sent. Apply only pre-fills the form. The upgrade note on Free or Starter is recorded.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC4 — Net 30 and Send gives a magic link
- **Command:** Choose Net 30, then Send.
- **Expected:** A confirmation with the buyer's magic link appears.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC5 — Magic link opens without login, Accept asks to confirm
- **Command:** Open the magic link in a private window and click Accept.
- **Expected:** The quote shows without login, and a confirm dialog appears before anything is written.
- **Actual:** Not run, because it depends on TC4. Related evidence from TC13 in the demo portal: clicking "Accept & create order" posted straight away, and no confirm dialog appeared first.
- **Status:** BLOCKED (depends on TC4)

#### TC6 — Accept becomes Ordered and a draft order with source Mannon
- **Command:** Confirm the accept, then check Orders → Drafts.
- **Expected:** The quote is Ordered, and a draft with source Mannon has the same totals.
- **Actual:** Not run.
- **Status:** BLOCKED (depends on TC5)

#### TC7 — AI Order Pad
- **Command:** Quote forms → AI Order Pad, then paste `20x SKU-A, 5x SKU-B` with real SKUs.
- **Expected:** Claude matches the lines, and nothing is ordered until "Confirm & build cart".
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC8 — Analytics ✦ Claude insights
- **Command:** Open Analytics.
- **Expected:** The insights section renders. The upgrade note on Free or Starter is recorded.
- **Actual:** Not run. The Fly log shows `GET /app/analytics` returning 200 in 272 ms from the owner's browser.
- **Status:** BLOCKED (no admin sign-in)

#### TC9 — Buyer portal reorder (magic-link session)
- **Command:** In the TC5 session, click Reorder on a "Reorder a past order" card.
- **Expected:** It becomes a draft order or a quote awaiting approval, or "no recent order" is recorded.
- **Actual:** Not run, because it depends on TC4.
- **Status:** BLOCKED (depends on TC4)

#### TC10 — Pricing plans → Choose Growth (CRITICAL, 1.2.2)
- **Command:** Pricing plans → Choose Growth, approve, then choose Starter and decline.
- **Expected:** Shopify's plan page lists Free, Starter, Growth and Scale, with no 404. After approving, the plan is Growth. After declining, the plan is unchanged.
- **Actual:** Not run. The Fly log shows the owner's browser requesting `GET /app/settings?upgrade=Growth` with 200 at 17:50:01 UTC. That doesn't show whether Shopify's plan page opened.
- **Status:** BLOCKED (no admin sign-in). **Still unproven for resubmission.**

#### TC11 — Theme app blocks render immediately (CRITICAL, 5.1.2)
- **Command:** Themes → Customize → product page → Add block "Add to Quote" → Save, then the live page and a quote submission. Repeat for "Make an Offer" and "Request a Quote".
- **Expected:** The button is visible in the editor right away with the Mannon note. On the live page it's visible with no note. The submitted quote shows under Quotes → Requests.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in). **Still unproven for resubmission.**

#### TC12 — Public demo lands as Demo buyer
- **Command:** `https://manosh.fly.dev`, then Try the demo, then Open the buyer demo, in a fresh context.
- **Expected:** The buyer lands as "Demo buyer", with a Countered quote under "Your quotes" and a card under "Reorder a past order".
- **Actual:** The landing page and demo hub render (`tc12-landing.png`, `tc12-demo-hub.png`). The portal shows "Welcome, Demo buyer" and the Powderbound company, and "Your quotes" lists one New and one Countered quote (`tc12-portal.png`). **There is no "Reorder a past order" section**: the heading isn't in the page, in 2 of 2 runs. `portal._index.tsx` renders that section only when `reorderCards.length > 0`, so the demo buyer has no reorder source. The likely cause is no order on the demo store in the reorder window. The plan's wording expects a card.
- **Status:** FAIL (the Countered quote passes, the reorder card is missing)

#### TC13 — Accept the Countered quote, then Ordered and PO-DEMO-1042
- **Command:** Open the Countered quote, click "Accept & create order" and confirm.
- **Expected:** The quote shows Ordered, and Orders → Drafts has a draft with PO PO-DEMO-1042.
- **Actual:** The quote page shows three lines (The Inventory Not Tracked Snowboard 24 × 911.95, Gift Card $10 12 × 9.6, Gift Card $25 6 × 24), the PO field pre-filled with `PO-DEMO-1042`, and payment terms. It shows no subtotal, tax or total. Clicking "Accept & create order" posts with **no confirm step** (`POST /portal/quotes/:id` 200 in about 300 ms). The page then shows **"We couldn't create your order just now. Please try again."** and the quote stays Countered (`tc13-confirm-dialog.png`, `tc13-retry.png`). This reproduced in 2 of 2 fresh visitors (quotes `cmvy4jg0r000or9h4ju7dqedx` and `cmvy4llke0017r9h41mjya1nu`). Nothing is logged on Fly: the catch-all in the `portal.quotes.$id.tsx` action returns the generic message without logging the error or reporting it to Sentry, so the cause can't be seen from outside. Whether a draft was created can't be checked without admin access, but the quote never left Countered.
- **Status:** FAIL

#### TC14 — Reorder from the demo portal
- **Command:** Back in the demo portal, click Reorder on the card.
- **Expected:** A new quote marked Ordered appears, or a note that it awaits approval.
- **Actual:** There's no card to click (see TC12). The "One-tap reorder" link opens `/portal/shortcuts` (200 in 47 ms), which says "No shortcuts yet" (`tc14-shortcuts.png`). So no reorder could be attempted.
- **Status:** FAIL (blocked by the missing reorder card)

#### Final check — Mannon installed, and the customer-account "Your quotes" block renders
- **Status:** BLOCKED (no admin sign-in and no customer login)

### Summary

| Status | Count | Steps |
|---|---|---|
| PASS | 0 | — |
| FAIL | 3 | TC12, TC13, TC14 |
| BLOCKED | 12 | TC1–TC11, the final check |

**Findings to fix, not fixed during the run, as the plan requires:**

1. **The demo accept fails** (TC13). This is the core value path, and reviewers follow it. Every
   fresh demo buyer hits "We couldn't create your order just now." The order lines include two
   Gift Card variants and an untracked snowboard. Check whether `draftOrderCreate` or
   `draftOrderCalculate` rejects the gift cards, or whether the demo shop's offline session or
   scopes are the problem.
2. **The accept error is swallowed.** The generic `catch` in `app/routes/portal.quotes.$id.tsx`
   doesn't log the error or report it to Sentry, which goes against the CLAUDE.md error convention.
3. **There's no confirm step before accept** in the buyer portal. Plan step 5 expects one.
4. **The demo buyer has no reorder card** (TC12 and TC14). The demo store needs an order inside the
   reorder window, or the demo seed should create one.
5. **The buyer quote page shows no subtotal, tax or total** from Shopify. It shows only unit lines.

**The two App Store items (1.2.2 and 5.1.2) are still unproven.** TC10 and TC11 need someone
signed in to the dev store.

### Steps for the person to click (TC1–TC11 and the final check)

Follow `docs/qa/live-admin-plan.md` steps 1–11 and the final check exactly as written, signed in to
`mannon-9iu9ewku`. Do steps 10 and 11 first. Screenshot the Shopify plan page (or a 404) and, for
each of the three blocks, both the theme editor and the live product page.

### Screenshots

- `docs/qa/2026-11-01-live-admin/tc01-admin-login-wall.png`
- `docs/qa/2026-11-01-live-admin/tc12-landing.png`
- `docs/qa/2026-11-01-live-admin/tc12-demo-hub.png`
- `docs/qa/2026-11-01-live-admin/tc12-portal.png`
- `docs/qa/2026-11-01-live-admin/tc13-confirm-dialog.png`
- `docs/qa/2026-11-01-live-admin/tc13-retry.png`
- `docs/qa/2026-11-01-live-admin/tc14-shortcuts.png`

## Re-run of TC12–TC14, 18:29 UTC (release v45, `6c57c5c`)

Fixes deployed since the first run: a confirm step before accept (`613c913`); Shopify's GraphQL
errors shown to the buyer and logged in full (`849cf26`); the demo now picks a company that has a
contact (`6c57c5c`). The new logs gave the root causes in order: first
`companyContactId` was null (fixed in code), then `ACCESS_DENIED: This app is not approved to
access the CalculatedDraftOrder object` (protected customer data). The owner reported the Partner
Dashboard request as done before this re-run.

#### TC12 (re-run)
- **Actual:** Lands as "Welcome, Demo buyer" for company Snowdevil. One Countered and one New quote are listed. There's still no "Reorder a past order" section. The log says `[demo] mannon-9iu9ewku.myshopify.com has no orders in the last 60 days`, even though a test order was placed. `Order` is protected customer data too, so this probably has the same cause as TC13. (`rerun-tc12-portal.png`)
- **Status:** FAIL (no reorder card)

#### TC13 (re-run)
- **Actual:** "Accept & create order" now opens a confirm step: "Accept this quote? … Nothing is written until you confirm." It offers "Confirm & create order" and "Go back" (`rerun-tc13-confirm.png`). After confirming, the page shows "Shopify couldn't create the order: This app is not approved to access the CalculatedDraftOrder object …", and the quote stays Countered (`rerun-tc13-result.png`). The log shows `[portal.accept] … ACCESS_DENIED` for quote `cmvy5zg1p000or9h4lyspw8y1`. The PO is pre-filled as PO-DEMO-1042.
- **Status:** FAIL (protected customer data access not active for the app)

#### TC14 (re-run)
- **Actual:** There's no reorder card, so no reorder could be attempted.
- **Status:** FAIL (blocked by TC12)

**Still needed:** Shopify has to actually grant the app protected customer data access, at Level 2 with
name and email, as in `SUBMISSION-KIT.md`. After that, re-run TC12–TC14. Expect the demo to find
the new order (the card appears) and the accept to reach Ordered.

## Second re-run of TC12–TC14, 18:33 UTC (v45)

The owner reported protected customer data access as granted. The results are unchanged: TC12 has no
reorder card (`[demo] … no orders in the last 60 days`), TC13 gets `ACCESS_DENIED … CalculatedDraftOrder`
after the confirm step (quote `cmvy64ml90017r9h4tabqy5k8`, `rerun2-tc13-result.png`), and TC14 is blocked.
**Status: FAIL, FAIL, FAIL.** Per shopify.dev/docs/apps/launch/protected-customer-data, a
dev-store app can only read customer data once step 5, "Complete your Data protection details", is done,
and only after a distribution method has been chosen.

## Third re-run of TC12–TC14, 18:56 UTC (v47, `93a05fc`)

Protected customer data access is saved in the Partner Dashboard (`93a05fc`).

#### TC13 (third re-run)
- **Actual:** The confirm step appears. After confirming, `POST /portal/quotes/cmvy6yayc0005r9h45qdoe9pj` returns 204 (a redirect) in 2.1 s, with no error logged. The quote shows **Ordered** with Shopify's totals: Subtotal USD 37767.53, Tax USD 0.0, Total USD 37767.53 (`rerun3-tc13-ordered.png`). The draft order and its PO (PO-DEMO-1042) weren't checked under Orders → Drafts, because there was no admin sign-in. Minor: tax shows as `0.0`, not `0.00`.
- **Status:** PASS (admin-side draft check pending)

#### TC12 (third re-run)
- **Actual:** Lands as Demo buyer (Snowdevil) with a Countered quote. There's still no reorder card, and the log says `[demo] … no orders in the last 60 days` (`rerun3-tc12-portal.png`).
- **Status:** FAIL

#### TC14 (third re-run)
- **Status:** FAIL (no card, blocked by TC12)

**Totals for TC12–TC14:** 1 pass, 2 fail. Next: check that the store has a completed order (Orders, not Drafts) placed within the last 60 days.
